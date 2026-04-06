import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Chip, Autocomplete, TextField,
  ToggleButtonGroup, ToggleButton, Collapse, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, LinearProgress,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { fetchTimeline, fetchRecentTimeline, fetchTimelineSymbols, TimelineAlert, TimelineSummary, TimelineSymbol } from '../api';

/* ── Pomocnicze formatery ─────────────────────────────── */

const fmtDate = (v: string) =>
  new Date(v).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const fmtDelta = (v: number | null) => {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
};

const fmtGap = (hours: number | null) => {
  if (hours == null) return '';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
};

const deltaColor = (v: number | null) =>
  v == null ? '#666' : v > 0 ? '#66bb6a' : v < 0 ? '#ef5350' : '#999';

/* ── Pasek wynikow cenowych (mini barki) ──────────────── */

const PriceOutcomeBar = ({ label, val, base, dir }: {
  label: string; val: number | null; base: number; dir: string | null;
}) => {
  if (val == null) return (
    <Box sx={{ textAlign: 'center', minWidth: 52 }}>
      <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#555' }}>{label}</Typography>
      <Typography variant="caption" sx={{ fontSize: '0.7rem', color: '#555', display: 'block' }}>—</Typography>
    </Box>
  );
  const delta = ((val - base) / base) * 100;
  // Hit = delta idzie w kierunku alertu
  const isHit = dir === 'positive' ? delta > 0 : dir === 'negative' ? delta < 0 : null;
  return (
    <Box sx={{ textAlign: 'center', minWidth: 52 }}>
      <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#888' }}>{label}</Typography>
      <Typography variant="caption" sx={{
        fontSize: '0.75rem', fontWeight: 700, display: 'block',
        color: deltaColor(delta),
      }}>
        {fmtDelta(delta)}
      </Typography>
      {isHit != null && (
        <Box sx={{
          width: '100%', height: 2, borderRadius: 1, mt: 0.3,
          bgcolor: isHit ? 'rgba(102,187,106,0.5)' : 'rgba(239,83,80,0.3)',
        }} />
      )}
    </Box>
  );
};

/* ── Conviction badge ─────────────────────────────────── */

const ConvictionBadge = ({ v }: { v: number }) => {
  const abs = Math.abs(v);
  let bg = 'rgba(255,255,255,0.06)';
  let border = 'rgba(255,255,255,0.12)';
  if (abs >= 0.7) { bg = 'rgba(239,83,80,0.15)'; border = 'rgba(239,83,80,0.4)'; }
  else if (abs >= 0.4) { bg = 'rgba(255,167,38,0.12)'; border = 'rgba(255,167,38,0.3)'; }
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', px: 0.8, py: 0.2,
      borderRadius: 1, bgcolor: bg, border: `1px solid ${border}`,
    }}>
      <Typography variant="caption" sx={{
        fontSize: '0.75rem', fontWeight: 700,
        color: v > 0 ? '#66bb6a' : v < 0 ? '#ef5350' : '#999',
      }}>
        {v > 0 ? '+' : ''}{v.toFixed(2)}
      </Typography>
    </Box>
  );
};

/* ── Hit / Miss duzy badge ────────────────────────────── */

const HitBadge = ({ v }: { v: boolean | null }) => {
  if (v === true) return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3, px: 0.6, py: 0.2, borderRadius: 1, bgcolor: 'rgba(102,187,106,0.12)', border: '1px solid rgba(102,187,106,0.3)' }}>
      <Typography variant="caption" sx={{ color: '#66bb6a', fontWeight: 700, fontSize: '0.7rem' }}>TRAFIONY</Typography>
    </Box>
  );
  if (v === false) return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3, px: 0.6, py: 0.2, borderRadius: 1, bgcolor: 'rgba(239,83,80,0.12)', border: '1px solid rgba(239,83,80,0.3)' }}>
      <Typography variant="caption" sx={{ color: '#ef5350', fontWeight: 700, fontSize: '0.7rem' }}>PUDLO</Typography>
    </Box>
  );
  return null;
};

/* ── Dialog z pelna trescia alertu ────────────────────── */

