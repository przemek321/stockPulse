import { useEffect, useState } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import {
  COLORS,
  TYPOGRAPHY,
  labelSx,
  panelSx,
} from '../theme/financial';

interface StatsData {
  database: {
    size: string;
    tables: { name: string; count: number }[];
  };
}

interface SystemOverviewSlim {
  alerts: { delivered7d: number } | null;
}

const fetchStatsMini = async (): Promise<StatsData> => {
  const res = await fetch('/api/health/stats');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const fetchOverviewMini = async (): Promise<SystemOverviewSlim> => {
  const res = await fetch('/api/health/system-overview');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

/**
 * Inline horizontalny stat strip + przycisk raportu tygodniowego (JSON).
 * Bloomberg style: pojedyncza linia z metrykami bazy i przyciskiem download.
 */
export default function DbSummary() {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [overview, setOverview] = useState<SystemOverviewSlim | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, o] = await Promise.all([fetchStatsMini(), fetchOverviewMini()]);
        if (!alive) return;
        setStats(s);
        setOverview(o);
      } catch {
        /* ignore — panel jest opcjonalny */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/health/weekly-report?days=7');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `stockpulse-report-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Blad pobierania raportu: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const tableMap: Record<string, number> = {};
  stats?.database.tables.forEach((t) => (tableMap[t.name] = t.count));

  const tickers = tableMap['tickers'] ?? null;
  const rules = tableMap['alert_rules'] ?? null;
  const dbSize = stats?.database.size ?? null;
  const alerts7d = overview?.alerts?.delivered7d ?? null;

  const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
      <Typography sx={{ ...labelSx, fontSize: TYPOGRAPHY.size.xs }}>{label}</Typography>
      <Typography
        sx={{
          fontFamily: TYPOGRAPHY.monoFamily,
          fontSize: TYPOGRAPHY.size.md,
          fontWeight: TYPOGRAPHY.weight.bold,
          color: COLORS.text.primary,
          lineHeight: 1.2,
        }}
      >
        {value ?? '—'}
      </Typography>
    </Box>
  );

  return (
    <Box
      sx={{
        ...panelSx,
        p: 0.75,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 1.5,
      }}
    >
      <Stat label="TICKERS" value={tickers?.toLocaleString()} />
      <Box sx={{ color: COLORS.border, fontSize: TYPOGRAPHY.size.xs }}>|</Box>
      <Stat label="ALERTS 7D" value={alerts7d?.toLocaleString()} />
      <Box sx={{ color: COLORS.border, fontSize: TYPOGRAPHY.size.xs }}>|</Box>
      <Stat label="RULES" value={rules?.toLocaleString()} />
      <Box sx={{ color: COLORS.border, fontSize: TYPOGRAPHY.size.xs }}>|</Box>
      <Stat label="DB SIZE" value={dbSize} />

      {/* Spacer */}
      <Box sx={{ flex: 1 }} />

      {/* Download button (terminal style) */}
      <Box
        component="button"
        onClick={handleDownload}
        disabled={loading}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          bgcolor: 'transparent',
          border: `1px solid ${COLORS.borderStrong}`,
          borderRadius: '2px',
          px: 0.75,
          py: 0.4,
          cursor: loading ? 'wait' : 'pointer',
          color: COLORS.text.accent,
          fontFamily: TYPOGRAPHY.sansFamily,
          fontSize: TYPOGRAPHY.size.xs,
          fontWeight: TYPOGRAPHY.weight.bold,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          '&:hover:not(:disabled)': {
            bgcolor: COLORS.bg.cellHover,
            borderColor: COLORS.text.accent,
          },
          '&:disabled': { opacity: 0.5 },
        }}
      >
        {loading ? (
          <CircularProgress size={12} sx={{ color: COLORS.text.accent }} />
        ) : (
          <DownloadIcon sx={{ fontSize: 14 }} />
        )}
        {loading ? 'GENERATING...' : 'WEEKLY REPORT'}
      </Box>
    </Box>
  );
}
