import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  Collapse,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { fetchSystemOverview, SystemOverview, CollectorHealth, SystemError } from '../api';
import {
  COLORS,
  TYPOGRAPHY,
  labelSx,
  panelSx,
  fmtTimestamp,
  fmtRelative,
  statusColor,
  type Status,
} from '../theme/financial';

/** Mapowanie API status → terminal status */
const toTermStatus = (s: string): Status => {
  if (s === 'OK' || s === 'HEALTHY') return 'OK';
  if (s === 'WARNING') return 'STALE';
  if (s === 'CRITICAL' || s === 'ERROR') return 'ERR';
  return 'OFF';
};

/** Krótkie nazwy źródeł dla gęstego layoutu */
const SHORT_NAMES: Record<string, string> = {
  SEC_EDGAR: 'SEC EDGAR',
  PDUFA_BIO: 'PDUFA',
  POLYGON: 'POLYGON',
};

/** Pojedyncza mini-karta kolektora (Bloomberg style) */
function CollectorTile({ c }: { c: CollectorHealth }) {
  const status = toTermStatus(c.status);
  const color = statusColor(status);
  const name = SHORT_NAMES[c.source] || c.source;

  return (
    <Box
      sx={{
        display: 'flex',
        bgcolor: COLORS.bg.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: '2px',
        minHeight: 56,
        overflow: 'hidden',
      }}
    >
      {/* Lewy kolorowy pasek */}
      <Box sx={{ width: 4, bgcolor: color, flexShrink: 0 }} />

      {/* Zawartość */}
      <Box sx={{ flex: 1, px: 1, py: 0.5, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography
            sx={{
              ...TYPOGRAPHY.uppercase,
              color: COLORS.text.accent,
              fontSize: TYPOGRAPHY.size.sm,
              fontWeight: TYPOGRAPHY.weight.bold,
            }}
          >
            {name}
          </Typography>
          <Typography
            sx={{
              fontFamily: TYPOGRAPHY.monoFamily,
              fontSize: TYPOGRAPHY.size.xs,
              fontWeight: TYPOGRAPHY.weight.bold,
              color,
              letterSpacing: '0.5px',
            }}
          >
            {status}
          </Typography>
        </Box>

        <Box
          sx={{
            display: 'flex',
            gap: 1.5,
            mt: 0.25,
            fontFamily: TYPOGRAPHY.monoFamily,
            fontSize: TYPOGRAPHY.size.xs,
            color: COLORS.text.secondary,
          }}
        >
          <Box component="span">
            items:&nbsp;
            <Box component="span" sx={{ color: COLORS.text.primary, fontWeight: 600 }}>
              {c.lastItemsCollected}
            </Box>
          </Box>
          <Box component="span">
            last:&nbsp;
            <Box component="span" sx={{ color: COLORS.text.primary, fontWeight: 600 }}>
              {fmtRelative(c.lastRunAt)}
            </Box>
          </Box>
          {c.errorsLast24h > 0 && (
            <Box component="span" sx={{ color: COLORS.down, fontWeight: 600 }}>
              err24h:&nbsp;{c.errorsLast24h}
            </Box>
          )}
        </Box>

        {c.lastError && (
          <Tooltip title={c.lastError} arrow>
            <Typography
              sx={{
                fontSize: TYPOGRAPHY.size.xs,
                color: COLORS.down,
                mt: 0.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {c.lastError}
            </Typography>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}

/** Horizontalny stat: LABEL VALUE */
function StatPair({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
      <Typography sx={labelSx}>{label}</Typography>
      <Typography
        sx={{
          fontFamily: TYPOGRAPHY.monoFamily,
          fontSize: TYPOGRAPHY.size.md,
          fontWeight: TYPOGRAPHY.weight.bold,
          color: color || COLORS.text.primary,
          lineHeight: 1.2,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

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
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading && !data)
    return (
      <Box sx={{ ...panelSx, mb: 1.5 }}>
        <Typography sx={{ ...labelSx, color: COLORS.text.muted }}>LOADING STATUS...</Typography>
      </Box>
    );
  if (error && !data)
    return (
      <Box sx={{ ...panelSx, mb: 1.5 }}>
        <Typography sx={{ ...labelSx, color: COLORS.down }}>ERR: {error}</Typography>
      </Box>
    );
  if (!data) return null;

  const overallStatus = toTermStatus(data.overall);
  const overallColor = statusColor(overallStatus);

  return (
    <Box sx={{ ...panelSx, mb: 1.5, p: 1 }}>
      {/* Nagłówek */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 1,
          pb: 0.75,
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ ...labelSx, color: COLORS.text.accent, fontSize: TYPOGRAPHY.size.sm }}>
            SYSTEM STATUS
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 0.75,
              py: 0.15,
              border: `1px solid ${overallColor}`,
              borderRadius: '2px',
            }}
          >
            <Box sx={{ width: 6, height: 6, bgcolor: overallColor, borderRadius: '50%' }} />
            <Typography
              sx={{
                fontFamily: TYPOGRAPHY.monoFamily,
                fontSize: TYPOGRAPHY.size.xs,
                fontWeight: TYPOGRAPHY.weight.bold,
                color: overallColor,
                letterSpacing: '0.5px',
              }}
            >
              {overallStatus}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography
            sx={{
              fontFamily: TYPOGRAPHY.monoFamily,
              fontSize: TYPOGRAPHY.size.xs,
              color: COLORS.text.muted,
            }}
          >
            {fmtTimestamp(data.timestamp)}
          </Typography>
          <IconButton size="small" onClick={load} title="Refresh" sx={{ p: 0.25 }}>
            <RefreshIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>
      </Box>

      {/* Stats row (alerts / pipeline / failed jobs) */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          mb: 1,
          pb: 1,
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        {data.alerts && (
          <>
            <StatPair label="ALERTS 7D" value={data.alerts.delivered7d} />
            {data.alerts.silent7d > 0 && (
              <StatPair label="SILENT" value={data.alerts.silent7d} color={COLORS.text.muted} />
            )}
            <StatPair label="TICKERS" value={data.alerts.tickers7d} />
            <StatPair label="24H" value={data.alerts.last24h} />
          </>
        )}
        {data.pipeline && (
          <>
            <StatPair label="PIPELINE 24H" value={data.pipeline.total24h} />
            {data.pipeline.escalated24h > 0 && (
              <StatPair label="AI" value={data.pipeline.escalated24h} color={COLORS.accent} />
            )}
            {data.pipeline.failed24h > 0 && (
              <StatPair label="FAILED" value={data.pipeline.failed24h} color={COLORS.down} />
            )}
          </>
        )}
        {data.failedJobs7d > 0 && (
          <StatPair label="FAILED JOBS 7D" value={data.failedJobs7d} color={COLORS.down} />
        )}
      </Box>

      {/* Grid mini-kart kolektorów */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            md: 'repeat(3, 1fr)',
            lg: 'repeat(4, 1fr)',
          },
          gap: 0.75,
          mb: data.systemErrors.length > 0 ? 1 : 0,
        }}
      >
        {data.collectors.active.map((c) => (
          <CollectorTile key={c.source} c={c} />
        ))}
      </Box>

      {/* Błędy 24h */}
      {data.systemErrors.length > 0 && (
        <Box sx={{ mt: 1, pt: 0.75, borderTop: `1px solid ${COLORS.border}` }}>
          <Box
            onClick={() => setErrorsExpanded(!errorsExpanded)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              gap: 0.5,
              userSelect: 'none',
            }}
          >
            <Box sx={{ width: 6, height: 6, bgcolor: COLORS.down, borderRadius: '50%' }} />
            <Typography
              sx={{
                ...labelSx,
                color: COLORS.down,
                fontSize: TYPOGRAPHY.size.sm,
              }}
            >
              ERRORS 24H
            </Typography>
            <Typography
              sx={{
                fontFamily: TYPOGRAPHY.monoFamily,
                fontSize: TYPOGRAPHY.size.sm,
                fontWeight: TYPOGRAPHY.weight.bold,
                color: COLORS.down,
              }}
            >
              {data.systemErrors.length}
            </Typography>
            {errorsExpanded ? (
              <ExpandLessIcon sx={{ fontSize: 14, color: COLORS.text.secondary }} />
            ) : (
              <ExpandMoreIcon sx={{ fontSize: 14, color: COLORS.text.secondary }} />
            )}
          </Box>
          <Collapse in={errorsExpanded}>
            <TableContainer sx={{ mt: 0.5, maxHeight: 240, border: `1px solid ${COLORS.border}` }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {['TIME', 'MODULE', 'FUNCTION', 'ERROR'].map((h) => (
                      <TableCell
                        key={h}
                        sx={{
                          ...labelSx,
                          bgcolor: COLORS.bg.cardAlt,
                          py: 0.4,
                          px: 0.75,
                          borderBottom: `1px solid ${COLORS.borderStrong}`,
                        }}
                      >
                        {h}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.systemErrors.map((e: SystemError, i: number) => (
                    <TableRow key={i} sx={{ '&:hover': { bgcolor: COLORS.bg.cellHover } }}>
                      <TableCell
                        sx={{
                          py: 0.3,
                          px: 0.75,
                          fontFamily: TYPOGRAPHY.monoFamily,
                          fontSize: TYPOGRAPHY.size.xs,
                          whiteSpace: 'nowrap',
                          color: COLORS.text.secondary,
                        }}
                      >
                        {fmtTimestamp(e.at)}
                      </TableCell>
                      <TableCell
                        sx={{
                          py: 0.3,
                          px: 0.75,
                          fontFamily: TYPOGRAPHY.monoFamily,
                          fontSize: TYPOGRAPHY.size.xs,
                          color: COLORS.text.accent,
                          fontWeight: 600,
                        }}
                      >
                        {e.module}
                      </TableCell>
                      <TableCell
                        sx={{
                          py: 0.3,
                          px: 0.75,
                          fontFamily: TYPOGRAPHY.monoFamily,
                          fontSize: TYPOGRAPHY.size.xs,
                          color: COLORS.text.primary,
                        }}
                      >
                        {e.className}.{e.function}()
                      </TableCell>
                      <TableCell
                        sx={{
                          py: 0.3,
                          px: 0.75,
                          fontSize: TYPOGRAPHY.size.xs,
                          color: COLORS.down,
                          maxWidth: 320,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
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
    </Box>
  );
}