const MessageDialog = ({ message, open, onClose }: { message: string; open: boolean; onClose: () => void }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', pb: 1 }}>
        Szczegoly alertu
        <Box>
          <IconButton size="small" onClick={() => { navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
          {copied && <Chip label="Skopiowano" size="small" color="success" sx={{ ml: 1 }} />}
          <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', fontFamily: 'monospace' }}>{message}</pre>
      </DialogContent>
    </Dialog>
  );
};

/* ── Separator miedzy sygnalami ───────────────────────── */

const GapSeparator = ({ a }: { a: TimelineAlert }) => {
  if (a.hoursSincePrev == null) return null;
  const h = a.hoursSincePrev ?? 0;
  const isLongGap = h > 48;
  // Wizualny odstep proporcjonalny do czasu (min 1, max 4)
  const spacing = Math.min(4, Math.max(1, Math.round(h / 24) + 1));
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.5, my: spacing * 0.5, mx: 2,
    }}>
      <Box sx={{ flex: 1, height: '1px', bgcolor: 'rgba(255,255,255,0.08)' }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" sx={{
          fontSize: '0.75rem', color: isLongGap ? '#ff9800' : '#e0e0e0',
          fontWeight: 600,
        }}>
          {fmtGap(a.hoursSincePrev)}
        </Typography>
        {a.priceDeltaFromPrevPct != null && (
          <Typography variant="caption" sx={{
            fontSize: '0.7rem', fontWeight: 600,
            color: deltaColor(a.priceDeltaFromPrevPct),
          }}>
            {fmtDelta(a.priceDeltaFromPrevPct)}
          </Typography>
        )}
        {a.sameDirectionAsPrev != null && (
          <Chip
            label={a.sameDirectionAsPrev ? 'zgodny' : 'sprzeczny'}
            size="small"
            sx={{
              height: 16, fontSize: '0.6rem',
              bgcolor: a.sameDirectionAsPrev ? 'rgba(102,187,106,0.1)' : 'rgba(239,83,80,0.1)',
              color: a.sameDirectionAsPrev ? '#66bb6a' : '#ef5350',
              border: '1px solid',
              borderColor: a.sameDirectionAsPrev ? 'rgba(102,187,106,0.3)' : 'rgba(239,83,80,0.3)',
            }}
          />
        )}
      </Box>
      <Box sx={{ flex: 1, height: '1px', bgcolor: 'rgba(255,255,255,0.06)' }} />
    </Box>
  );
};

/* ── Karta sygnalu ────────────────────────────────────── */

