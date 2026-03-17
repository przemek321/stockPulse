import { useState, useMemo } from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Chip,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TablePagination,
  CircularProgress,
  Paper,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface Column {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: any, row: any) => React.ReactNode;
}

type SortDir = 'asc' | 'desc';

interface DataPanelProps {
  title: string;
  icon: React.ReactNode;
  badge?: number;
  badgeColor?: 'primary' | 'secondary' | 'error' | 'warning' | 'success' | 'info';
  columns: Column[];
  fetchData: () => Promise<any[]>;
  /** Klucz kolumny do domyślnego sortowania */
  defaultSortKey?: string;
  /** Domyślny kierunek sortowania */
  defaultSortDir?: SortDir;
}

/**
 * Rozwijany panel z tabelą danych.
 * Ładuje dane dopiero po kliknięciu (lazy loading).
 */
export default function DataPanel({
  title,
  icon,
  badge,
  badgeColor = 'primary',
  columns,
  fetchData,
  defaultSortKey,
  defaultSortDir = 'desc',
}: DataPanelProps) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  /** Przełącz sortowanie po kolumnie */
  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(0);
  };

  /** Posortowane wiersze */
  const sortedRows = useMemo(() => {
    if (!rows || !sortKey) return rows;
    return [...rows].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      // Liczby (w tym stringi numeryczne z PostgreSQL decimal)
      const na = Number(va);
      const nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb) && String(va).trim() !== '' && String(vb).trim() !== '') {
        return sortDir === 'asc' ? na - nb : nb - na;
      }
      // Daty — porównanie po timestamp
      const da = Date.parse(va);
      const db = Date.parse(vb);
      if (!isNaN(da) && !isNaN(db)) {
        return sortDir === 'asc' ? da - db : db - da;
      }
      // Tekst
      const cmp = String(va).localeCompare(String(vb), 'pl');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  /** Wiersze na bieżącej stronie */
  const paginatedRows = useMemo(() => {
    if (!sortedRows) return null;
    return sortedRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  }, [sortedRows, page, rowsPerPage]);

  const handleToggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && rows === null) {
      setLoading(true);
      try {
        const data = await fetchData();
        setRows(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <Accordion
      expanded={expanded}
      onChange={handleToggle}
      sx={{
        '&:before': { display: 'none' },
        borderRadius: '8px !important',
        mb: 1.5,
        overflow: 'hidden',
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {icon}
          <Typography fontWeight={600}>{title}</Typography>
          {badge !== undefined && (
            <Chip label={badge.toLocaleString()} color={badgeColor} size="small" />
          )}
        </Box>
      </AccordionSummary>

      <AccordionDetails sx={{ p: 0 }}>
        {loading && (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <CircularProgress size={28} />
          </Box>
        )}
        {error && (
          <Typography color="error" sx={{ p: 2 }}>
            {error}
          </Typography>
        )}
        {paginatedRows && sortedRows && (
          <>
            <TableContainer component={Paper} sx={{ maxHeight: 420 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    {columns.map((col) => {
                      const isSortable = col.sortable !== false;
                      return (
                        <TableCell
                          key={col.key}
                          sx={{ fontWeight: 700, bgcolor: 'background.paper' }}
                          sortDirection={sortKey === col.key ? sortDir : false}
                        >
                          {isSortable ? (
                            <TableSortLabel
                              active={sortKey === col.key}
                              direction={sortKey === col.key ? sortDir : 'desc'}
                              onClick={() => handleSort(col.key)}
                            >
                              {col.label}
                            </TableSortLabel>
                          ) : (
                            col.label
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={columns.length} align="center">
                        Brak danych
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedRows.map((row, idx) => (
                      <TableRow key={idx} hover>
                        {columns.map((col) => (
                          <TableCell key={col.key} sx={{ fontSize: '0.8rem' }}>
                            {col.render
                              ? col.render(row[col.key], row)
                              : row[col.key] ?? '—'}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            {sortedRows.length > 25 && (
              <TablePagination
                component="div"
                count={sortedRows.length}
                page={page}
                onPageChange={(_, p) => setPage(p)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => {
                  setRowsPerPage(parseInt(e.target.value, 10));
                  setPage(0);
                }}
                rowsPerPageOptions={[25, 50, 100]}
                labelRowsPerPage="Wierszy na stronę:"
                labelDisplayedRows={({ from, to, count }) => `${from}–${to} z ${count}`}
                sx={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}
              />
            )}
          </>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
