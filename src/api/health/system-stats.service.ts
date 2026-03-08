import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Ścieżki do danych systemowych hosta.
 * Na Jetsonie montowane jako /host/proc i /host/sys (read-only).
 * Na dev pliki nie istnieją — serwis zwraca { available: false }.
 */
const HOST_PROC = '/host/proc';
const HOST_SYS = '/host/sys';
const THERMAL_BASE = `${HOST_SYS}/devices/virtual/thermal`;
const GPU_LOAD_PATH = `${HOST_SYS}/devices/gpu.0/load`;

interface CpuTimes {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
}

/**
 * Serwis odczytujący statystyki systemowe z Jetson Orin NX.
 * Czyta z bind-mountowanych ścieżek /host/proc i /host/sys.
 * Graceful degradation — na dev zwraca { available: false }.
 */
@Injectable()
export class SystemStatsService {
  private readonly logger = new Logger(SystemStatsService.name);

  /** Cache poprzedniego odczytu CPU do obliczenia delty */
  private prevCpuTimes: CpuTimes | null = null;

  /**
   * Sprawdza czy host paths są zamontowane (= jesteśmy na Jetsonie).
   */
  isAvailable(): boolean {
    try {
      return fs.existsSync(`${HOST_PROC}/meminfo`);
    } catch {
      return false;
    }
  }

  /**
   * Zbiera wszystkie statystyki systemowe.
   */
  async getStats(): Promise<Record<string, any>> {
    if (!this.isAvailable()) {
      return { available: false };
    }

    try {
      const [temperature, ram, cpu, gpu] = await Promise.all([
        this.readTemperature(),
        this.readRam(),
        this.readCpu(),
        this.readGpuLoad(),
      ]);

      return {
        available: true,
        temperature,
        ram,
        cpu,
        gpu,
      };
    } catch (err) {
      this.logger.warn(
        `Błąd odczytu statystyk: ${err instanceof Error ? err.message : err}`,
      );
      return { available: false };
    }
  }

  /**
   * Odczytuje temperatury z thermal_zone (CPU, GPU, SOC, etc.).
   */
  private async readTemperature(): Promise<
    { zone: string; tempC: number }[]
  > {
    const zones: { zone: string; tempC: number }[] = [];

    try {
      const thermalDir = THERMAL_BASE;
      if (!fs.existsSync(thermalDir)) return zones;

      const entries = fs.readdirSync(thermalDir).filter((e) =>
        e.startsWith('thermal_zone'),
      );

      for (const entry of entries) {
        try {
          const typePath = path.join(thermalDir, entry, 'type');
          const tempPath = path.join(thermalDir, entry, 'temp');

          if (!fs.existsSync(typePath) || !fs.existsSync(tempPath)) continue;

          const zone = fs.readFileSync(typePath, 'utf8').trim();
          const tempRaw = parseInt(fs.readFileSync(tempPath, 'utf8').trim(), 10);

          if (!isNaN(tempRaw)) {
            zones.push({
              zone,
              tempC: Math.round((tempRaw / 1000) * 10) / 10,
            });
          }
        } catch {
          // Pomiń strefę z błędem odczytu
        }
      }
    } catch (err) {
      this.logger.debug(`Błąd odczytu thermal: ${err}`);
    }

    return zones;
  }

  /**
   * Odczytuje zużycie RAM z /proc/meminfo.
   */
  private async readRam(): Promise<{
    totalMB: number;
    usedMB: number;
    percent: number;
  } | null> {
    try {
      const meminfo = fs.readFileSync(`${HOST_PROC}/meminfo`, 'utf8');

      const totalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
      const availMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);

      if (!totalMatch || !availMatch) return null;

      const totalKB = parseInt(totalMatch[1], 10);
      const availKB = parseInt(availMatch[1], 10);
      const usedKB = totalKB - availKB;

      const totalMB = Math.round(totalKB / 1024);
      const usedMB = Math.round(usedKB / 1024);
      const percent = Math.round((usedKB / totalKB) * 1000) / 10;

      return { totalMB, usedMB, percent };
    } catch {
      return null;
    }
  }

  /**
   * Oblicza zajętość CPU z /proc/stat (delta od ostatniego odczytu).
   */
  private async readCpu(): Promise<{
    percent: number;
    cores: number;
  } | null> {
    try {
      const stat = fs.readFileSync(`${HOST_PROC}/stat`, 'utf8');
      const cpuLine = stat.split('\n').find((l) => l.startsWith('cpu '));
      if (!cpuLine) return null;

      const parts = cpuLine.split(/\s+/).slice(1).map(Number);
      const current: CpuTimes = {
        user: parts[0],
        nice: parts[1],
        system: parts[2],
        idle: parts[3],
        iowait: parts[4] || 0,
        irq: parts[5] || 0,
        softirq: parts[6] || 0,
      };

      // Liczba rdzeni z /proc/stat (linie cpu0, cpu1, ...)
      const coreLines = stat.split('\n').filter((l) => /^cpu\d+/.test(l));
      const cores = coreLines.length || os.cpus().length;

      let percent: number | null = null;

      if (this.prevCpuTimes) {
        const prev = this.prevCpuTimes;
        const dUser = current.user - prev.user;
        const dNice = current.nice - prev.nice;
        const dSys = current.system - prev.system;
        const dIdle = current.idle - prev.idle;
        const dIo = current.iowait - prev.iowait;
        const dIrq = current.irq - prev.irq;
        const dSirq = current.softirq - prev.softirq;

        const total = dUser + dNice + dSys + dIdle + dIo + dIrq + dSirq;
        if (total > 0) {
          percent = Math.round(((total - dIdle) / total) * 1000) / 10;
        }
      }

      this.prevCpuTimes = current;

      return {
        percent: percent ?? 0,
        cores,
      };
    } catch {
      return null;
    }
  }

  /**
   * Odczytuje obciążenie GPU (Jetson-specific: /sys/devices/gpu.0/load).
   * Wartość 0-1000, dzielimy przez 10 → procent.
   */
  private async readGpuLoad(): Promise<{ percent: number } | null> {
    try {
      if (!fs.existsSync(GPU_LOAD_PATH)) return null;

      const raw = parseInt(
        fs.readFileSync(GPU_LOAD_PATH, 'utf8').trim(),
        10,
      );

      if (isNaN(raw)) return null;
      return { percent: Math.round(raw / 10) };
    } catch {
      return null;
    }
  }
}
