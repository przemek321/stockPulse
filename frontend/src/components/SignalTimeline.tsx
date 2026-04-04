import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Chip, Autocomplete, TextField,
  ToggleButtonGroup, ToggleButton, Collapse, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { fetchTimeline, fetchTimelineSymbols, TimelineAlert, TimelineSummary, TimelineSymbol } from '../api';

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
  return `${Math.round(hours / 24)}d ${Math.round(hours % 24)}h`;
};

const DirectionArrow = ({ dir }: { dir: string | null }) => {
  if (dir === 'positive') return <span style={{ color: '#66bb6a', fontWeight: 700 }}>▲</span>;
  if (dir === 'negative') return <span style={{ color: '#ef5350', fontWeight: 700 }}>▼</span>;
  return <span style={{ color: '#999' }}>—</span>;
};

const HitBadge = ({ v }: { v: boolean | null }) => {
  if (v === true) return <span style={{ color: '#66bb6a' }}>&#10003;</span>;
  if (v === false) return <span style={{ color: '#ef5350' }}>&#10007;</span>;
  return <span style={{ color: '#666' }}>—</span>;
};

/** Dialog z pelna trescia alertu */
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

export default function SignalTimeline() {
  const [symbols, setSymbols] = useState<TimelineSymbol[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);
  const [alerts, setAlerts] = useState<TimelineAlert[]>([]);
  const [summary, setSummary] = useState<TimelineSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [dialogMsg, setDialogMsg] = useState<string | null>(null);

  // Zaladuj tickery z alertami
  useEffect(() => {
    fetchTimelineSymbols(days).then(d => setSymbols(d.symbols || [])).catch(() => {});
  }, [days]);

  // Zaladuj timeline gdy wybrany ticker
  const loadTimeline = useCallback(async (sym: string) => {
    setLoading(true);
    try {
      const data = await fetchTimeline(sym, days);
      setAlerts(data.alerts || []);
      setSummary(data.summary);
    } catch { setAlerts([]); setSummary(null); }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    if (selected) loadTimeline(selected);
  }, [selected, loadTimeline]);

  // Auto-refresh co 60s
  useEffect(() => {
    if (!selected) return;
    const interval = setInterval(() => loadTimeline(selected), 60_000);
    return () => clearInterval(interval);
  }, [selected, loadTimeline]);

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
        Signal Timeline — sekwencja sygnalw per ticker
      </Typography>

      {/* Kontrolki */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Autocomplete
          options={symbols}
          getOptionLabel={(o) => `${o.symbol} (${o.alertCount})`}
          onChange={(_, v) => setSelected(v?.symbol ?? null)}
          renderInput={(params) => <TextField {...params} label="Ticker" size="small" sx={{ minWidth: 200 }} />}
          sx={{ minWidth: 200 }}
        />
        <ToggleButtonGroup
          value={days}
          exclusive
          onChange={(_, v) => v && setDays(v)}
          size="small"
        >
          <ToggleButton value={7}>7d</ToggleButton>
          <ToggleButton value={14}>14d</ToggleButton>
          <ToggleButton value={30}>30d</ToggleButton>
          <ToggleButton value={60}>60d</ToggleButton>
          <ToggleButton value={90}>90d</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Summary bar */}
      {summary && selected && (
        <Box sx={{
          display: 'flex', gap: 2, mb: 2, p: 1.5, borderRadius: 1, flexWrap: 'wrap',
          bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <Typography variant="body2" fontWeight={600}>{selected}</Typography>
          <Typography variant="caption" color="text.secondary">
            {summary.totalAlerts} sygnalw / {days}d
          </Typography>
          {summary.directionConsistency != null && (
            <Chip
              size="small"
              label={`${summary.directionConsistency}% ${summary.dominantDirection === 'positive' ? 'bullish' : summary.dominantDirection === 'negative' ? 'bearish' : 'mixed'}`}
              color={summary.dominantDirection === 'positive' ? 'success' : summary.dominantDirection === 'negative' ? 'error' : 'default'}
              variant="outlined"
            />
          )}
          {summary.hitRate1d != null && (
            <Typography variant="caption" color="text.secondary">
              Hit rate 1d: <strong>{summary.hitRate1d}%</strong>
            </Typography>
          )}
          {summary.avgHoursBetween != null && (
            <Typography variant="caption" color="text.secondary">
              Avg gap: <strong>{fmtGap(summary.avgHoursBetween)}</strong>
            </Typography>
          )}
        </Box>
      )}

      {loading && <Typography variant="caption" color="text.secondary">Ladowanie...</Typography>}

      {!selected && !loading && (
        <Typography variant="caption" color="text.secondary">
          Wybierz ticker z listy powyzej
        </Typography>
      )}

      {/* Timeline alertow */}
      {alerts.map((a, i) => (
        <Box key={a.id}>
          {/* Gap separator */}
          {a.hoursSincePrev != null && (
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 1, my: 0.5, px: 1,
              borderLeft: '3px solid',
              borderColor: a.sameDirectionAsPrev === true ? 'rgba(102,187,106,0.5)' : a.sameDirectionAsPrev === false ? 'rgba(239,83,80,0.5)' : 'rgba(255,255,255,0.1)',
            }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                {fmtGap(a.hoursSincePrev)} gap
              </Typography>
              {a.priceDeltaFromPrevPct != null && (
                <Typography variant="caption" sx={{
                  fontSize: '0.65rem',
                  color: a.priceDeltaFromPrevPct > 0 ? '#66bb6a' : a.priceDeltaFromPrevPct < 0 ? '#ef5350' : '#999',
                }}>
                  cena {fmtDelta(a.priceDeltaFromPrevPct)} od poprzedniego
                </Typography>
              )}
              {a.sameDirectionAsPrev != null && (
                <Typography variant="caption" sx={{
                  fontSize: '0.65rem',
                  color: a.sameDirectionAsPrev ? '#66bb6a' : '#ef5350',
                }}>
                  {a.sameDirectionAsPrev ? '(zgodny)' : '(sprzeczny)'}
                </Typography>
              )}
            </Box>
          )}

          {/* Karta sygnalu */}
          <Box
            sx={{
              p: 1.5, mb: 0.5, borderRadius: 1, cursor: 'pointer',
              bgcolor: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
            }}
            onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
          >
            {/* Naglowek */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DirectionArrow dir={a.alertDirection} />
                <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.8rem' }}>
                  {a.ruleName}
                </Typography>
                {a.catalystType && (
                  <Chip label={a.catalystType} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                )}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                  {fmtDate(a.sentAt)}
                </Typography>
                {expandedId === a.id ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
              </Box>
            </Box>

            {/* Ceny */}
            {a.priceAtAlert && (
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
                  ${a.priceAtAlert.toFixed(2)}
                </Typography>
                {[
                  { label: '1h', val: a.price1h, base: a.priceAtAlert },
                  { label: '4h', val: a.price4h, base: a.priceAtAlert },
                  { label: '1d', val: a.price1d, base: a.priceAtAlert },
                  { label: '3d', val: a.price3d, base: a.priceAtAlert },
                ].map(({ label, val, base }) => {
                  if (val == null) return <Typography key={label} variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>{label}: —</Typography>;
                  const delta = ((val - base) / base) * 100;
                  return (
                    <Typography key={label} variant="caption" sx={{
                      fontSize: '0.65rem',
                      color: delta > 0 ? '#66bb6a' : delta < 0 ? '#ef5350' : '#999',
                    }}>
                      {label}: {fmtDelta(delta)}
                    </Typography>
                  );
                })}
                <Box sx={{ ml: 'auto' }}>
                  <HitBadge v={a.directionCorrect1d} />
                </Box>
              </Box>
            )}

            {/* Rozwiniety — pelna tresc */}
            <Collapse in={expandedId === a.id}>
              <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <Typography
                  variant="caption"
                  sx={{ fontSize: '0.7rem', color: '#80cbc4', cursor: 'pointer', textDecoration: 'underline dotted' }}
                  onClick={(e) => { e.stopPropagation(); setDialogMsg(a.message); }}
                >
                  Pokaz pelna tresc alertu
                </Typography>
              </Box>
            </Collapse>
          </Box>
        </Box>
      ))}

      {selected && !loading && alerts.length === 0 && (
        <Typography variant="caption" color="text.secondary">Brak alertow dla {selected} w ostatnich {days} dniach</Typography>
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
