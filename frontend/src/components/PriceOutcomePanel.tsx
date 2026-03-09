import React, { useState, useMemo, useCallback } from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  CircularProgress,
  Paper,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { fetchAlertOutcomes, AlertOutcome } from '../api';

/** Formatowanie daty */
const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/** Renderowanie delty */
const renderDelta = (v: number | null) => {
  if (v == null) return <span style={{ color: '#757575' }}>—</span>;
  const color = v > 0 ? '#66bb6a' : v < 0 ? '#ef5350' : '#90a4ae';
  return <span style={{ color, fontWeight: 600 }}>{v > 0 ? '+' : ''}{v}%</span>;
};

/** Kierunek BULL/BEAR */
const renderDirection = (v: string | null) => {
  if (!v) return '—';
  const color = v === 'positive' ? '#66bb6a' : '#ef5350';
  return <span style={{ color, fontWeight: 700 }}>{v === 'positive' ? '▲ BULL' : '▼ BEAR'}</span>;
};

/** Trafność ✓/✗ */
const renderCorrect = (v: boolean | null) => {
  if (v == null) return <span style={{ color: '#757575' }}>—</span>;
  return v
    ? <span style={{ color: '#66bb6a', fontWeight: 700 }}>✓</span>
    : <span style={{ color: '#ef5350', fontWeight: 700 }}>✗</span>;
};

/** Grupa alertów per ticker */
interface TickerGroup {
  symbol: string;
  count: number;
  latest: AlertOutcome;
  alerts: AlertOutcome[];
  correctCount: number;
  evaluatedCount: number;
}

type SortKey = 'symbol' | 'count' | 'sentAt' | 'priceAtAlert';
type SortDir = 'asc' | 'desc';

/**
 * Panel Trafność Alertów z grupowaniem po tickerze.
 * Klik na wiersz rozwija listę wszystkich alertów dla danego tickera.
 */
