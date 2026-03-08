import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  LinearProgress,
  Chip,
} from '@mui/material';
import DeviceThermostatIcon from '@mui/icons-material/DeviceThermostat';
import MemoryIcon from '@mui/icons-material/Memory';
import SpeedIcon from '@mui/icons-material/Speed';
import { fetchSystemStats, SystemStats } from '../api';

/** Kolor temperatury — zielony < 60°C, pomaranczowy 60-80°C, czerwony > 80°C */
function tempColor(tempC: number): string {
  if (tempC >= 80) return '#ef5350';
  if (tempC >= 60) return '#ffa726';
  return '#66bb6a';
}

/** Kolor procentowy — zielony < 60%, pomaranczowy 60-85%, czerwony > 85% */
function usageColor(percent: number): string {
  if (percent >= 85) return '#ef5350';
  if (percent >= 60) return '#ffa726';
  return '#66bb6a';
}

/**
 * Kompaktowy pasek z danymi systemowymi Jetson Orin NX.
 * Temperatura CPU/GPU, RAM, CPU %, GPU %.
 * Auto-refresh co 10s. Ukryty na dev (available: false).
 */
export default function JetsonStatsBar() {
  const [stats, setStats] = useState<SystemStats | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchSystemStats();
      setStats(data);
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  // Ukryj na dev
  if (!stats || !stats.available) return null;

  // Znajdz temperatury CPU i GPU
  const cpuTemp = stats.temperature?.find(
    (t) => t.zone.toLowerCase().includes('cpu'),
  );
  const gpuTemp = stats.temperature?.find(
    (t) => t.zone.toLowerCase().includes('gpu'),
  );

  const ram = stats.ram;
  const cpu = stats.cpu;
  const gpu = stats.gpu;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1,
        px: 2,
        mb: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 2.5,
        flexWrap: 'wrap',
        bgcolor: '#0a1929',
      }}
    >
      {/* Tytuł */}
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase' }}
      >
        Jetson NX
      </Typography>

      {/* Temperatury */}
      {cpuTemp && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <DeviceThermostatIcon
            sx={{ fontSize: 16, color: tempColor(cpuTemp.tempC) }}
          />
          <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
            CPU{' '}
            <span style={{ color: tempColor(cpuTemp.tempC), fontWeight: 700 }}>
              {cpuTemp.tempC}°C
            </span>
          </Typography>
        </Box>
      )}

      {gpuTemp && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <DeviceThermostatIcon
            sx={{ fontSize: 16, color: tempColor(gpuTemp.tempC) }}
          />
          <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
            GPU{' '}
            <span style={{ color: tempColor(gpuTemp.tempC), fontWeight: 700 }}>
              {gpuTemp.tempC}°C
            </span>
          </Typography>
        </Box>
      )}

      {/* RAM */}
      {ram && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            minWidth: 180,
          }}
        >
          <MemoryIcon sx={{ fontSize: 16, color: usageColor(ram.percent) }} />
          <Typography variant="body2" sx={{ fontSize: '0.8rem', mr: 0.5 }}>
            RAM
          </Typography>
          <Box sx={{ flex: 1, minWidth: 60 }}>
            <LinearProgress
              variant="determinate"
              value={ram.percent}
              sx={{
                height: 6,
                borderRadius: 3,
                bgcolor: 'rgba(255,255,255,0.1)',
                '& .MuiLinearProgress-bar': {
                  bgcolor: usageColor(ram.percent),
                },
              }}
            />
          </Box>
          <Typography
            variant="body2"
            sx={{
              fontSize: '0.75rem',
              color: usageColor(ram.percent),
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {(ram.usedMB / 1024).toFixed(1)}/{(ram.totalMB / 1024).toFixed(0)}GB
          </Typography>
        </Box>
      )}

      {/* CPU % */}
      {cpu && (
        <Chip
          icon={<SpeedIcon sx={{ fontSize: '14px !important' }} />}
          label={`CPU ${cpu.percent.toFixed(0)}%`}
          size="small"
          variant="outlined"
          sx={{
            fontSize: '0.75rem',
            borderColor: usageColor(cpu.percent),
            color: usageColor(cpu.percent),
          }}
        />
      )}

      {/* GPU % */}
      {gpu && (
        <Chip
          label={`GPU ${gpu.percent}%`}
          size="small"
          variant="outlined"
          sx={{
            fontSize: '0.75rem',
            borderColor: usageColor(gpu.percent),
            color: usageColor(gpu.percent),
          }}
        />
      )}
    </Paper>
  );
}
