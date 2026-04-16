import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Chip,
  IconButton,
  Collapse,
  CircularProgress,
  Switch,
  FormControlLabel,
  Pagination,
  TextField,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import { fetchSystemLogs, SystemLog, SystemLogFilters } from '../api';

/** Dostępne moduły do filtrowania — wartości muszą pasować do @Logged(module) */
const MODULES = [
  { value: '', label: 'Wszystkie' },
  { value: 'collectors', label: 'collectors' },
  { value: 'sentiment', label: 'sentiment' },
  { value: 'sec-filings', label: 'sec-filings' },
  { value: 'correlation', label: 'correlation' },
  { value: 'alerts', label: 'alerts' },
  { value: 'telegram', label: 'telegram' },
  { value: 'options-flow', label: 'options-flow' },
  { value: 'price-outcome', label: 'price-outcome' },
];

const STATUSES = [
  { value: '', label: 'Wszystkie' },
  { value: 'success', label: 'Success' },
  { value: 'error', label: 'Error' },
];

const LEVELS = [
  { value: '', label: 'Wszystkie' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

const PAGE_SIZE = 50;

type SortDir = 'asc' | 'desc';

/** Mapping level → MUI color chip */
function levelColor(level: string | null): 'default' | 'info' | 'warning' | 'error' {
  switch (level) {
    case 'error': return 'error';
    case 'warn': return 'warning';
    case 'info': return 'info';
    default: return 'default';
  }
}

/** Mapping decision reason → kolory chipa */
function decisionColor(reason: string | null): { bg: string; fg: string } {
  if (!reason) return { bg: '#e0e0e0', fg: '#666' };
  if (reason === 'ALERT_SENT_TELEGRAM') return { bg: '#1b5e20', fg: '#fff' };
  if (reason === 'ALERT_TELEGRAM_FAILED') return { bg: '#b71c1c', fg: '#fff' };
  if (reason.startsWith('ALERT_DB_ONLY_')) return { bg: '#f57c00', fg: '#fff' };
  if (reason === 'PATTERNS_DETECTED') return { bg: '#6a1b9a', fg: '#fff' };
  if (reason === 'STORED' || reason === 'CORRELATION_STORED') return { bg: '#1565c0', fg: '#fff' };
  if (reason.startsWith('SKIP_')) return { bg: '#616161', fg: '#fff' };
  if (reason === 'THROTTLED' || reason === 'DEDUP_SKIP') return { bg: '#424242', fg: '#bbb' };
  if (reason === 'ERROR') return { bg: '#c62828', fg: '#fff' };
  return { bg: '#9e9e9e', fg: '#fff' };
}

/** Formatowanie daty po polsku */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Formatowanie czasu trwania */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const COL_SPAN = 10;

/** Wiersz z rozwijalnym szczegółem input/output/trace */
function LogRow({ log }: { log: SystemLog }) {
  const [open, setOpen] = useState(false);
  const hasDetails = log.input || log.output || log.errorMessage || log.traceId;

  return (
    <>
      <TableRow
        hover
        sx={{ cursor: hasDetails ? 'pointer' : 'default' }}
        onClick={() => hasDetails && setOpen(!open)}
      >
        <TableCell sx={{ width: 30, p: 0.5 }}>
          {hasDetails && (
            <IconButton size="small">
              {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
            </IconButton>
          )}
        </TableCell>
        <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
          {fmtDate(log.createdAt)}
        </TableCell>
        {/* Level */}
        <TableCell sx={{ width: 70 }}>
          {log.level && (
            <Chip
              label={log.level}
              size="small"
              color={levelColor(log.level)}
              sx={{ fontSize: '0.65rem', height: 20, textTransform: 'uppercase' }}
            />
          )}
        </TableCell>
        {/* Ticker */}
        <TableCell sx={{ width: 70, fontSize: '0.8rem', fontFamily: 'monospace', fontWeight: 600 }}>
          {log.ticker || '—'}
        </TableCell>
        <TableCell sx={{ fontSize: '0.8rem' }}>
          <Chip
            label={log.module}
            size="small"
            variant="outlined"
            sx={{ fontSize: '0.7rem' }}
          />
        </TableCell>
        <TableCell sx={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
          {log.functionName}
        </TableCell>
        {/* Decision Reason */}
        <TableCell sx={{ width: 170 }}>
          {log.decisionReason && (() => {
            const colors = decisionColor(log.decisionReason);
            return (
              <Chip
                label={log.decisionReason}
                size="small"
                sx={{
                  fontSize: '0.6rem',
                  height: 20,
                  bgcolor: colors.bg,
                  color: colors.fg,
                  fontFamily: 'monospace',
                  '& .MuiChip-label': { px: 0.8 },
                }}
              />
            );
          })()}
        </TableCell>
        <TableCell>
          <Chip
            label={log.status}
            size="small"
            color={log.status === 'success' ? 'success' : 'error'}
            sx={{ fontSize: '0.7rem' }}
          />
        </TableCell>
        <TableCell
          sx={{
            fontSize: '0.8rem',
            fontFamily: 'monospace',
            color: log.durationMs > 5000 ? '#ffa726' : undefined,
            fontWeight: log.durationMs > 5000 ? 700 : undefined,
          }}
        >
          {fmtDuration(log.durationMs)}
        </TableCell>
      </TableRow>

      {hasDetails && (
        <TableRow>
          <TableCell colSpan={COL_SPAN} sx={{ py: 0, border: 0 }}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {log.traceId && (
                  <Box sx={{ flex: '1 1 100%', mb: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      TRACE
                    </Typography>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1,
                        bgcolor: '#1a1a2e',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                      }}
                    >
                      <Typography
                        sx={{
                          fontFamily: 'monospace',
                          fontSize: '0.7rem',
                          color: '#7fb8ff',
                          flex: 1,
                        }}
                      >
                        {log.traceId}
                        {log.parentTraceId && (
                          <span style={{ color: '#888', marginLeft: 8 }}>
                            ← parent: {log.parentTraceId}
                          </span>
                        )}
                      </Typography>
                      <Button
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(log.traceId!);
                        }}
                        sx={{ fontSize: '0.65rem', minWidth: 'auto', py: 0.3, px: 1 }}
                      >
                        Kopiuj
                      </Button>
                    </Paper>
                  </Box>
                )}
                {log.input && (
                  <Box sx={{ flex: 1, minWidth: 300 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      gutterBottom
                    >
                      INPUT
                    </Typography>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1,
                        maxHeight: 200,
                        overflow: 'auto',
                        bgcolor: '#f5f7fa',
                      }}
                    >
                      <pre
                        style={{
                          margin: 0,
                          fontSize: '0.75rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {JSON.stringify(log.input, null, 2)}
                      </pre>
                    </Paper>
                  </Box>
                )}
                {log.output && (
                  <Box sx={{ flex: 1, minWidth: 300 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      gutterBottom
                    >
                      OUTPUT
                    </Typography>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1,
                        maxHeight: 200,
                        overflow: 'auto',
                        bgcolor: '#f5f7fa',
                      }}
                    >
                      <pre
                        style={{
                          margin: 0,
                          fontSize: '0.75rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {JSON.stringify(log.output, null, 2)}
                      </pre>
                    </Paper>
                  </Box>
                )}
                {log.errorMessage && (
                  <Box sx={{ flex: '1 1 100%' }}>
                    <Typography
                      variant="caption"
                      color="error"
                      gutterBottom
                    >
                      ERROR
                    </Typography>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1,
                        maxHeight: 200,
                        overflow: 'auto',
                        bgcolor: '#1a0000',
                        borderColor: '#ef5350',
                      }}
                    >
                      <pre
                        style={{
                          margin: 0,
                          fontSize: '0.75rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          color: '#ef5350',
                        }}
                      >
                        {log.errorMessage}
                      </pre>
                    </Paper>
                  </Box>
                )}
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * Zakładka System Logs — tabela z filtrowaniem, sortowaniem, paginacją i eksportem JSON.
 */
export default function SystemLogsTab() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtry
  const [module, setModule] = useState('');
  const [status, setStatus] = useState('');
  const [level, setLevel] = useState('');
  const [tickerFilter, setTickerFilter] = useState('');
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Sortowanie
  const [sortKey, setSortKey] = useState<string>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: SystemLogFilters = {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      };
      if (module) filters.module = module;
      if (status) filters.status = status;
      if (level) filters.level = level;
      if (tickerFilter) filters.ticker = tickerFilter;

      const data = await fetchSystemLogs(filters);
      setLogs(data.logs);
      setTotal(data.total);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [module, status, level, tickerFilter, page]);

  // Ładuj przy zmianie filtrów / strony
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Auto-refresh co 30s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadLogs, 30_000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadLogs]);

  // Resetuj stronę przy zmianie filtrów
  const handleModuleChange = (val: string) => {
    setModule(val);
    setPage(1);
  };
  const handleStatusChange = (val: string) => {
    setStatus(val);
    setPage(1);
  };
  const handleLevelChange = (val: string) => {
    setLevel(val);
    setPage(1);
  };

  // Sortowanie lokalne (w ramach załadowanej strony)
  const sortedLogs = useMemo(() => {
    if (!sortKey) return logs;
    return [...logs].sort((a: any, b: any) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const na = Number(va);
      const nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb)) {
        return sortDir === 'asc' ? na - nb : nb - na;
      }
      const da = Date.parse(va);
      const db = Date.parse(vb);
      if (!isNaN(da) && !isNaN(db)) {
        return sortDir === 'asc' ? da - db : db - da;
      }
      const cmp = String(va).localeCompare(String(vb), 'pl');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [logs, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // Export JSON — wybór zakresu dni
  const [exportDays, setExportDays] = useState(1);

  const handleExport = async () => {
    try {
      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - exportDays);

      const filters: SystemLogFilters = {
        limit: 500,
        dateFrom: dateFrom.toISOString(),
      };
      if (module) filters.module = module;
      if (status) filters.status = status;
      if (level) filters.level = level;
      if (tickerFilter) filters.ticker = tickerFilter;
      const data = await fetchSystemLogs(filters);

      const blob = new Blob([JSON.stringify(data.logs, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `system-logs-${date}-${exportDays}d.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(`Export error: ${e.message}`);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Statystyki
  const successCount = logs.filter((l) => l.status === 'success').length;
  const errorCount = logs.filter((l) => l.status === 'error').length;

  return (
    <Box>
      {/* Nagłówek + statystyki */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Typography variant="h6">
          System Logs
          <Chip
            label={`${total} total`}
            size="small"
            sx={{ ml: 1, fontSize: '0.75rem' }}
          />
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Chip
            label={`${successCount} ok`}
            size="small"
            color="success"
            variant="outlined"
          />
          <Chip
            label={`${errorCount} err`}
            size="small"
            color="error"
            variant="outlined"
          />
        </Box>
      </Box>

      {/* Filtry */}
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          mb: 2,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Moduł</InputLabel>
          <Select
            value={module}
            label="Moduł"
            onChange={(e) => handleModuleChange(e.target.value)}
          >
            {MODULES.map((m) => (
              <MenuItem key={m.value} value={m.value}>
                {m.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Status</InputLabel>
          <Select
            value={status}
            label="Status"
            onChange={(e) => handleStatusChange(e.target.value)}
          >
            {STATUSES.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Level</InputLabel>
          <Select
            value={level}
            label="Level"
            onChange={(e) => handleLevelChange(e.target.value)}
          >
            {LEVELS.map((l) => (
              <MenuItem key={l.value} value={l.value}>
                {l.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          size="small"
          label="Ticker"
          value={tickerFilter}
          onChange={(e) => setTickerFilter(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setPage(1);
              loadLogs();
            }
          }}
          sx={{ width: 100 }}
          placeholder="np. MU"
        />

        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
          }
          label={
            <Typography variant="body2" color="text.secondary">
              Auto 30s
            </Typography>
          }
        />

        <Box sx={{ flex: 1 }} />

        <Button
          size="small"
          startIcon={<RefreshIcon />}
          onClick={loadLogs}
          disabled={loading}
        >
          Odśwież
        </Button>
        <FormControl size="small" sx={{ minWidth: 90 }}>
          <InputLabel>Dni</InputLabel>
          <Select
            value={exportDays}
            label="Dni"
            onChange={(e) => setExportDays(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <MenuItem key={d} value={d}>
                {d}d
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={handleExport}
        >
          Export JSON
        </Button>
      </Box>

      {/* Błąd */}
      {error && (
        <Typography color="error" sx={{ mb: 1, fontSize: '0.85rem' }}>
          {error}
        </Typography>
      )}

      {/* Tabela */}
      <TableContainer
        component={Paper}
        sx={{ maxHeight: 'calc(100vh - 280px)' }}
      >
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 30 }} />
              {[
                { key: 'createdAt', label: 'Czas' },
                { key: 'level', label: 'Level' },
                { key: 'ticker', label: 'Ticker' },
                { key: 'module', label: 'Moduł' },
                { key: 'functionName', label: 'Funkcja' },
                { key: 'decisionReason', label: 'Decision' },
                { key: 'status', label: 'Status' },
                { key: 'durationMs', label: 'Czas trwania' },
              ].map((col) => (
                <TableCell key={col.key}>
                  <TableSortLabel
                    active={sortKey === col.key}
                    direction={sortKey === col.key ? sortDir : 'desc'}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COL_SPAN} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : sortedLogs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COL_SPAN}
                  align="center"
                  sx={{ py: 4, color: 'text.secondary' }}
                >
                  Brak logów
                </TableCell>
              </TableRow>
            ) : (
              sortedLogs.map((log) => <LogRow key={log.id} log={log} />)
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Paginacja */}
      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, p) => setPage(p)}
            color="primary"
            size="small"
          />
        </Box>
      )}
    </Box>
  );
}
