import { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Chip, Paper, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton, Tooltip, Collapse } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { fetchSystemOverview, SystemOverview, CollectorHealth, SystemError } from '../api';

/** Formatowanie daty */
const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/** Formatowanie czasu trwania (ms → czytelna forma) */
const fmtDuration = (ms: number | null) => {
  if (!ms) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
};

/** Formatowanie czasu "X min temu" */
const timeAgo = (v: string | null) => {
  if (!v) return '—';
  const diff = Date.now() - new Date(v).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'przed chwilą';
  if (min < 60) return `${min} min temu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m temu`;
  return `${Math.floor(h / 24)}d temu`;
};

/** Ikona statusu kolektora */
const StatusIcon = ({ status }: { status: string }) => {
  if (status === 'OK') return <CheckCircleIcon sx={{ color: '#66bb6a', fontSize: 20 }} />;
  if (status === 'WARNING') return <WarningIcon sx={{ color: '#ffa726', fontSize: 20 }} />;
  return <ErrorIcon sx={{ color: '#ef5350', fontSize: 20 }} />;
};

/** Chip ogólnego statusu systemu */
const OverallChip = ({ status }: { status: string }) => {
  const color = status === 'HEALTHY' ? 'success' : status === 'WARNING' ? 'warning' : 'error';
  const label = status === 'HEALTHY' ? 'System OK' : status === 'WARNING' ? 'Uwaga' : 'Problemy';
  return <Chip label={label} color={color} size="small" variant="outlined" />;
};

/** Nazwy kolektorów po polsku */
const COLLECTOR_NAMES: Record<string, string> = {
  SEC_EDGAR: 'SEC EDGAR (Form 4 + 8-K)',
  PDUFA_BIO: 'PDUFA.bio (kalendarz FDA)',
  POLYGON: 'Options Flow (Polygon.io)',
};

export default function SystemHealthPanel() {
  const [data, setData] = useState<SystemOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorsExpanded, setErrorsExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchSystemOverview();
      setData(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000); // odswiezaj co 60s
    return () => clearInterval(interval);
  }, [load]);

  if (loading && !data) return <Typography sx={{ p: 2, color: 'grey.500' }}>Ladowanie statusu...</Typography>;
  if (error && !data) return <Typography sx={{ p: 2, color: 'error.main' }}>Blad: {error}</Typography>;
  if (!data) return null;

  return (
    <Paper sx={{ p: 2, mb: 2, bgcolor: 'background.paper' }}>
      {/* Naglowek */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Status Systemu
          </Typography>
          <OverallChip status={data.overall} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {fmtDate(data.timestamp)}
          </Typography>
          <IconButton size="small" onClick={load} title="Odswiez">
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {/* Kolektory — karty */}
      <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
        {data.collectors.active.map((c: CollectorHealth) => (
          <Grid item xs={12} sm={4} key={c.source}>
            <Box sx={{
              p: 1.5,
              borderRadius: 1,
              border: '1px solid',
              borderColor: c.status === 'OK' ? 'rgba(102,187,106,0.3)' : c.status === 'WARNING' ? 'rgba(255,167,38,0.3)' : 'rgba(239,83,80,0.3)',
              bgcolor: c.status === 'OK' ? 'rgba(102,187,106,0.04)' : c.status === 'WARNING' ? 'rgba(255,167,38,0.04)' : 'rgba(239,83,80,0.04)',
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                <StatusIcon status={c.status} />
                <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.8rem' }}>
                  {COLLECTOR_NAMES[c.source] || c.source}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, fontSize: '0.7rem', color: 'text.secondary' }}>
                <Typography variant="caption">
                  Ostatni run: {timeAgo(c.lastRunAt)} ({c.lastItemsCollected} elem., {fmtDuration(c.lastDurationMs)})
                </Typography>
              </Box>
              {c.errorsLast24h > 0 && (
                <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.5 }}>
                  {c.errorsLast24h} blad(ow) w 24h
                </Typography>
              )}
              {c.lastError && (
                <Tooltip title={c.lastError} arrow>
                  <Typography variant="caption" color="error.main" sx={{
                    display: 'block', mt: 0.3,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
                  }}>
                    {c.lastError.substring(0, 80)}{c.lastError.length > 80 ? '...' : ''}
                  </Typography>
                </Tooltip>
              )}
            </Box>
          </Grid>
        ))}
      </Grid>

      {/* Statystyki — kompaktowy wiersz */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 1, px: 0.5 }}>
        {data.alerts && (
          <Box>
            <Typography variant="caption" color="text.secondary">Alerty 7d:</Typography>
            <Typography variant="caption" fontWeight={600}> {data.alerts.delivered7d} dostarczonych</Typography>
            {data.alerts.silent7d > 0 && <Typography variant="caption" color="text.secondary"> + {data.alerts.silent7d} silent</Typography>}
            <Typography variant="caption" color="text.secondary"> ({data.alerts.tickers7d} tickerow, {data.alerts.last24h} w 24h)</Typography>
          </Box>
        )}
        {data.pipeline && (
          <Box>
            <Typography variant="caption" color="text.secondary">Pipeline 24h:</Typography>
            <Typography variant="caption" fontWeight={600}> {data.pipeline.total24h} total</Typography>
            {data.pipeline.escalated24h > 0 && <Typography variant="caption" color="info.main"> ({data.pipeline.escalated24h} AI)</Typography>}
            {data.pipeline.failed24h > 0 && <Typography variant="caption" color="error.main"> ({data.pipeline.failed24h} failed)</Typography>}
          </Box>
        )}
        {data.failedJobs7d > 0 && (
          <Box>
            <Typography variant="caption" color="error.main">Failed jobs 7d: {data.failedJobs7d}</Typography>
          </Box>
        )}
        {data.collectors.disabled.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Wylaczone: {data.collectors.disabled.join(', ')}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Bledy systemowe (rozwjalne) */}
      {data.systemErrors.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Box
            onClick={() => setErrorsExpanded(!errorsExpanded)}
            sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 0.5 }}
          >
            <ErrorIcon sx={{ color: '#ef5350', fontSize: 16 }} />
            <Typography variant="caption" color="error.main" fontWeight={600}>
              {data.systemErrors.length} bledow systemowych (24h)
            </Typography>
            {errorsExpanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
          </Box>
          <Collapse in={errorsExpanded}>
            <TableContainer sx={{ mt: 1, maxHeight: 250 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ py: 0.5, fontSize: '0.7rem' }}>Czas</TableCell>
                    <TableCell sx={{ py: 0.5, fontSize: '0.7rem' }}>Modul</TableCell>
                    <TableCell sx={{ py: 0.5, fontSize: '0.7rem' }}>Funkcja</TableCell>
                    <TableCell sx={{ py: 0.5, fontSize: '0.7rem' }}>Blad</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.systemErrors.map((e: SystemError, i: number) => (
                    <TableRow key={i}>
                      <TableCell sx={{ py: 0.3, fontSize: '0.65rem', whiteSpace: 'nowrap' }}>{fmtDate(e.at)}</TableCell>
                      <TableCell sx={{ py: 0.3, fontSize: '0.65rem' }}>{e.module}</TableCell>
                      <TableCell sx={{ py: 0.3, fontSize: '0.65rem' }}>{e.className}.{e.function}()</TableCell>
                      <TableCell sx={{ py: 0.3, fontSize: '0.65rem', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <Tooltip title={e.error || ''} arrow>
                          <span>{e.error || '—'}</span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Collapse>
        </Box>
      )}
    </Paper>
  );
}
