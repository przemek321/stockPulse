import { useState, useMemo, useCallback } from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { fetchAlertOutcomes, AlertOutcome } from '../api';
import { COLORS, TYPOGRAPHY, fmtPrice, fmtTimestamp, deltaColor } from '../theme/financial';

/** Renderowanie delty — monospace, kolor */
const renderDelta = (v: number | null) => {
  if (v == null) return <span style={{ color: COLORS.neutral, fontFamily: TYPOGRAPHY.monoFamily }}>—</span>;
  return (
    <span
      style={{
        color: deltaColor(v),
        fontWeight: 600,
        fontFamily: TYPOGRAPHY.monoFamily,
      }}
    >
      {v > 0 ? '+' : ''}
      {v.toFixed(2)}%
    </span>
  );
};

/** Kierunek BULL/BEAR */
const renderDirection = (v: string | null) => {
  if (!v) return <span style={{ color: COLORS.neutral }}>—</span>;
  const isUp = v === 'positive';
  return (
    <span
      style={{
        color: isUp ? COLORS.up : COLORS.down,
        fontWeight: 700,
        fontSize: TYPOGRAPHY.size.xs,
        letterSpacing: '0.5px',
      }}
    >
      {isUp ? '▲ BULL' : '▼ BEAR'}
    </span>
  );
};