const SignalCard = ({ a, expanded, onToggle, onShowMessage }: {
  a: TimelineAlert; expanded: boolean; onToggle: () => void; onShowMessage: () => void;
}) => {
  const isPositive = a.alertDirection === 'positive';
  const accentColor = isPositive ? '#66bb6a' : a.alertDirection === 'negative' ? '#ef5350' : '#999';

  return (
    <Box
      sx={{
        p: 1.5, mx: 0, borderRadius: 1.5, cursor: 'pointer',
        bgcolor: 'rgba(255,255,255,0.02)',
        borderLeft: `3px solid ${accentColor}`,
        border: '1px solid rgba(255,255,255,0.06)',
        borderLeftColor: accentColor,
        borderLeftWidth: 3,
        transition: 'background-color 0.15s',
        '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
      }}
      onClick={onToggle}
    >
      {/* Wiersz 1: typ sygnalu + conviction + data + hit */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.8 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: '#4fc3f7' }}>
            {a.symbol}
          </Typography>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: '#e0e0e0' }}>
            {a.ruleName}
          </Typography>
          {a.conviction != null && <ConvictionBadge v={a.conviction} />}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <HitBadge v={a.directionCorrect1d} />
          <Typography variant="caption" sx={{ fontSize: '0.75rem', color: '#888' }}>
            {fmtDate(a.sentAt)}
          </Typography>
          {expanded ? <ExpandLessIcon sx={{ fontSize: 16, color: '#666' }} /> : <ExpandMoreIcon sx={{ fontSize: 16, color: '#666' }} />}
        </Box>
      </Box>

      {/* Wiersz 2: cena + wyniki cenowe */}
      {a.priceAtAlert && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
          <Box sx={{ mr: 1.5 }}>
            <Typography variant="caption" sx={{ fontSize: '0.65rem', color: '#888' }}>Cena</Typography>
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#e0e0e0' }}>
              ${a.priceAtAlert.toFixed(2)}
            </Typography>
          </Box>
          <Box sx={{
            display: 'flex', gap: 0.5, flex: 1,
            p: 0.5, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.02)',
          }}>
            <PriceOutcomeBar label="1h" val={a.price1h} base={a.priceAtAlert} dir={a.alertDirection} />
            <PriceOutcomeBar label="4h" val={a.price4h} base={a.priceAtAlert} dir={a.alertDirection} />
            <PriceOutcomeBar label="1d" val={a.price1d} base={a.priceAtAlert} dir={a.alertDirection} />
            <PriceOutcomeBar label="3d" val={a.price3d} base={a.priceAtAlert} dir={a.alertDirection} />
          </Box>
        </Box>
      )}

      {/* Rozwiniety — catalyst + pelna tresc */}
      <Collapse in={expanded}>
        <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {a.catalystType && (
            <Chip label={a.catalystType} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
          )}
          {a.priority && (
            <Chip
              label={a.priority}
              size="small"
              sx={{
                height: 20, fontSize: '0.65rem', fontWeight: 600,
                bgcolor: a.priority === 'CRITICAL' ? 'rgba(239,83,80,0.15)' : 'rgba(255,167,38,0.1)',
                color: a.priority === 'CRITICAL' ? '#ef5350' : '#ff9800',
              }}
            />
          )}
          <Typography
            variant="caption"
            sx={{ fontSize: '0.7rem', color: '#80cbc4', cursor: 'pointer', textDecoration: 'underline dotted', ml: 'auto' }}
            onClick={(e) => { e.stopPropagation(); onShowMessage(); }}
          >
            Pokaz pelna tresc
          </Typography>
        </Box>
      </Collapse>
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
    } catch { setAlerts([]); setSummary(null); }
    setLoading(false);
  }, [selected, days]);

  // Laduj przy starcie (ostatnie alerty) i przy zmianie tickera/dni
  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh co 60s
  useEffect(() => {
    const interval = setInterval(loadData, 60_000);
    return () => clearInterval(interval);
  }, [loadData]);

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
        Signal Timeline
      </Typography>

      {/* Kontrolki */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Autocomplete
          options={symbols}
          getOptionLabel={(o) => `${o.symbol} (${o.alertCount})`}
          onChange={(_, v) => setSelected(v?.symbol ?? null)}
          renderInput={(params) => <TextField {...params} label="Ticker (wszystkie)" size="small" sx={{ minWidth: 220 }} />}
          sx={{ minWidth: 220 }}
        />
        <ToggleButtonGroup
          value={days}
          exclusive
          onChange={(_, v) => v && setDays(v)}
          size="small"
        >
          <ToggleButton value={7}>7D</ToggleButton>
          <ToggleButton value={14}>14D</ToggleButton>
          <ToggleButton value={30}>30D</ToggleButton>
          <ToggleButton value={60}>60D</ToggleButton>
          <ToggleButton value={90}>90D</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Summary bar */}
      {summary && selected && (
        <Box sx={{
          display: 'flex', gap: 3, mb: 2, p: 1.5, borderRadius: 1.5, alignItems: 'center', flexWrap: 'wrap',
          bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <Typography variant="body1" fontWeight={700} sx={{ fontSize: '1rem' }}>{selected}</Typography>
          <Box>
            <Typography variant="caption" sx={{ color: '#888', fontSize: '0.65rem' }}>Sygnaly</Typography>
            <Typography variant="body2" fontWeight={600}>{summary.totalAlerts}</Typography>
          </Box>
          {summary.directionConsistency != null && (
            <Box>
              <Typography variant="caption" sx={{ color: '#888', fontSize: '0.65rem' }}>Kierunek</Typography>
              <Typography variant="body2" fontWeight={600} sx={{
                color: summary.dominantDirection === 'positive' ? '#66bb6a' : summary.dominantDirection === 'negative' ? '#ef5350' : '#999',
              }}>
                {summary.directionConsistency}% {summary.dominantDirection === 'positive' ? 'BULL' : summary.dominantDirection === 'negative' ? 'BEAR' : 'MIX'}
              </Typography>
            </Box>
          )}
          {summary.hitRate1d != null && (
            <Box>
              <Typography variant="caption" sx={{ color: '#888', fontSize: '0.65rem' }}>Hit rate 1d</Typography>
              <Typography variant="body2" fontWeight={600} sx={{
                color: summary.hitRate1d >= 60 ? '#66bb6a' : summary.hitRate1d <= 40 ? '#ef5350' : '#ff9800',
              }}>
                {summary.hitRate1d}%
              </Typography>
            </Box>
          )}
          {summary.avgHoursBetween != null && (
            <Box>
              <Typography variant="caption" sx={{ color: '#888', fontSize: '0.65rem' }}>Avg gap</Typography>
              <Typography variant="body2" fontWeight={600}>{fmtGap(summary.avgHoursBetween)}</Typography>
            </Box>
          )}
        </Box>
      )}

      {loading && <LinearProgress sx={{ mb: 1, borderRadius: 1 }} />}

      {/* Widok domyślny ładuje ostatnie alerty — nie potrzeba "wybierz ticker" */}

      {/* Timeline alertow — sortowanie od najnowszych */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {[...alerts].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()).map((a) => (
          <Box key={a.id}>
            <GapSeparator a={a} />
            <SignalCard
              a={a}
              expanded={expandedId === a.id}
              onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
              onShowMessage={() => setDialogMsg(a.message)}
            />
          </Box>
        ))}
      </Box>

      {selected && !loading && alerts.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          Brak alertow dla {selected} w ostatnich {days} dniach
        </Typography>
      )}

      {/* Dialog z pelna trescia */}
      <MessageDialog
        message={dialogMsg || ''}
        open={dialogMsg != null}
        onClose={() => setDialogMsg(null)}
      />
    </Paper>
  );
}
