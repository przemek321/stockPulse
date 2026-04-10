import { useEffect, useState, useCallback } from 'react';
import { Box, LinearProgress, Typography, CircularProgress } from '@mui/material';
import { fetchHealth, HealthData } from '../api';
import {
  COLORS,
  TYPOGRAPHY,
  labelSx,
  panelSx,
  fmtRelative,
  statusColor,
  type Status,
} from '../theme/financial';

interface StatsData {
  timestamp: string;
  database: {
    size: string;
    tables: { name: string; count: number }[];
  };
  collectors: {
    source: string;
    intervalMinutes: number;
    lastRunAt: string | null;
    lastStatus: string | null;
    lastItemsCollected: number;
    lastDurationMs: number;
    nextRunAt: string | null;
    secondsUntilNext: number | null;
  }[];
}

const fetchStats = async (): Promise<StatsData> => {
  const res = await fetch('/api/health/stats');
  if (!res.ok) throw new Error(`Stats ${res.status}`);
  return res.json();
};

/** Mapowanie kolektor → tabele DB */
const SOURCE_TABLES: Record<string, string[]> = {
  STOCKTWITS: ['raw_mentions'],
  FINNHUB: ['news_articles', 'insider_trades'],
  SEC_EDGAR: ['sec_filings', 'insider_trades'],
  PDUFA_BIO: ['pdufa_catalysts'],
  POLYGON: ['options_flow'],
};

const HIDDEN_COLLECTORS = ['REDDIT', 'STOCKTWITS', 'FINNHUB'];

/** Format countdown "2m 35s" lub "35s" */
const fmtCountdown = (sec: number): string => {
  if (sec <= 0) return 'now';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
};

/** Header row container — bez labelSx (labelSx jest na komórkach) */
const headerRowSx = {
  py: 0.5,
  px: 0.75,
  borderBottom: `1px solid ${COLORS.borderStrong}`,
  bgcolor: COLORS.bg.cardAlt,
};