/** Trafność OK/ERR */
const renderCorrect = (v: boolean | null) => {
  if (v == null) return <span style={{ color: COLORS.neutral }}>—</span>;
  return v ? (
    <span style={{ color: COLORS.up, fontWeight: 700 }}>OK</span>
  ) : (
    <span style={{ color: COLORS.down, fontWeight: 700 }}>ERR</span>
  );
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
 * Bloomberg-style Panel Trafność Alertów z grupowaniem po tickerze.
 * Klik na wiersz grupowy rozwija listę wszystkich alertów dla danego tickera.
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
        case 'symbol':
          cmp = a.symbol.localeCompare(b.symbol, 'pl');
          break;
        case 'count':
          cmp = a.count - b.count;
          break;
        case 'sentAt':
          cmp = new Date(a.latest.sentAt).getTime() - new Date(b.latest.sentAt).getTime();
          break;
        case 'priceAtAlert':
          cmp = Number(a.latest.priceAtAlert || 0) - Number(b.latest.priceAtAlert || 0);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [groups, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((p) => (p === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const toggleTicker = (symbol: string) => {
    setExpandedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  /** Zbierz płaską listę wierszy: wiersz grupowy + opcjonalnie rozwinięte alerty */
  const flatRows = useMemo(() => {
    const result: Array<
      { type: 'group'; group: TickerGroup } | { type: 'sub'; alert: AlertOutcome }
    > = [];
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

  /** Wspólny styl komórki tabeli */
  const tdSx = {
    px: 1,
    py: 0.625,
    borderBottom: `1px solid ${COLORS.border}`,
    fontSize: TYPOGRAPHY.size.base,
    color: COLORS.text.primary,
    verticalAlign: 'middle' as const,
  };

  /** Styl kolumn numerycznych */
  const tdNumSx = {
    ...tdSx,
    fontFamily: TYPOGRAPHY.monoFamily,
  };

  /** Header cell */
  const thSx = (key: SortKey | null, sortable: boolean) => ({
    textAlign: 'left' as const,
    px: 1,
    py: 0.5,
    bgcolor: COLORS.bg.panel,
    borderBottom: `2px solid ${COLORS.borderAccent}`,
    ...TYPOGRAPHY.uppercase,
    fontSize: TYPOGRAPHY.size.xs,
    color: COLORS.text.accent,
    fontWeight: 700,
    cursor: sortable ? 'pointer' : 'default',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
    '&:hover': sortable ? { bgcolor: COLORS.bg.cellHover } : undefined,
    position: 'sticky' as const,
    top: 0,
    zIndex: 1,
    ...(key && sortKey === key ? {} : {}),
  });

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === 'asc' ? (
      <ArrowDropUpIcon sx={{ fontSize: 14, color: COLORS.text.accent, verticalAlign: 'middle' }} />
    ) : (
      <ArrowDropDownIcon sx={{ fontSize: 14, color: COLORS.text.accent, verticalAlign: 'middle' }} />
    );
  };

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
      {/* ── HEADER BAR ────────────────────────────────── */}
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
          userSelect: 'none',
          '&:hover': { bgcolor: COLORS.bg.cellHover },
        }}
      >
        {expanded ? (
          <KeyboardArrowDownIcon sx={{ fontSize: 16, color: COLORS.text.accent }} />
        ) : (
          <KeyboardArrowRightIcon sx={{ fontSize: 16, color: COLORS.text.accent }} />
        )}
        <TrendingUpIcon sx={{ fontSize: 16, color: COLORS.up }} />
        <Typography
          sx={{
            ...TYPOGRAPHY.uppercase,
            fontSize: TYPOGRAPHY.size.sm,
            color: COLORS.text.accent,
            fontWeight: 700,
          }}
        >
          Trafność Alertów / Price Outcome
        </Typography>
        {rows && (
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
            {rows.length.toLocaleString()}
          </Box>
        )}
      </Box>

      {/* ── CONTENT ──────────────────────────────────── */}
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
          {rows && rows.length === 0 && !loading && (
            <Typography
              sx={{
                p: 3,
                textAlign: 'center',
                ...TYPOGRAPHY.uppercase,
                fontSize: TYPOGRAPHY.size.xs,
                color: COLORS.text.muted,
              }}
            >
              Brak danych
            </Typography>
          )}
          {flatRows.length > 0 && (
            <Box sx={{ maxHeight: 440, overflow: 'auto' }}>
              <Box
                component="table"
                sx={{ width: '100%', borderCollapse: 'collapse' }}
              >
                <Box component="thead">
                  <Box component="tr">
                    <Box component="th" onClick={() => handleSort('symbol')} sx={thSx('symbol', true)}>
                      Ticker {sortArrow('symbol')}
                    </Box>
                    <Box component="th" sx={thSx(null, false)}>
                      Reguła
                    </Box>
                    <Box component="th" sx={thSx(null, false)}>
                      Kierunek
                    </Box>
                    <Box
                      component="th"
                      onClick={() => handleSort('priceAtAlert')}
                      sx={thSx('priceAtAlert', true)}
                    >
                      Cena {sortArrow('priceAtAlert')}
                    </Box>
                    <Box component="th" sx={thSx(null, false)}>
                      +1h
                    </Box>
                    <Box component="th" sx={thSx(null, false)}>
                      +4h
                    </Box>
                    <Box component="th" sx={thSx(null, false)}>
                      +1d
                    </Box>
                    <Box component="th" sx={thSx(null, false)}>
                      +3d
                    </Box>
                    <Box component="th" sx={thSx(null, false)}>
                      Trafny
                    </Box>
                    <Box component="th" onClick={() => handleSort('sentAt')} sx={thSx('sentAt', true)}>
                      Data {sortArrow('sentAt')}
                    </Box>
                  </Box>
                </Box>
                <Box component="tbody">
                  {flatRows.map((row, idx) => {
                    if (row.type === 'group') {
                      const { group: g } = row;
                      const lt = g.latest;
                      const isOpen = expandedTickers.has(g.symbol);
                      const accuracyLabel =
                        g.evaluatedCount > 0 ? `${g.correctCount}/${g.evaluatedCount}` : null;
                      return (
                        <Box
                          component="tr"
                          key={`g-${g.symbol}`}
                          onClick={() => toggleTicker(g.symbol)}
                          sx={{
                            cursor: 'pointer',
                            bgcolor: idx % 2 === 0 ? COLORS.bg.card : COLORS.bg.cardAlt,
                            '&:hover': { bgcolor: COLORS.bg.cellHover },
                          }}
                        >
                          <Box
                            component="td"
                            sx={{
                              ...tdSx,
                              fontWeight: 700,
                              color: COLORS.text.accent,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {isOpen ? (
                              <KeyboardArrowDownIcon
                                sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.25, color: COLORS.text.accent }}
                              />
                            ) : (
                              <KeyboardArrowRightIcon
                                sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.25, color: COLORS.text.accent }}
                              />
                            )}
                            {g.symbol}
                            <span
                              style={{
                                color: COLORS.text.muted,
                                fontWeight: 400,
                                fontFamily: TYPOGRAPHY.monoFamily,
                                marginLeft: 4,
                              }}
                            >
                              ({g.count})
                            </span>
                          </Box>
                          <Box component="td" sx={{ ...tdSx, color: COLORS.text.muted }}>
                            —
                          </Box>
                          <Box component="td" sx={tdSx}>
                            {renderDirection(lt.alertDirection)}
                          </Box>
                          <Box component="td" sx={tdNumSx}>
                            {fmtPrice(lt.priceAtAlert ? Number(lt.priceAtAlert) : null)}
                          </Box>
                          <Box component="td" sx={tdNumSx}>
                            {renderDelta(lt.delta1h)}
                          </Box>
                          <Box component="td" sx={tdNumSx}>
                            {renderDelta(lt.delta4h)}
                          </Box>
                          <Box component="td" sx={tdNumSx}>
                            {renderDelta(lt.delta1d)}
                          </Box>
                          <Box component="td" sx={tdNumSx}>
                            {renderDelta(lt.delta3d)}
                          </Box>
                          <Box component="td" sx={tdNumSx}>
                            {accuracyLabel ? (
                              <span
                                style={{
                                  color: g.correctCount > 0 ? COLORS.up : COLORS.down,
                                  fontWeight: 600,
                                }}
                              >
                                {accuracyLabel}
                              </span>
                            ) : (
                              <span style={{ color: COLORS.neutral }}>—</span>
                            )}
                          </Box>
                          <Box component="td" sx={{ ...tdNumSx, color: COLORS.text.secondary }}>
                            {fmtTimestamp(lt.sentAt)}
                          </Box>
                        </Box>
                      );
                    }
                    /* Wiersz podrzędny — alert */
                    const { alert: a } = row;
                    return (
                      <Box
                        component="tr"
                        key={`s-${a.id}`}
                        sx={{
                          bgcolor: COLORS.bg.panel,
                          '&:hover': { bgcolor: COLORS.bg.cellHover },
                        }}
                      >
                        <Box component="td" sx={{ ...tdSx, pl: 3.5, color: COLORS.text.secondary }} />
                        <Box
                          component="td"
                          sx={{ ...tdSx, color: COLORS.text.secondary, fontSize: TYPOGRAPHY.size.xs }}
                        >
                          {a.ruleName?.replace(' Signal', '') || '—'}
                        </Box>
                        <Box component="td" sx={tdSx}>
                          {renderDirection(a.alertDirection)}
                        </Box>
                        <Box component="td" sx={{ ...tdNumSx, color: COLORS.text.secondary }}>
                          {fmtPrice(a.priceAtAlert ? Number(a.priceAtAlert) : null)}
                        </Box>
                        <Box component="td" sx={tdNumSx}>
                          {renderDelta(a.delta1h)}
                        </Box>
                        <Box component="td" sx={tdNumSx}>
                          {renderDelta(a.delta4h)}
                        </Box>
                        <Box component="td" sx={tdNumSx}>
                          {renderDelta(a.delta1d)}
                        </Box>
                        <Box component="td" sx={tdNumSx}>
                          {renderDelta(a.delta3d)}
                        </Box>
                        <Box component="td" sx={tdSx}>
                          {renderCorrect(a.directionCorrect)}
                        </Box>
                        <Box
                          component="td"
                          sx={{ ...tdNumSx, color: COLORS.text.muted, fontSize: TYPOGRAPHY.size.xs }}
                        >
                          {fmtTimestamp(a.sentAt)}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
