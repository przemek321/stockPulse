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
];

const STATUSES = [
  { value: '', label: 'Wszystkie' },
  { value: 'success', label: 'Success' },
  { value: 'error', label: 'Error' },
];

const PAGE_SIZE = 50;

type SortDir = 'asc' | 'desc';

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

/** Wiersz z rozwijalnym szczegółem input/output */
function LogRow({ log }: { log: SystemLog }) {
  const [open, setOpen] = useState(false);
  const hasDetails = log.input || log.output || log.errorMessage;

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
        <TableCell sx={{ fontSize: '0.8rem' }}>
          <Chip
            label={log.module}
            size="small"
            variant="outlined"
            sx={{ fontSize: '0.7rem' }}
          />
        </TableCell>
        <TableCell sx={{ fontSize: '0.8rem' }}>{log.className}</TableCell>
        <TableCell sx={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
          {log.functionName}
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
          <TableCell colSpan={7} sx={{ py: 0, border: 0 }}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
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
                        bgcolor: '#0a1929',
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
                        bgcolor: '#0a1929',
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

      const data = await fetchSystemLogs(filters);
      setLogs(data.logs);
      setTotal(data.total);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [module, status, page]);

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
              Auto-refresh 30s
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
                { key: 'module', label: 'Moduł' },
                { key: 'className', label: 'Klasa' },
                { key: 'functionName', label: 'Funkcja' },
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
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : sortedLogs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
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
