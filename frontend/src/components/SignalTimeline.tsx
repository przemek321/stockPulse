import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Autocomplete, TextField,
  ToggleButtonGroup, ToggleButton, Collapse, IconButton,
  Dialog, DialogTitle, DialogContent, LinearProgress, Chip, Link,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  fetchTimeline, fetchRecentTimeline, fetchTimelineSymbols,
  TimelineAlert, TimelineSummary, TimelineSymbol,
} from '../api';
import {
  COLORS, TYPOGRAPHY,
  labelSx, metricSx, panelSx,
  fmtPrice, fmtDelta, fmtTimestamp, deltaColor,
} from '../theme/financial';
import { nonDeliveryLabelShort } from '../utils/nonDeliveryLabel';

/* ── Pomocnicze ───────────────────────────────────────── */

const fmtShortTime = (v: string) => {
  const d = new Date(v);
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  const hr = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${mo}-${dy} ${hr}:${mn}`;
};

const fmtGap = (hours: number | null): string => {
  if (hours == null) return '';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  return h === 0 ? `${d}d` : `${d}d${h}h`;
};

/**
 * Skracanie nazw regul do kompaktowych etykiet kolumnowych
 */
const shortRule = (rule: string): string => {
  if (!rule) return '—';
  const r = rule.toLowerCase();
  if (r.includes('form 4') && r.includes('buy')) return 'Form4 BUY';
  if (r.includes('form 4')) return 'Form4';
  if (r.includes('8-k') && r.includes('material')) return '8-K Material';
  if (r.includes('8-k') && r.includes('earnings')) return '8-K Earnings';
  if (r.includes('8-k') && r.includes('leadership')) return '8-K Leadership';
  if (r.includes('8-k') && r.includes('bankruptcy')) return '8-K Bankruptcy';
  if (r.includes('8-k')) return '8-K';
  if (r.includes('correlated')) return 'Correlated';
  if (r.includes('unusual option')) return 'Options';
  if (r.includes('insider cluster')) return 'Cluster';
  if (rule.length > 18) return rule.slice(0, 17) + '…';
  return rule;
};

/**
 * Delta pct miedzy cena alertu a wynikiem (1h/4h/1d/3d)
 */
const calcDelta = (base: number | null, v: number | null): number | null => {
  if (base == null || v == null) return null;
  return ((v - base) / base) * 100;
};

/* ── Dialog z pelna trescia alertu ────────────────────── */

const MessageDialog = ({ message, open, onClose }: {
  message: string; open: boolean; onClose: () => void;
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        pb: 1, fontSize: TYPOGRAPHY.size.md, fontWeight: 700,
        bgcolor: COLORS.bg.header, color: COLORS.text.inverse,
      }}>
        SZCZEGOLY ALERTU
        <Box>
          <IconButton size="small" sx={{ color: COLORS.text.inverse }}
            onClick={() => {
              navigator.clipboard.writeText(message);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
          {copied && (
            <Chip label="Skopiowano" size="small"
              sx={{ ml: 1, bgcolor: COLORS.up, color: '#fff', height: 18, fontSize: TYPOGRAPHY.size.xs }} />
          )}
          <IconButton size="small" sx={{ color: COLORS.text.inverse }} onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 2, bgcolor: COLORS.bg.card }}>
        <pre style={{
          whiteSpace: 'pre-wrap',
          fontSize: TYPOGRAPHY.size.base,
          fontFamily: TYPOGRAPHY.monoFamily,
          color: COLORS.text.primary,
          margin: 0,
        }}>
          {message}
        </pre>
      </DialogContent>
    </Dialog>
  );
};

/* ── Konfiguracja kolumn tabeli ───────────────────────── */

type ColDef = { key: string; label: string; width: number; align?: 'left' | 'right' | 'center' };

const COLUMNS: ColDef[] = [
  { key: 'status', label: '', width: 4, align: 'left' },
  { key: 'time', label: 'TIME', width: 88, align: 'left' },
  { key: 'ticker', label: 'TCKR', width: 52, align: 'left' },
  { key: 'rule', label: 'RULE', width: 130, align: 'left' },
  { key: 'dir', label: 'DIR', width: 56, align: 'left' },
  { key: 'conv', label: 'CONV', width: 64, align: 'right' },
  { key: 'price', label: 'PRICE', width: 74, align: 'right' },
  { key: 'd1h', label: '1H', width: 58, align: 'right' },
  { key: 'd4h', label: '4H', width: 58, align: 'right' },
  { key: 'd1d', label: '1D', width: 58, align: 'right' },
  { key: 'd3d', label: '3D', width: 58, align: 'right' },
  { key: 'hit', label: 'HIT', width: 62, align: 'center' },
];

const TOTAL_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0);

/* ── Naglowek tabeli ──────────────────────────────────── */

const TableHeader = () => (
  <Box sx={{
    display: 'flex',
    bgcolor: COLORS.bg.panel,
    borderBottom: `1px solid ${COLORS.borderStrong}`,
    borderTop: `1px solid ${COLORS.border}`,
    minWidth: TOTAL_WIDTH,
    position: 'sticky',
    top: 0,
    zIndex: 2,
  }}>
    {COLUMNS.map((col) => (
      <Box key={col.key} sx={{
        width: col.width,
        minWidth: col.width,
        px: col.key === 'status' ? 0 : 1,
        py: 0.6,
        textAlign: col.align ?? 'left',
        ...TYPOGRAPHY.uppercase,
        color: COLORS.text.accent,
        fontSize: TYPOGRAPHY.size.xs,
        borderRight: col.key === 'status' ? 'none' : `1px solid ${COLORS.border}`,
      }}>
        {col.label}
      </Box>
    ))}
  </Box>
);

/* ── Wiersz tabeli ────────────────────────────────────── */

const SignalRow = ({ a, index, expanded, onToggle, onShowMessage }: {
  a: TimelineAlert;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onShowMessage: () => void;
}) => {
  const isPositive = a.alertDirection === 'positive';
  const isNegative = a.alertDirection === 'negative';
  const accentColor = isPositive ? COLORS.up : isNegative ? COLORS.down : COLORS.neutral;
  const dirLabel = isPositive ? 'BULL' : isNegative ? 'BEAR' : 'NEUT';
  const dirArrow = isPositive ? '▲' : isNegative ? '▼' : '●';

  const d1h = calcDelta(a.priceAtAlert, a.price1h);
  const d4h = calcDelta(a.priceAtAlert, a.price4h);
  const d1d = calcDelta(a.priceAtAlert, a.price1d);
  const d3d = calcDelta(a.priceAtAlert, a.price3d);

  const altBg = index % 2 === 0 ? COLORS.bg.card : COLORS.bg.cardAlt;
  const gapH = a.hoursSincePrev;
  const showGap = gapH != null && gapH > 5;

  const convAbs = a.conviction != null ? Math.abs(a.conviction) : 0;
  const convBadge = convAbs >= 0.5;
  const convBg = a.conviction == null
    ? 'transparent'
    : a.conviction > 0 ? COLORS.upBg : COLORS.downBg;

  // Komorka delty cenowej
  const DeltaCell = ({ v }: { v: number | null }) => (
    <Box sx={{
      width: 58, minWidth: 58, px: 1, py: 0.6,
      textAlign: 'right',
      fontFamily: TYPOGRAPHY.monoFamily,
      fontSize: TYPOGRAPHY.size.base,
      fontWeight: 600,
      color: deltaColor(v),
      borderRight: `1px solid ${COLORS.border}`,
    }}>
      {v == null ? '—' : fmtDelta(v)}
    </Box>
  );

  return (
    <>
      <Box
        onClick={onToggle}
        sx={{
          display: 'flex',
          minWidth: TOTAL_WIDTH,
          bgcolor: altBg,
          borderBottom: `1px solid ${COLORS.border}`,
          cursor: 'pointer',
          transition: 'background-color 0.1s',
          '&:hover': { bgcolor: COLORS.bg.cellHover },
        }}
      >
        {/* STATUS — pasek koloru */}
        <Box sx={{
          width: 4, minWidth: 4,
          bgcolor: accentColor,
        }} />

        {/* TIME */}
        <Box sx={{
          width: 88, minWidth: 88, px: 1, py: 0.6,
          fontFamily: TYPOGRAPHY.monoFamily,
          fontSize: TYPOGRAPHY.size.base,
          color: COLORS.text.secondary,
          borderRight: `1px solid ${COLORS.border}`,
          display: 'flex', flexDirection: 'column', lineHeight: 1.2,
        }}>
          <Box>{fmtShortTime(a.sentAt)}</Box>
          {showGap && (
            <Box sx={{
              fontSize: TYPOGRAPHY.size.xs,
              color: gapH! > 48 ? COLORS.warning : COLORS.text.muted,
            }}>
              (+{fmtGap(gapH)})
            </Box>
          )}
        </Box>

        {/* TICKER */}
        <Box sx={{
          width: 52, minWidth: 52, px: 1, py: 0.6,
          fontFamily: TYPOGRAPHY.sansFamily,
          fontSize: TYPOGRAPHY.size.md,
          fontWeight: 700,
          color: COLORS.text.accent,
          borderRight: `1px solid ${COLORS.border}`,
          textTransform: 'uppercase',
        }}>
          {a.symbol}
        </Box>

        {/* RULE */}
        <Box sx={{
          width: 130, minWidth: 130, px: 1, py: 0.6,
          fontSize: TYPOGRAPHY.size.base,
          color: COLORS.text.primary,
          borderRight: `1px solid ${COLORS.border}`,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }} title={a.ruleName}>
          {shortRule(a.ruleName)}
        </Box>

        {/* DIR */}
        <Box sx={{
          width: 56, minWidth: 56, px: 1, py: 0.6,
          fontSize: TYPOGRAPHY.size.base,
          fontWeight: 700,
          color: accentColor,
          borderRight: `1px solid ${COLORS.border}`,
          display: 'flex', alignItems: 'center', gap: 0.5,
        }}>
          <Box component="span" sx={{ fontSize: '0.7rem' }}>{dirArrow}</Box>
          {dirLabel}
        </Box>

        {/* CONV */}
        <Box sx={{
          width: 64, minWidth: 64, px: 1, py: 0.6,
          textAlign: 'right',
          borderRight: `1px solid ${COLORS.border}`,
        }}>
          {a.conviction != null ? (
            <Box
              component="span"
              sx={{
                display: 'inline-block',
                fontFamily: TYPOGRAPHY.monoFamily,
                fontSize: TYPOGRAPHY.size.base,
                fontWeight: 700,
                color: a.conviction > 0 ? COLORS.up : a.conviction < 0 ? COLORS.down : COLORS.neutral,
                px: convBadge ? 0.6 : 0,
                py: convBadge ? 0.1 : 0,
                bgcolor: convBadge ? convBg : 'transparent',
                border: convBadge ? `1px solid ${a.conviction > 0 ? COLORS.upBorder : COLORS.downBorder}` : 'none',
                borderRadius: '2px',
                minWidth: convBadge ? 42 : 'auto',
              }}
            >
              {a.conviction > 0 ? '+' : ''}{a.conviction.toFixed(2)}
            </Box>
          ) : (
            <Box component="span" sx={{
              fontFamily: TYPOGRAPHY.monoFamily,
              fontSize: TYPOGRAPHY.size.base,
              color: COLORS.text.muted,
            }}>—</Box>
          )}
        </Box>

        {/* PRICE */}
        <Box sx={{
          width: 74, minWidth: 74, px: 1, py: 0.6,
          textAlign: 'right',
          fontFamily: TYPOGRAPHY.monoFamily,
          fontSize: TYPOGRAPHY.size.base,
          fontWeight: 600,
          color: COLORS.text.primary,
          borderRight: `1px solid ${COLORS.border}`,
        }}>
          {fmtPrice(a.priceAtAlert)}
        </Box>

        {/* DELTY */}
        <DeltaCell v={d1h} />
        <DeltaCell v={d4h} />
        <DeltaCell v={d1d} />
        <DeltaCell v={d3d} />

        {/* HIT */}
        <Box sx={{
          width: 62, minWidth: 62, px: 0.5, py: 0.6,
          textAlign: 'center',
        }}>
          {a.directionCorrect1d === true && (
            <Box component="span" sx={{
              display: 'inline-block', px: 0.6, py: 0.1,
              bgcolor: COLORS.upBg,
              border: `1px solid ${COLORS.upBorder}`,
              borderRadius: '2px',
              color: COLORS.up,
              fontSize: TYPOGRAPHY.size.xs,
              fontWeight: 700,
              letterSpacing: '0.3px',
            }}>
              HIT
            </Box>
          )}
          {a.directionCorrect1d === false && (
            <Box component="span" sx={{
              display: 'inline-block', px: 0.6, py: 0.1,
              bgcolor: COLORS.downBg,
              border: `1px solid ${COLORS.downBorder}`,
              borderRadius: '2px',
              color: COLORS.down,
              fontSize: TYPOGRAPHY.size.xs,
              fontWeight: 700,
              letterSpacing: '0.3px',
            }}>
              MISS
            </Box>
          )}
          {a.directionCorrect1d == null && (
            <Box component="span" sx={{
              fontSize: TYPOGRAPHY.size.base,
              color: COLORS.text.muted,
              fontFamily: TYPOGRAPHY.monoFamily,
            }}>—</Box>
          )}
        </Box>
      </Box>

      {/* Collapse — rozwijane szczegoly */}
      <Collapse in={expanded} unmountOnExit>
        <Box sx={{
          minWidth: TOTAL_WIDTH,
          bgcolor: COLORS.bg.panel,
          borderBottom: `1px solid ${COLORS.borderStrong}`,
          borderTop: `2px solid ${COLORS.borderAccent}`,
          px: 2, py: 1.5,
          display: 'flex',
          gap: 3,
        }}>
          {/* Lewa kolumna — metadane */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8, minWidth: 200 }}>
            <Box>
              <Typography sx={labelSx}>CATALYST</Typography>
              <Typography sx={{
                fontSize: TYPOGRAPHY.size.md,
                fontWeight: 600,
                color: COLORS.text.primary,
              }}>
                {a.catalystType || '—'}
              </Typography>
            </Box>
            <Box>
              <Typography sx={labelSx}>PRIORITY</Typography>
              <Typography sx={{
                fontSize: TYPOGRAPHY.size.md,
                fontWeight: 700,
                // TASK-05: observation/silent/etc. → przytłumiony kolor
                color: a.nonDeliveryReason
                     ? COLORS.text.secondary
                     : a.priority === 'CRITICAL' ? COLORS.down
                     : a.priority === 'HIGH' ? COLORS.warning
                     : COLORS.text.primary,
              }}>
                {a.priority || '—'}
                {a.nonDeliveryReason && (
                  <Typography component="span" sx={{ fontSize: TYPOGRAPHY.size.xs, ml: 0.5, fontWeight: 400, color: COLORS.text.secondary }}>
                    ({nonDeliveryLabelShort(a.nonDeliveryReason)})
                  </Typography>
                )}
              </Typography>
            </Box>
            <Box>
              <Typography sx={labelSx}>FULL TIMESTAMP</Typography>
              <Typography sx={{
                fontSize: TYPOGRAPHY.size.base,
                fontFamily: TYPOGRAPHY.monoFamily,
                color: COLORS.text.primary,
              }}>
                {fmtTimestamp(a.sentAt)}
              </Typography>
            </Box>
            <Box>
              <Typography sx={labelSx}>RULE (FULL)</Typography>
              <Typography sx={{
                fontSize: TYPOGRAPHY.size.base,
                color: COLORS.text.primary,
              }}>
                {a.ruleName}
              </Typography>
            </Box>
          </Box>

          {/* Prawa kolumna — message preview */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5,
            }}>
              <Typography sx={labelSx}>MESSAGE</Typography>
              <Link
                component="button"
                onClick={(e) => { e.stopPropagation(); onShowMessage(); }}
                sx={{
                  ...TYPOGRAPHY.uppercase,
                  color: COLORS.accent,
                  textDecoration: 'underline dotted',
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                  p: 0,
                }}
              >
                POKAZ PELNA TRESC
              </Link>
            </Box>
            <Box sx={{
              fontSize: TYPOGRAPHY.size.base,
              fontFamily: TYPOGRAPHY.monoFamily,
              color: COLORS.text.primary,
              bgcolor: COLORS.bg.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '2px',
              p: 1,
              maxHeight: 120,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'pre-wrap',
              display: '-webkit-box',
              WebkitLineClamp: 5,
              WebkitBoxOrient: 'vertical',
            }}>
              {a.message}
            </Box>
          </Box>
        </Box>
      </Collapse>
    </>
  );
};

/* ── Summary bar (Bloomberg status line) ──────────────── */

const SummaryBar = ({ selected, summary }: {
  selected: string; summary: TimelineSummary;
}) => {
  const dominantColor =
    summary.dominantDirection === 'positive' ? COLORS.up
    : summary.dominantDirection === 'negative' ? COLORS.down
    : COLORS.neutral;
  const dominantLabel =
    summary.dominantDirection === 'positive' ? 'BULL'
    : summary.dominantDirection === 'negative' ? 'BEAR'
    : 'MIX';

  const hitRateColor =
    summary.hitRate1d == null ? COLORS.neutral
    : summary.hitRate1d >= 60 ? COLORS.up
    : summary.hitRate1d <= 40 ? COLORS.down
    : COLORS.warning;

  const Cell = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <Box sx={{
      px: 1.5, py: 0.8,
      borderRight: `1px solid ${COLORS.border}`,
      minWidth: 90,
    }}>
      <Typography sx={labelSx}>{label}</Typography>
      <Typography sx={{
        ...metricSx,
        color: color ?? COLORS.text.primary,
        fontSize: TYPOGRAPHY.size.md,
      }}>
        {value}
      </Typography>
    </Box>
  );

  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'stretch',
      bgcolor: COLORS.bg.panel,
      border: `1px solid ${COLORS.borderStrong}`,
      borderLeft: `3px solid ${COLORS.borderAccent}`,
      borderRadius: '2px',
      mb: 1,
      overflowX: 'auto',
    }}>
      <Cell label="TICKER" value={selected} color={COLORS.text.accent} />
      <Cell label="SIGNALS" value={String(summary.totalAlerts)} />
      <Cell
        label="DOMINANT"
        value={summary.directionConsistency != null
          ? `${dominantLabel} ${summary.directionConsistency}%`
          : dominantLabel}
        color={dominantColor}
      />
      <Cell
        label="HIT RATE 1D"
        value={summary.hitRate1d != null ? `${summary.hitRate1d}%` : '—'}
        color={hitRateColor}
      />
      <Cell
        label="AVG GAP"
        value={summary.avgHoursBetween != null ? fmtGap(summary.avgHoursBetween) : '—'}
      />
    </Box>
  );
};

/* ── Glowny komponent ─────────────────────────────────── */

export default function SignalTimeline() {
  const [symbols, setSymbols] = useState<TimelineSymbol[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [days, setDays] = useState<number>(7);
  const [alerts, setAlerts] = useState<TimelineAlert[]>([]);
  const [summary, setSummary] = useState<TimelineSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [dialogMsg, setDialogMsg] = useState<string | null>(null);

  // Zaladuj tickery z alertami
  useEffect(() => {
    fetchTimelineSymbols(days).then(d => setSymbols(d.symbols || [])).catch(() => {});
  }, [days]);

  // Zaladuj dane — per ticker lub ostatnie ze wszystkich
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = selected
        ? await fetchTimeline(selected, days)
        : await fetchRecentTimeline(days, 30);
      setAlerts(data.alerts || []);
      setSummary(data.summary);
    } catch {
      setAlerts([]);
      setSummary(null);
    }
    setLoading(false);
  }, [selected, days]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh co 60s
  useEffect(() => {
    const interval = setInterval(loadData, 60_000);
    return () => clearInterval(interval);
  }, [loadData]);

  const sortedAlerts = [...alerts].sort(
    (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
  );

  return (
    <Box sx={{ ...panelSx, p: 0, mb: 2, overflow: 'hidden' }}>
      {/* Header bar */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 1.5, py: 0.8,
        bgcolor: COLORS.bg.header,
        color: COLORS.text.inverse,
        borderBottom: `2px solid ${COLORS.accent}`,
      }}>
        <Typography sx={{
          ...TYPOGRAPHY.uppercase,
          fontSize: TYPOGRAPHY.size.md,
          color: COLORS.text.inverse,
          letterSpacing: '1px',
        }}>
          SIGNAL TIMELINE
        </Typography>
        <Typography sx={{
          ...TYPOGRAPHY.uppercase,
          fontSize: TYPOGRAPHY.size.xs,
          color: COLORS.text.inverse,
          opacity: 0.7,
        }}>
          {sortedAlerts.length} ROWS · {days}D
        </Typography>
      </Box>

      {/* Filters bar */}
      <Box sx={{
        display: 'flex',
        gap: 1.5,
        alignItems: 'center',
        flexWrap: 'wrap',
        px: 1.5, py: 1,
        bgcolor: COLORS.bg.panel,
        borderBottom: `1px solid ${COLORS.border}`,
      }}>
        <Typography sx={{ ...labelSx, mr: 0.5 }}>TICKER</Typography>
        <Autocomplete
          options={symbols}
          value={symbols.find(s => s.symbol === selected) ?? null}
          getOptionLabel={(o) => `${o.symbol} (${o.alertCount})`}
          isOptionEqualToValue={(a, b) => a.symbol === b.symbol}
          onChange={(_, v) => setSelected(v?.symbol ?? null)}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="WSZYSTKIE"
              size="small"
              sx={{
                '& .MuiInputBase-root': {
                  fontSize: TYPOGRAPHY.size.base,
                  fontFamily: TYPOGRAPHY.sansFamily,
                  bgcolor: COLORS.bg.card,
                  borderRadius: '2px',
                  minHeight: 30,
                },
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: COLORS.border,
                },
              }}
            />
          )}
          sx={{ minWidth: 200 }}
        />
        {selected && (
          <Link
            component="button"
            onClick={() => setSelected(null)}
            sx={{
              ...TYPOGRAPHY.uppercase,
              color: COLORS.accent,
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              textDecoration: 'underline dotted',
              p: 0,
            }}
          >
            RESET
          </Link>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ ...labelSx, mr: 0.5 }}>PERIOD</Typography>
        <ToggleButtonGroup
          value={days}
          exclusive
          onChange={(_, v) => v && setDays(v)}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              fontSize: TYPOGRAPHY.size.xs,
              fontFamily: TYPOGRAPHY.sansFamily,
              fontWeight: 700,
              letterSpacing: '0.5px',
              px: 1.2,
              py: 0.3,
              minWidth: 38,
              color: COLORS.text.secondary,
              borderColor: COLORS.border,
              borderRadius: '2px',
              '&.Mui-selected': {
                bgcolor: COLORS.bg.header,
                color: COLORS.text.inverse,
                '&:hover': { bgcolor: COLORS.bg.headerAlt },
              },
            },
          }}
        >
          <ToggleButton value={7}>7D</ToggleButton>
          <ToggleButton value={14}>14D</ToggleButton>
          <ToggleButton value={30}>30D</ToggleButton>
          <ToggleButton value={60}>60D</ToggleButton>
          <ToggleButton value={90}>90D</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Summary bar gdy wybrany ticker */}
      {summary && selected && (
        <Box sx={{ px: 1.5, pt: 1 }}>
          <SummaryBar selected={selected} summary={summary} />
        </Box>
      )}

      {loading && <LinearProgress sx={{ height: 2 }} />}

      {/* Tabela sygnalow */}
      <Box sx={{ overflowX: 'auto' }}>
        <TableHeader />
        <Box>
          {sortedAlerts.map((a, i) => (
            <SignalRow
              key={a.id}
              a={a}
              index={i}
              expanded={expandedId === a.id}
              onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
              onShowMessage={() => setDialogMsg(a.message)}
            />
          ))}
        </Box>
      </Box>

      {/* Empty state */}
      {!loading && sortedAlerts.length === 0 && (
        <Box sx={{
          py: 4, textAlign: 'center',
          bgcolor: COLORS.bg.card,
          borderTop: `1px solid ${COLORS.border}`,
        }}>
          <Typography sx={{
            ...TYPOGRAPHY.uppercase,
            color: COLORS.text.muted,
            fontSize: TYPOGRAPHY.size.sm,
          }}>
            {selected
              ? `BRAK ALERTOW DLA ${selected} · ${days}D`
              : `BRAK ALERTOW · ${days}D`}
          </Typography>
        </Box>
      )}

      {/* Dialog z pelna trescia */}
      <MessageDialog
        message={dialogMsg || ''}
        open={dialogMsg != null}
        onClose={() => setDialogMsg(null)}
      />
    </Box>
  );
}