export default function PriceOutcomePanel() {
  const [rows, setRows] = useState<AlertOutcome[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [expandedTickers, setExpandedTickers] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('sentAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleToggle = useCallback(async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && rows === null) {
      setLoading(true);
      try {
        const data = await fetchAlertOutcomes(200);
        setRows(data.outcomes || []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
  }, [expanded, rows]);

  /** Grupowanie po tickerze */
  const groups: TickerGroup[] = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, AlertOutcome[]>();
    for (const r of rows) {
      const arr = map.get(r.symbol) || [];
      arr.push(r);
      map.set(r.symbol, arr);
    }
    return Array.from(map.entries()).map(([symbol, alerts]) => {
      const sorted = [...alerts].sort(
        (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
      );
      const evaluated = alerts.filter((a) => a.directionCorrect != null);
      return {
        symbol,
        count: alerts.length,
        latest: sorted[0],
        alerts: sorted,
        correctCount: evaluated.filter((a) => a.directionCorrect === true).length,
        evaluatedCount: evaluated.length,
      };
    });
  }, [rows]);

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'symbol': cmp = a.symbol.localeCompare(b.symbol, 'pl'); break;
        case 'count': cmp = a.count - b.count; break;
        case 'sentAt': cmp = new Date(a.latest.sentAt).getTime() - new Date(b.latest.sentAt).getTime(); break;
        case 'priceAtAlert': cmp = Number(a.latest.priceAtAlert || 0) - Number(b.latest.priceAtAlert || 0); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [groups, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((p) => (p === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const toggleTicker = (symbol: string) => {
    setExpandedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      return next;
    });
  };

  /** Zbierz płaską listę wierszy: wiersz grupowy + opcjonalnie rozwinięte alerty */
  const flatRows = useMemo(() => {
    const result: Array<{ type: 'group'; group: TickerGroup } | { type: 'sub'; alert: AlertOutcome }> = [];
    for (const g of sortedGroups) {
      result.push({ type: 'group', group: g });
      if (expandedTickers.has(g.symbol)) {
        for (const a of g.alerts) {
          result.push({ type: 'sub', alert: a });
        }
      }
    }
    return result;
  }, [sortedGroups, expandedTickers]);

  const hsx = { fontWeight: 700, bgcolor: 'background.paper' };

  return (
    <Accordion
      expanded={expanded}
      onChange={handleToggle}
      sx={{ '&:before': { display: 'none' }, borderRadius: '8px !important', mb: 1.5, overflow: 'hidden' }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <TrendingUpIcon sx={{ color: '#66bb6a' }} />
          <Typography fontWeight={600}>Trafność Alertów (Price Outcome)</Typography>
        </Box>
      </AccordionSummary>

      <AccordionDetails sx={{ p: 0 }}>
        {loading && <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={28} /></Box>}
        {error && <Typography color="error" sx={{ p: 2 }}>{error}</Typography>}
        {flatRows.length > 0 && (
          <TableContainer component={Paper} sx={{ maxHeight: 420 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={hsx}>
                    <TableSortLabel active={sortKey === 'symbol'} direction={sortKey === 'symbol' ? sortDir : 'desc'} onClick={() => handleSort('symbol')}>
                      Ticker
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={hsx}>Reguła</TableCell>
                  <TableCell sx={hsx}>Kierunek</TableCell>
                  <TableCell sx={hsx}>
                    <TableSortLabel active={sortKey === 'priceAtAlert'} direction={sortKey === 'priceAtAlert' ? sortDir : 'desc'} onClick={() => handleSort('priceAtAlert')}>
                      Cena alertu
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={hsx}>+1h%</TableCell>
                  <TableCell sx={hsx}>+4h%</TableCell>
                  <TableCell sx={hsx}>+1d%</TableCell>
                  <TableCell sx={hsx}>+3d%</TableCell>
                  <TableCell sx={hsx}>Trafny?</TableCell>
                  <TableCell sx={hsx}>
                    <TableSortLabel active={sortKey === 'sentAt'} direction={sortKey === 'sentAt' ? sortDir : 'desc'} onClick={() => handleSort('sentAt')}>
                      Data
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {flatRows.map((row, idx) => {
                  if (row.type === 'group') {
                    const { group: g } = row;
                    const lt = g.latest;
                    const isOpen = expandedTickers.has(g.symbol);
                    const accuracyLabel = g.evaluatedCount > 0 ? `${g.correctCount}/${g.evaluatedCount}` : null;
                    return (
                      <TableRow
                        key={`g-${g.symbol}`}
                        hover
                        sx={{ cursor: 'pointer', '& td': { borderBottom: isOpen ? 'none' : undefined } }}
                        onClick={() => toggleTicker(g.symbol)}
                      >
                        <TableCell sx={{ fontSize: '0.8rem', fontWeight: 700 }}>
                          {isOpen
                            ? <KeyboardArrowDownIcon sx={{ fontSize: 16, verticalAlign: 'middle', mr: 0.5 }} />
                            : <KeyboardArrowRightIcon sx={{ fontSize: 16, verticalAlign: 'middle', mr: 0.5 }} />}
                          {g.symbol}
                          <span style={{ color: '#90a4ae', fontWeight: 400 }}> ({g.count})</span>
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.8rem', color: '#90a4ae' }}>—</TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>{renderDirection(lt.alertDirection)}</TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>{lt.priceAtAlert ? `$${Number(lt.priceAtAlert).toFixed(2)}` : '—'}</TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>{renderDelta(lt.delta1h)}</TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>{renderDelta(lt.delta4h)}</TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>{renderDelta(lt.delta1d)}</TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>{renderDelta(lt.delta3d)}</TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>
                          {accuracyLabel
                            ? <span style={{ color: g.correctCount > 0 ? '#66bb6a' : '#ef5350', fontWeight: 600 }}>{accuracyLabel}</span>
                            : <span style={{ color: '#757575' }}>—</span>}
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>{fmtDate(lt.sentAt)}</TableCell>
                      </TableRow>
                    );
                  }
                  /* Wiersz podrzędny — alert */
                  const { alert: a } = row;
                  return (
                    <TableRow key={`s-${a.id}`} sx={{ bgcolor: 'rgba(255,255,255,0.02)' }}>
                      <TableCell sx={{ fontSize: '0.75rem', color: '#78909c', pl: 5 }} />
                      <TableCell sx={{ fontSize: '0.75rem', color: '#b0bec5' }}>{a.ruleName?.replace(' Signal', '') || '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', color: '#b0bec5' }}>{renderDirection(a.alertDirection)}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', color: '#b0bec5' }}>{a.priceAtAlert ? `$${Number(a.priceAtAlert).toFixed(2)}` : '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>{renderDelta(a.delta1h)}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>{renderDelta(a.delta4h)}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>{renderDelta(a.delta1d)}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>{renderDelta(a.delta3d)}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>{renderCorrect(a.directionCorrect)}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', color: '#b0bec5' }}>{fmtDate(a.sentAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {rows && rows.length === 0 && (
          <Typography sx={{ p: 2, textAlign: 'center', color: '#757575' }}>Brak danych</Typography>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
