import { useState, useMemo } from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { COLORS, TYPOGRAPHY } from '../theme/financial';

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
 * Bloomberg Terminal-style panel z tabelą danych.
 * Lazy loading — dane pobierane po pierwszym rozwinięciu.
 */
export default function DataPanel({
  title,
  icon,
  badge,
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

  const totalRows = sortedRows?.length ?? 0;
  const fromRow = totalRows === 0 ? 0 : page * rowsPerPage + 1;
  const toRow = Math.min((page + 1) * rowsPerPage, totalRows);
  const maxPage = Math.max(0, Math.ceil(totalRows / rowsPerPage) - 1);

  return (
    <Box
      sx={{
        bgcolor: COLORS.bg.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: '2px',
        mb: 1,
        fontFamily: TYPOGRAPHY.sansFamily,
      }}
    >
      {/* ── HEADER BAR ─────────────────────────────────────── */}
      <Box
        onClick={handleToggle}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.75,
          cursor: 'pointer',
          borderBottom: expanded ? `1px solid ${COLORS.border}` : 'none',
          bgcolor: COLORS.bg.card,
          userSelect: 'none',
          '&:hover': { bgcolor: COLORS.bg.cellHover },
          transition: 'background-color 0.1s',
        }}
      >
        {expanded ? (
          <KeyboardArrowDownIcon sx={{ fontSize: 16, color: COLORS.text.accent }} />
        ) : (
          <KeyboardArrowRightIcon sx={{ fontSize: 16, color: COLORS.text.accent }} />
        )}
        {icon && (
          <Box sx={{ display: 'flex', alignItems: 'center', '& svg': { fontSize: 16, color: COLORS.text.accent } }}>
            {icon}
          </Box>
        )}
        <Typography
          sx={{
            ...TYPOGRAPHY.uppercase,
            fontSize: TYPOGRAPHY.size.sm,
            color: COLORS.text.accent,
            fontWeight: 700,
          }}
        >
          {title}
        </Typography>
        {badge !== undefined && (
          <Box
            sx={{
              ml: 'auto',
              px: 0.75,
              py: 0.125,
              bgcolor: COLORS.bg.panel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '2px',
              fontFamily: TYPOGRAPHY.monoFamily,
              fontSize: TYPOGRAPHY.size.xs,
              fontWeight: 600,
              color: COLORS.text.primary,
              lineHeight: 1.4,
            }}
          >
            {badge.toLocaleString()}
          </Box>
        )}
      </Box>

      {/* ── CONTENT ────────────────────────────────────────── */}
      {expanded && (
        <Box sx={{ position: 'relative' }}>
          {loading && (
            <LinearProgress
              sx={{
                height: 2,
                bgcolor: COLORS.bg.panel,
                '& .MuiLinearProgress-bar': { bgcolor: COLORS.accent },
              }}
            />
          )}
          {error && (
            <Typography
              sx={{
                p: 1.5,
                fontSize: TYPOGRAPHY.size.base,
                color: COLORS.down,
                fontFamily: TYPOGRAPHY.monoFamily,
              }}
            >
              ERR: {error}
            </Typography>
          )}
          {paginatedRows && sortedRows && (
            <>
              <Box sx={{ maxHeight: 440, overflow: 'auto' }}>
                <Box
                  component="table"
                  sx={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontFamily: TYPOGRAPHY.sansFamily,
                  }}
                >
                  <Box component="thead">
                    <Box
                      component="tr"
                      sx={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 1,
                      }}
                    >
                      {columns.map((col) => {
                        const isSortable = col.sortable !== false;
                        const isActive = sortKey === col.key;
                        return (
                          <Box
                            component="th"
                            key={col.key}
                            onClick={isSortable ? () => handleSort(col.key) : undefined}
                            sx={{
                              textAlign: 'left',
                              px: 1,
                              py: 0.5,
                              bgcolor: COLORS.bg.panel,
                              borderBottom: `2px solid ${COLORS.borderAccent}`,
                              ...TYPOGRAPHY.uppercase,
                              fontSize: TYPOGRAPHY.size.xs,
                              color: COLORS.text.accent,
                              fontWeight: 700,
                              cursor: isSortable ? 'pointer' : 'default',
                              userSelect: 'none',
                              whiteSpace: 'nowrap',
                              '&:hover': isSortable ? { bgcolor: COLORS.bg.cellHover } : undefined,
                            }}
                          >
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                              {col.label}
                              {isActive &&
                                (sortDir === 'asc' ? (
                                  <ArrowDropUpIcon sx={{ fontSize: 14, color: COLORS.text.accent }} />
                                ) : (
                                  <ArrowDropDownIcon sx={{ fontSize: 14, color: COLORS.text.accent }} />
                                ))}
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                  <Box component="tbody">
                    {paginatedRows.length === 0 ? (
                      <Box component="tr">
                        <Box
                          component="td"
                          colSpan={columns.length}
                          sx={{
                            textAlign: 'center',
                            px: 1,
                            py: 3,
                            ...TYPOGRAPHY.uppercase,
                            fontSize: TYPOGRAPHY.size.xs,
                            color: COLORS.text.muted,
                          }}
                        >
                          Brak danych
                        </Box>
                      </Box>
                    ) : (
                      paginatedRows.map((row, idx) => (
                        <Box
                          component="tr"
                          key={idx}
                          sx={{
                            bgcolor: idx % 2 === 0 ? COLORS.bg.card : COLORS.bg.cardAlt,
                            '&:hover': { bgcolor: COLORS.bg.cellHover },
                            transition: 'background-color 0.08s',
                          }}
                        >
                          {columns.map((col) => (
                            <Box
                              component="td"
                              key={col.key}
                              sx={{
                                px: 1,
                                py: 0.625,
                                borderBottom: `1px solid ${COLORS.border}`,
                                fontSize: TYPOGRAPHY.size.base,
                                color: COLORS.text.primary,
                                lineHeight: 1.4,
                                verticalAlign: 'middle',
                              }}
                            >
                              {col.render ? col.render(row[col.key], row) : row[col.key] ?? '—'}
                            </Box>
                          ))}
                        </Box>
                      ))
                    )}
                  </Box>
                </Box>
              </Box>

              {/* ── PAGINATION ─────────────────────────────── */}
              {totalRows > 25 && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 1.5,
                    px: 1.5,
                    py: 0.5,
                    borderTop: `1px solid ${COLORS.border}`,
                    bgcolor: COLORS.bg.panel,
                    fontFamily: TYPOGRAPHY.monoFamily,
                    fontSize: TYPOGRAPHY.size.xs,
                    color: COLORS.text.secondary,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ ...TYPOGRAPHY.uppercase, fontSize: TYPOGRAPHY.size.xs, color: COLORS.text.secondary }}>
                      Wierszy:
                    </Box>
                    {[25, 50, 100].map((n) => (
                      <Box
                        key={n}
                        onClick={() => {
                          setRowsPerPage(n);
                          setPage(0);
                        }}
                        sx={{
                          px: 0.5,
                          cursor: 'pointer',
                          fontWeight: rowsPerPage === n ? 700 : 400,
                          color: rowsPerPage === n ? COLORS.text.accent : COLORS.text.secondary,
                          textDecoration: rowsPerPage === n ? 'underline' : 'none',
                          '&:hover': { color: COLORS.text.accent },
                        }}
                      >
                        {n}
                      </Box>
                    ))}
                  </Box>
                  <Box sx={{ color: COLORS.borderStrong }}>|</Box>
                  <Box>
                    {fromRow}-{toRow} z {totalRows.toLocaleString()}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.25 }}>
                    <Box
                      onClick={() => page > 0 && setPage(page - 1)}
                      sx={{
                        px: 0.75,
                        cursor: page > 0 ? 'pointer' : 'default',
                        color: page > 0 ? COLORS.text.accent : COLORS.text.muted,
                        userSelect: 'none',
                        '&:hover': page > 0 ? { bgcolor: COLORS.bg.cellHover } : undefined,
                      }}
                    >
                      &lsaquo;
                    </Box>
                    <Box
                      onClick={() => page < maxPage && setPage(page + 1)}
                      sx={{
                        px: 0.75,
                        cursor: page < maxPage ? 'pointer' : 'default',
                        color: page < maxPage ? COLORS.text.accent : COLORS.text.muted,
                        userSelect: 'none',
                        '&:hover': page < maxPage ? { bgcolor: COLORS.bg.cellHover } : undefined,
                      }}
                    >
                      &rsaquo;
                    </Box>
                  </Box>
                </Box>
              )}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
