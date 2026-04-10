/**
 * TopStatusBar — Bloomberg Terminal style header dla StockPulse.
 *
 * Layout:
 *   [STOCKPULSE] | TICKERS | ALERTS 24H | NYSE | CLAUDE | LAST UPDATE | REFRESH
 *   ─────────────────────────────────────────────────────────────────
 *   [DASHBOARD] [SIGNAL TIMELINE] [SYSTEM LOGS] [SLOWNIK]
 *
 * Self-contained: pobiera własne dane z /api/health, /api/health/stats,
 * /api/health/system-overview co 30s.
 */

import { useEffect, useState } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import {
  COLORS,
  TYPOGRAPHY,
  labelSx,
  fmtTimestamp,
} from '../theme/financial';

// ── TYPES ─────────────────────────────────────────────────

interface Props {
  activeTab: number;
  onTabChange: (tab: number) => void;
}

interface StatusData {
  tickersActive: number | null;
  alerts24h: number | null;
  claudeStatus: 'OK' | 'ERR' | 'OFF';
  lastUpdate: Date | null;
}

// ── HELPERS ───────────────────────────────────────────────

/**
 * NYSE sesja: pon-pt, 9:30-16:00 ET (14:30-21:00 UTC).
 * Używa UTC żeby być niezależnym od strefy serwera/przeglądarki.
 */
const getNyseStatus = (): { label: 'OPEN' | 'CLOSED'; color: string } => {
  const now = new Date();
  const dow = now.getUTCDay(); // 0=nd, 6=sob
  if (dow === 0 || dow === 6) return { label: 'CLOSED', color: COLORS.down };
  const minsUtc = now.getUTCHours() * 60 + now.getUTCMinutes();
  // 14:30 UTC = 870, 21:00 UTC = 1260 (standard time; ignorujemy DST dla uproszczenia)
  const open = 14 * 60 + 30;
  const close = 21 * 60;
  const inSession = minsUtc >= open && minsUtc < close;
  return {
    label: inSession ? 'OPEN' : 'CLOSED',
    color: inSession ? COLORS.up : COLORS.down,
  };
};

// ── METRIC CELL ───────────────────────────────────────────