export default function CollectorStatus() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [countdowns, setCountdowns] = useState<Record<string, number>>({});
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([fetchHealth(), fetchStats()])
      .then(([h, s]) => {
        setHealth(h);
        setStats(s);
        const cd: Record<string, number> = {};
        s.collectors.forEach((c) => {
          cd[c.source] = c.secondsUntilNext ?? 0;
        });
        setCountdowns(cd);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      setCountdowns((prev) => {
        const next: Record<string, number> = {};
        for (const [key, val] of Object.entries(prev)) {
          next[key] = Math.max(0, val - 1);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  if (error)
    return (
      <Box sx={panelSx}>
        <Typography sx={{ ...labelSx, color: COLORS.down }}>
          ERR: API UNREACHABLE — {error}
        </Typography>
      </Box>
    );
  if (!health || !stats)
    return (
      <Box sx={panelSx}>
        <CircularProgress size={16} />
      </Box>
    );

  const overall: Status =
    health.status === 'healthy' ? 'OK' : health.status === 'degraded' ? 'STALE' : 'ERR';
  const overallColor = statusColor(overall);

  const tableMap: Record<string, number> = {};
  stats.database.tables.forEach((t) => (tableMap[t.name] = t.count));

  const visibleCollectors = stats.collectors.filter((c) => !HIDDEN_COLLECTORS.includes(c.source));

  return (
    <Box sx={{ ...panelSx, p: 0 }}>
      {/* Nagłówek panelu */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1,
          py: 0.75,
          borderBottom: `1px solid ${COLORS.border}`,
          bgcolor: COLORS.bg.cardAlt,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ ...labelSx, color: COLORS.text.accent, fontSize: TYPOGRAPHY.size.sm }}>
            COLLECTORS
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 0.6,
              py: 0.1,
              border: `1px solid ${overallColor}`,
              borderRadius: '2px',
            }}
          >
            <Box sx={{ width: 5, height: 5, bgcolor: overallColor, borderRadius: '50%' }} />
            <Typography
              sx={{
                fontFamily: TYPOGRAPHY.monoFamily,
                fontSize: TYPOGRAPHY.size.xs,
                fontWeight: TYPOGRAPHY.weight.bold,
                color: overallColor,
                letterSpacing: '0.5px',
              }}
            >
              {overall}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Typography
            sx={{
              fontFamily: TYPOGRAPHY.monoFamily,
              fontSize: TYPOGRAPHY.size.xs,
              color: COLORS.text.secondary,
            }}
          >
            TG:&nbsp;
            <Box
              component="span"
              sx={{
                color: health.telegram.configured ? COLORS.up : COLORS.neutral,
                fontWeight: 700,
              }}
            >
              {health.telegram.configured ? 'OK' : 'OFF'}
            </Box>
          </Typography>
          <Typography
            sx={{
              fontFamily: TYPOGRAPHY.monoFamily,
              fontSize: TYPOGRAPHY.size.xs,
              color: COLORS.text.secondary,
            }}
          >
            DB:&nbsp;
            <Box component="span" sx={{ color: COLORS.text.primary, fontWeight: 700 }}>
              {stats.database.size}
            </Box>
          </Typography>
        </Box>
      </Box>

      {/* Wiersz nagłówka tabeli */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '4px 1.6fr 0.8fr 0.9fr 0.8fr 0.8fr 1.4fr',
          alignItems: 'center',
          ...headerRowSx,
          gap: 0.75,
          px: 1,
        }}
      >
        <Box />
        <Box sx={labelSx}>SOURCE</Box>
        <Box sx={{ ...labelSx, textAlign: 'right' }}>TOTAL</Box>
        <Box sx={{ ...labelSx, textAlign: 'right' }}>LAST</Box>
        <Box sx={{ ...labelSx, textAlign: 'right' }}>ITEMS</Box>
        <Box sx={{ ...labelSx, textAlign: 'right' }}>NEXT</Box>
        <Box sx={labelSx}>PROGRESS</Box>
      </Box>

      {/* Wiersze kolektorów */}
      {visibleCollectors.map((c, idx) => {
        const healthInfo = health.collectors.find((h) => h.source === c.source);
        const isHealthy = healthInfo?.isHealthy ?? false;
        const lastStatus: Status = isHealthy ? 'OK' : 'ERR';
        const color = statusColor(lastStatus);

        const countdown = countdowns[c.source] ?? 0;
        const progressPct =
          c.intervalMinutes > 0
            ? Math.max(0, 100 - (countdown / (c.intervalMinutes * 60)) * 100)
            : 0;

        const totalRecords = (SOURCE_TABLES[c.source] || []).reduce(
          (sum, tbl) => sum + (tableMap[tbl] || 0),
          0,
        );

        return (
          <Box
            key={c.source}
            sx={{
              display: 'grid',
              gridTemplateColumns: '4px 1.6fr 0.8fr 0.9fr 0.8fr 0.8fr 1.4fr',
              alignItems: 'center',
              gap: 0.75,
              px: 1,
              py: 0.6,
              borderBottom:
                idx === visibleCollectors.length - 1
                  ? 'none'
                  : `1px solid ${COLORS.border}`,
              bgcolor: idx % 2 === 1 ? COLORS.bg.cardAlt : COLORS.bg.card,
              '&:hover': { bgcolor: COLORS.bg.cellHover },
            }}
          >
            {/* Status bar */}
            <Box sx={{ width: 3, height: 22, bgcolor: color }} />

            {/* Source name + interval + status text */}
            <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography
                  sx={{
                    ...TYPOGRAPHY.uppercase,
                    color: COLORS.text.accent,
                    fontSize: TYPOGRAPHY.size.sm,
                    fontWeight: TYPOGRAPHY.weight.bold,
                  }}
                >
                  {c.source}
                </Typography>
                <Typography
                  sx={{
                    fontFamily: TYPOGRAPHY.monoFamily,
                    fontSize: TYPOGRAPHY.size.xs,
                    fontWeight: TYPOGRAPHY.weight.bold,
                    color,
                    letterSpacing: '0.5px',
                  }}
                >
                  {lastStatus}
                </Typography>
              </Box>
              <Typography
                sx={{
                  fontFamily: TYPOGRAPHY.monoFamily,
                  fontSize: TYPOGRAPHY.size.xs,
                  color: COLORS.text.muted,
                  mt: 0.15,
                }}
              >
                every {c.intervalMinutes}m
                {c.lastDurationMs > 0 && ` · ${(c.lastDurationMs / 1000).toFixed(1)}s`}
              </Typography>
            </Box>

            {/* Total w bazie */}
            <Typography
              sx={{
                fontFamily: TYPOGRAPHY.monoFamily,
                fontSize: TYPOGRAPHY.size.md,
                fontWeight: TYPOGRAPHY.weight.bold,
                color: COLORS.text.primary,
                textAlign: 'right',
              }}
            >
              {totalRecords.toLocaleString()}
            </Typography>

            {/* Last run relative */}
            <Typography
              sx={{
                fontFamily: TYPOGRAPHY.monoFamily,
                fontSize: TYPOGRAPHY.size.xs,
                color: COLORS.text.secondary,
                textAlign: 'right',
              }}
            >
              {fmtRelative(c.lastRunAt)} ago
            </Typography>

            {/* Items collected last cycle */}
            <Typography
              sx={{
                fontFamily: TYPOGRAPHY.monoFamily,
                fontSize: TYPOGRAPHY.size.xs,
                fontWeight: TYPOGRAPHY.weight.semibold,
                color: c.lastItemsCollected > 0 ? COLORS.up : COLORS.text.muted,
                textAlign: 'right',
              }}
            >
              +{c.lastItemsCollected}
            </Typography>

            {/* Next run countdown */}
            <Typography
              sx={{
                fontFamily: TYPOGRAPHY.monoFamily,
                fontSize: TYPOGRAPHY.size.xs,
                fontWeight: TYPOGRAPHY.weight.semibold,
                color: countdown <= 30 ? COLORS.accent : COLORS.text.secondary,
                textAlign: 'right',
              }}
            >
              {fmtCountdown(countdown)}
            </Typography>

            {/* Progress bar */}
            <Box sx={{ width: '100%' }}>
              <LinearProgress
                variant="determinate"
                value={progressPct}
                sx={{
                  height: 3,
                  borderRadius: 0,
                  bgcolor: COLORS.bg.panel,
                  '& .MuiLinearProgress-bar': {
                    bgcolor: COLORS.text.accent,
                    borderRadius: 0,
                  },
                }}
              />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
