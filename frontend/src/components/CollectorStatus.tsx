import { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  LinearProgress,
  Typography,
  CircularProgress,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import TimerIcon from '@mui/icons-material/Timer';
import { fetchHealth, HealthData } from '../api';

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

/** Formatuje sekundy na "2:35" */
const fmtCountdown = (sec: number) => {
  if (sec <= 0) return 'teraz...';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/** Panel statusu kolektorów z countdown i totalami — auto-refresh co 10s */
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
        // Inicjalizuj countdown z danych serwera
        const cd: Record<string, number> = {};
        s.collectors.forEach((c) => {
          cd[c.source] = c.secondsUntilNext ?? 0;
        });
        setCountdowns(cd);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Odświeżaj dane co 30s
  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Countdown ticker co 1s
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

  if (error) return <Typography color="error">Brak polaczenia z API: {error}</Typography>;
  if (!health || !stats) return <CircularProgress />;

  const statusColor =
    health.status === 'healthy'
      ? 'success'
      : health.status === 'degraded'
      ? 'warning'
      : 'error';

  // Mapa total z bazy per źródło
  const tableMap: Record<string, number> = {};
  stats.database.tables.forEach((t) => (tableMap[t.name] = t.count));

  // Mapowanie kolektor → które tabele wypełnia
  const SOURCE_TABLES: Record<string, string[]> = {
    STOCKTWITS: ['raw_mentions'],
    FINNHUB: ['news_articles', 'insider_trades'],
    SEC_EDGAR: ['sec_filings', 'insider_trades'],
    PDUFA_BIO: ['pdufa_catalysts'],
  };

  // Ukryj wyłączone kolektory (Sprint 11) — nie wnoszą wartości na dashboard
  const HIDDEN_COLLECTORS = ['REDDIT', 'STOCKTWITS', 'FINNHUB'];

  return (
    <Box>
      {/* Nagłówek */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
        <Typography variant="h6">Kolektory danych</Typography>
        <Chip label={health.status.toUpperCase()} color={statusColor as any} size="small" />
        <Chip
          label={`Telegram: ${health.telegram.configured ? 'OK' : 'OFF'}`}
          color={health.telegram.configured ? 'success' : 'default'}
          size="small"
          variant="outlined"
        />
        <Chip
          label={`Baza: ${stats.database.size}`}
          size="small"
          variant="outlined"
          color="info"
        />
      </Box>

      {/* Totale per tabela */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        {stats.database.tables
          .filter((t) => t.count > 0)
          .map((t) => (
            <Chip
              key={t.name}
              label={`${t.name}: ${t.count.toLocaleString()}`}
              size="small"
              variant="outlined"
              color="default"
            />
          ))}
      </Box>

      {/* Karty kolektorów */}
      <Grid container spacing={2}>
        {stats.collectors.filter((c) => !HIDDEN_COLLECTORS.includes(c.source)).map((c) => {
          const healthInfo = health.collectors.find((h) => h.source === c.source);
          const isHealthy = healthInfo?.isHealthy ?? false;
          const countdown = countdowns[c.source] ?? 0;
          const progressPct =
            c.intervalMinutes > 0
              ? Math.max(0, 100 - (countdown / (c.intervalMinutes * 60)) * 100)
              : 0;

          // Total rekordów w tabelach tego kolektora
          const totalRecords = (SOURCE_TABLES[c.source] || []).reduce(
            (sum, tbl) => sum + (tableMap[tbl] || 0),
            0,
          );

          return (
            <Grid item xs={12} sm={6} md={3} key={c.source}>
              <Card
                sx={{
                  borderLeft: 4,
                  borderColor: isHealthy ? 'success.main' : 'error.main',
                }}
              >
                <CardContent sx={{ pb: '12px !important' }}>
                  {/* Nazwa + status */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    {isHealthy ? (
                      <CheckCircleIcon color="success" fontSize="small" />
                    ) : (
                      <ErrorIcon color="error" fontSize="small" />
                    )}
                    <Typography variant="subtitle1" fontWeight={600}>
                      {c.source}
                    </Typography>
                    <Chip
                      label={`co ${c.intervalMinutes} min`}
                      size="small"
                      variant="outlined"
                      sx={{ ml: 'auto', fontSize: '0.65rem' }}
                    />
                  </Box>

                  {/* Total w bazie */}
                  <Typography variant="h4" fontWeight={700} color="primary">
                    {totalRecords.toLocaleString()}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    rekordow w bazie
                  </Typography>

                  {/* Ostatni cykl */}
                  <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="caption" color="text.secondary">
                      Ostatni cykl:{' '}
                      <strong>+{c.lastItemsCollected}</strong> ({c.lastDurationMs > 0 ? `${(c.lastDurationMs / 1000).toFixed(1)}s` : '—'})
                    </Typography>
                    <Chip
                      label={c.lastStatus || '—'}
                      size="small"
                      color={c.lastStatus === 'SUCCESS' ? 'success' : 'default'}
                      sx={{ fontSize: '0.6rem', height: 18 }}
                    />
                  </Box>

                  {/* Countdown + progress */}
                  <Box sx={{ mt: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                      <TimerIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                      <Typography variant="caption" color="text.secondary">
                        Nastepne pobranie za{' '}
                        <strong style={{ color: countdown <= 30 ? '#4fc3f7' : 'inherit' }}>
                          {fmtCountdown(countdown)}
                        </strong>
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={progressPct}
                      sx={{
                        height: 4,
                        borderRadius: 2,
                        bgcolor: 'rgba(255,255,255,0.08)',
                      }}
                    />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}
