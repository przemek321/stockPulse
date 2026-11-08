import {
  computeCpuPercent,
  CpuTimes,
} from '../../src/api/health/system-stats.service';

const t = (o: Partial<CpuTimes>): CpuTimes => ({
  user: 0,
  nice: 0,
  system: 0,
  idle: 0,
  iowait: 0,
  irq: 0,
  softirq: 0,
  ...o,
});

describe('computeCpuPercent (fix 08.11.2026 — pomiar w stałym oknie)', () => {
  it('liczy zajętość z delty', () => {
    expect(computeCpuPercent(t({}), t({ user: 30, system: 10, idle: 160 }))).toBe(20);
  });

  it('iowait to bezczynność (jak top/htop)', () => {
    expect(computeCpuPercent(t({}), t({ user: 10, idle: 50, iowait: 40 }))).toBe(10);
  });

  it('puste okno → null (nie fałszywe 0% ani 100%)', () => {
    const a = t({ user: 5, idle: 5 });
    expect(computeCpuPercent(a, a)).toBeNull();
  });

  it('pełne obciążenie → 100', () => {
    expect(computeCpuPercent(t({}), t({ user: 300, system: 100 }))).toBe(100);
  });
});
