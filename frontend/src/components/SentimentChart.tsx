import { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
} from '@mui/material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Dot,
} from 'recharts';
import { fetchSentimentScores, fetchTickers, SentimentScore } from '../api';

/** Formatowanie daty na oś X */
const fmtShort = (ts: string) =>
  new Date(ts).toLocaleString('pl-PL', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Formatowanie daty do tooltipa */
const fmtFull = (ts: string) =>
  new Date(ts).toLocaleString('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/** Kolor wg wartości score */
const scoreColor = (score: number) =>
  score > 0.2 ? '#66bb6a' : score < -0.2 ? '#ef5350' : '#90a4ae';

/** Kropka na wykresie — fioletowa obwódka gdy eskalacja AI */
const ScoreDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload) return null;
  const hasAI = !!payload.enrichedAnalysis;
  const displayScore = payload.displayScore ?? payload.score;
  return (
    <Dot
      cx={cx}
      cy={cy}
      r={hasAI ? 5 : 4}
      fill={scoreColor(displayScore)}
      stroke={hasAI ? '#ce93d8' : 'none'}
      strokeWidth={hasAI ? 2 : 0}
    />
  );
};

/** Tooltip wykresu */
const ChartTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  const ea = d.enrichedAnalysis;
  return (
    <Paper sx={{ p: 1.5, maxWidth: 360 }}>
      <Typography variant="subtitle2" sx={{ color: scoreColor(d.displayScore ?? d.score), fontWeight: 700 }}>
        {d.effectiveScore != null ? `effectiveScore: ${Number(d.displayScore).toFixed(3)}` : `Score: ${Number(d.score).toFixed(3)}`}
        {d.model?.includes('gpt') && (
          <span style={{ marginLeft: 8, fontSize: 11, color: '#ce93d8' }}>AI</span>
        )}
      </Typography>
      {d.effectiveScore != null && (
        <Typography variant="caption" display="block" color="text.secondary">
          FinBERT raw: {Number(d.score).toFixed(3)}
        </Typography>
      )}
      <Typography variant="caption" display="block" color="text.secondary">
        {fmtFull(d.timestamp)}
      </Typography>
      <Typography variant="caption" display="block">
        Confidence: {(Number(d.confidence) * 100).toFixed(1)}% &middot; {d.source}
      </Typography>
      {ea && (
        <Box sx={{ mt: 0.5, pt: 0.5, borderTop: '1px solid #444' }}>
          <Typography variant="caption" display="block" sx={{ color: '#ce93d8', fontWeight: 700 }}>
            AI: {ea.sentiment}
            {ea.conviction != null && ` (conv: ${ea.conviction})`}
          </Typography>
          <Typography variant="caption" display="block">
            {ea.type} &middot; {ea.urgency} &middot; {ea.catalyst_type}
          </Typography>
          <Typography variant="caption" display="block">
            Wpływ: {ea.price_impact_direction} / {ea.price_impact_magnitude}
          </Typography>
          {ea.summary && (
            <Typography variant="caption" display="block" sx={{ fontStyle: 'italic', mt: 0.3 }}>
              {ea.summary.slice(0, 120)}
            </Typography>
          )}
        </Box>
      )}
      {!ea && d.rawText && (
        <Typography variant="caption" display="block" sx={{ mt: 0.5, fontStyle: 'italic' }}>
          {d.rawText.slice(0, 120)}
          {d.rawText.length > 120 ? '...' : ''}
        </Typography>
      )}
    </Paper>
  );
};

/** Wiersz tabeli tickerów — agregowane statystyki */
interface TickerRow {
  symbol: string;
  avg: number;
  total: number;
  ai: number;
  pos: number;
  neutral: number;
  neg: number;
  last: number;
}

type SortKey = keyof TickerRow;

/** Kolumny tabeli */
const COLUMNS: { key: SortKey; label: string; align?: 'left' | 'right' }[] = [
  { key: 'symbol', label: 'Ticker', align: 'left' },
  { key: 'avg', label: 'Avg', align: 'right' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'ai', label: 'AI', align: 'right' },
  { key: 'pos', label: 'Poz.', align: 'right' },
  { key: 'neutral', label: 'Neutr.', align: 'right' },
  { key: 'neg', label: 'Neg.', align: 'right' },
  { key: 'last', label: 'Ostatni', align: 'right' },
];

/**
 * Wykres sentymentu z tabelą tickerów.
 * Tabela z sortowaniem → kliknięcie wiersza → wykres poniżej.
 */