const MetricCell = ({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
    <Box
      component="span"
      sx={{
        ...labelSx,
        color: 'rgba(255,255,255,0.55)',
        fontSize: '0.6rem',
        lineHeight: 1.1,
        mb: 0.25,
      }}
    >
      {label}
    </Box>
    <Box
      component="span"
      sx={{
        fontFamily: TYPOGRAPHY.monoFamily,
        fontSize: '0.85rem',
        fontWeight: TYPOGRAPHY.weight.bold,
        color: valueColor || COLORS.text.inverse,
        lineHeight: 1.15,
        whiteSpace: 'nowrap',
      }}
    >
      {value}
    </Box>
  </Box>
);

const Divider = () => (
  <Box
    sx={{
      width: '1px',
      alignSelf: 'stretch',
      bgcolor: 'rgba(255,255,255,0.18)',
      mx: 1.5,
    }}
  />
);

// ── COMPONENT ─────────────────────────────────────────────

export default function TopStatusBar({ activeTab, onTabChange }: Props) {
  const [data, setData] = useState<StatusData>({
    tickersActive: null,
    alerts24h: null,
    claudeStatus: 'OFF',
    lastUpdate: null,
  });
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = async () => {
    setRefreshing(true);
    try {
      const [statsRes, overviewRes, healthRes] = await Promise.allSettled([
        fetch('/api/health/stats').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/health/system-overview').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/health').then((r) => (r.ok ? r.json() : null)),
      ]);

      const stats = statsRes.status === 'fulfilled' ? statsRes.value : null;
      const overview = overviewRes.status === 'fulfilled' ? overviewRes.value : null;
      const health = healthRes.status === 'fulfilled' ? healthRes.value : null;

      // Tickers: szukamy w stats.tables lub stats.counts
      let tickersActive: number | null = null;
      if (stats) {
        if (Array.isArray(stats.tables)) {
          const t = stats.tables.find((x: any) => x.name === 'tickers' || x.table === 'tickers');
          if (t) tickersActive = t.count ?? t.rows ?? null;
        }
        if (tickersActive == null && stats.tickers != null) tickersActive = stats.tickers;
        if (tickersActive == null && stats.counts?.tickers != null) tickersActive = stats.counts.tickers;
      }
      if (tickersActive == null && overview?.tickers?.active != null) {
        tickersActive = overview.tickers.active;
      }
      if (tickersActive == null && overview?.tickers?.total != null) {
        tickersActive = overview.tickers.total;
      }

      // Alerts 24h
      let alerts24h: number | null = null;
      if (overview?.alerts?.last24h != null) alerts24h = overview.alerts.last24h;
      else if (overview?.alerts?.total24h != null) alerts24h = overview.alerts.total24h;
      else if (stats?.alerts?.last24h != null) alerts24h = stats.alerts.last24h;

      // Claude / AI status
      let claudeStatus: StatusData['claudeStatus'] = 'OFF';
      if (health) {
        const aiOk =
          health.ai?.status === 'ok' ||
          health.anthropic?.status === 'ok' ||
          health.services?.anthropic === 'ok' ||
          health.status === 'ok';
        claudeStatus = aiOk ? 'OK' : health.status === 'degraded' ? 'OFF' : 'ERR';
      }
      if (overview?.pipeline?.status) {
        claudeStatus = overview.pipeline.status === 'ok' ? 'OK' : 'ERR';
      }

      setData({
        tickersActive,
        alerts24h,
        claudeStatus,
        lastUpdate: new Date(),
      });
    } catch {
      setData((d) => ({ ...d, claudeStatus: 'ERR', lastUpdate: new Date() }));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => clearInterval(id);
  }, []);

  const nyse = getNyseStatus();
  const claudeColor =
    data.claudeStatus === 'OK'
      ? COLORS.up
      : data.claudeStatus === 'ERR'
      ? COLORS.down
      : COLORS.neutral;

  return (
    <Box sx={{ width: '100%', bgcolor: COLORS.bg.header }}>
      {/* ── TOP BAR: logo + metryki ── */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'stretch',
          minHeight: 48,
          px: 2,
          py: 0.75,
          borderBottom: `2px solid ${COLORS.accent}`,
          gap: 0,
        }}
      >
        {/* Logo */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            pr: 2,
            mr: 0.5,
          }}
        >
          <Box
            component="span"
            sx={{
              fontFamily: TYPOGRAPHY.sansFamily,
              fontWeight: 800,
              fontSize: '1.05rem',
              letterSpacing: '2px',
              color: COLORS.text.inverse,
              textTransform: 'uppercase',
            }}
          >
            STOCKPULSE
          </Box>
        </Box>

        <Divider />
        <MetricCell
          label="TICKERS"
          value={data.tickersActive != null ? String(data.tickersActive) : '—'}
        />
        <Divider />
        <MetricCell
          label="ALERTS 24H"
          value={data.alerts24h != null ? String(data.alerts24h) : '—'}
        />
        <Divider />
        <MetricCell label="NYSE" value={nyse.label} valueColor={nyse.color} />
        <Divider />
        <MetricCell label="CLAUDE" value={data.claudeStatus} valueColor={claudeColor} />
        <Divider />
        <MetricCell
          label="LAST UPDATE"
          value={data.lastUpdate ? fmtTimestamp(data.lastUpdate) : '—'}
        />

        {/* Spacer */}
        <Box sx={{ flexGrow: 1 }} />

        {/* Refresh indicator */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            pl: 2,
            borderLeft: '1px solid rgba(255,255,255,0.18)',
          }}
        >
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: refreshing ? COLORS.warning : COLORS.up,
              boxShadow: refreshing ? 'none' : `0 0 4px ${COLORS.up}`,
              transition: 'background-color 0.2s',
            }}
          />
          <Box
            component="span"
            sx={{
              ...labelSx,
              color: 'rgba(255,255,255,0.75)',
              fontSize: '0.6rem',
            }}
          >
            REFRESH 30S
          </Box>
        </Box>
      </Box>

      {/* ── TABS ── */}
      <Box
        sx={{
          bgcolor: COLORS.bg.headerAlt,
          borderBottom: `1px solid ${COLORS.borderAccent}`,
          px: 2,
        }}
      >
        <Tabs
          value={activeTab}
          onChange={(_, v) => onTabChange(v)}
          sx={{
            minHeight: 32,
            '& .MuiTabs-indicator': {
              height: '2px',
              backgroundColor: COLORS.accent,
            },
            '& .MuiTab-root': {
              minHeight: 32,
              py: 0.5,
              px: 2,
              fontSize: '0.7rem',
              fontWeight: 700,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.6)',
              fontFamily: TYPOGRAPHY.sansFamily,
              '&.Mui-selected': {
                color: COLORS.text.inverse,
              },
              '&:hover': {
                color: 'rgba(255,255,255,0.9)',
                bgcolor: 'rgba(255,255,255,0.04)',
              },
            },
          }}
        >
          <Tab label="DASHBOARD" />
          <Tab label="SIGNAL TIMELINE" />
          <Tab label="SYSTEM LOGS" />
          <Tab label="SLOWNIK" />
        </Tabs>
      </Box>
    </Box>
  );
}