export default function SentimentChart() {
  const [allScores, setAllScores] = useState<SentimentScore[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    const load = async () => {
      try {
        const [scoresRes] = await Promise.all([
          fetchSentimentScores(500),
          fetchTickers(),
        ]);
        setAllScores(scoresRes.scores || []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  /** Agregacja statystyk per ticker */
  const tickerRows = useMemo<TickerRow[]>(() => {
    const map = new Map<string, { scores: number[]; aiCount: number; lastTs: number; lastScore: number }>();

    for (const s of allScores) {
      const ds = s.effectiveScore != null ? Number(s.effectiveScore) : Number(s.score);
      const ts = new Date(s.timestamp).getTime();
      const existing = map.get(s.symbol);

      if (existing) {
        existing.scores.push(ds);
        if (s.enrichedAnalysis) existing.aiCount++;
        if (ts > existing.lastTs) {
          existing.lastTs = ts;
          existing.lastScore = ds;
        }
      } else {
        map.set(s.symbol, {
          scores: [ds],
          aiCount: s.enrichedAnalysis ? 1 : 0,
          lastTs: ts,
          lastScore: ds,
        });
      }
    }

    const rows: TickerRow[] = [];
    for (const [symbol, data] of map) {
      const avg = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
      rows.push({
        symbol,
        avg,
        total: data.scores.length,
        ai: data.aiCount,
        pos: data.scores.filter((s) => s > 0.2).length,
        neutral: data.scores.filter((s) => s >= -0.2 && s <= 0.2).length,
        neg: data.scores.filter((s) => s < -0.2).length,
        last: data.lastScore,
      });
    }

    // Domyślnie wybierz ticker z największą liczbą wzmianek
    if (!selectedTicker && rows.length > 0) {
      const top = [...rows].sort((a, b) => b.total - a.total)[0];
      setSelectedTicker(top.symbol);
    }

    return rows;
  }, [allScores]);

  /** Posortowane wiersze tabeli */
  const sortedRows = useMemo(() => {
    return [...tickerRows].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === 'string' && typeof vb === 'string') {
        const cmp = va.localeCompare(vb, 'pl');
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const na = Number(va);
      const nb = Number(vb);
      return sortDir === 'asc' ? na - nb : nb - na;
    });
  }, [tickerRows, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  /** Dane wykresu — filtrowane po tickerze, posortowane chronologicznie.
   *  displayScore = effectiveScore (gdy AI) lub FinBERT score (bez AI). */
  const chartData = useMemo(() => {
    if (!selectedTicker) return [];
    return allScores
      .filter((s) => s.symbol === selectedTicker)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((s) => ({
        ...s,
        score: Number(s.score),
        confidence: Number(s.confidence),
        displayScore: s.effectiveScore != null ? Number(s.effectiveScore) : Number(s.score),
      }));
  }, [allScores, selectedTicker]);

  if (loading) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (error) {
    return (
      <Typography color="error" sx={{ py: 2 }}>
        {error}
      </Typography>
    );
  }

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5 }}>
        Sentyment per ticker
      </Typography>

      {/* Tabela tickerów z sortowaniem */}
      <TableContainer sx={{ maxHeight: 320, mb: 2 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {COLUMNS.map((col) => (
                <TableCell
                  key={col.key}
                  align={col.align ?? 'right'}
                  sx={{ fontWeight: 700, py: 0.5 }}
                >
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
            {sortedRows.map((row) => (
              <TableRow
                key={row.symbol}
                hover
                selected={row.symbol === selectedTicker}
                onClick={() => setSelectedTicker(row.symbol)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell sx={{ fontWeight: 700, py: 0.4 }}>{row.symbol}</TableCell>
                <TableCell align="right" sx={{ color: scoreColor(row.avg), fontWeight: 600, py: 0.4 }}>
                  {row.avg.toFixed(3)}
                </TableCell>
                <TableCell align="right" sx={{ py: 0.4 }}>{row.total}</TableCell>
                <TableCell align="right" sx={{ color: row.ai > 0 ? '#ce93d8' : 'inherit', py: 0.4 }}>
                  {row.ai}
                </TableCell>
                <TableCell align="right" sx={{ color: '#66bb6a', py: 0.4 }}>{row.pos}</TableCell>
                <TableCell align="right" sx={{ color: '#90a4ae', py: 0.4 }}>{row.neutral}</TableCell>
                <TableCell align="right" sx={{ color: '#ef5350', py: 0.4 }}>{row.neg}</TableCell>
                <TableCell align="right" sx={{ color: scoreColor(row.last), fontWeight: 600, py: 0.4 }}>
                  {row.last.toFixed(3)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Wykres dla wybranego tickera */}
      {selectedTicker && chartData.length > 0 && (
        <>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
            {selectedTicker} — {chartData.length} wzmianek
          </Typography>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={fmtShort}
                tick={{ fontSize: 11 }}
                stroke="#666"
                interval="preserveStartEnd"
                minTickGap={60}
              />
              <YAxis
                domain={[-1, 1]}
                ticks={[-1, -0.5, 0, 0.5, 1]}
                tick={{ fontSize: 11 }}
                stroke="#666"
                width={40}
              />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={0} stroke="#555" strokeDasharray="4 4" />
              <ReferenceLine y={0.5} stroke="#388e3c" strokeDasharray="2 4" strokeOpacity={0.4} />
              <ReferenceLine y={-0.5} stroke="#d32f2f" strokeDasharray="2 4" strokeOpacity={0.4} />
              <Line
                type="monotone"
                dataKey="displayScore"
                stroke="#64b5f6"
                strokeWidth={2}
                dot={<ScoreDot />}
                activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </Paper>
  );
}
