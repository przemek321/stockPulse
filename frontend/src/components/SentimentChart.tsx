import { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Autocomplete,
  TextField,
  CircularProgress,
  Paper,
  Chip,
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

/** Kropka na wykresie z kolorem wg score */
const ScoreDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload) return null;
  return (
    <Dot
      cx={cx}
      cy={cy}
      r={4}
      fill={scoreColor(payload.score)}
      stroke="none"
    />
  );
};

/** Tooltip wykresu */
const ChartTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <Paper sx={{ p: 1.5, maxWidth: 320 }}>
      <Typography variant="subtitle2" sx={{ color: scoreColor(d.score), fontWeight: 700 }}>
        Score: {Number(d.score).toFixed(3)}
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        {fmtFull(d.timestamp)}
      </Typography>
      <Typography variant="caption" display="block">
        Confidence: {(Number(d.confidence) * 100).toFixed(1)}%
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        {d.source}
      </Typography>
      {d.rawText && (
        <Typography variant="caption" display="block" sx={{ mt: 0.5, fontStyle: 'italic' }}>
          {d.rawText.slice(0, 120)}
          {d.rawText.length > 120 ? '...' : ''}
        </Typography>
      )}
    </Paper>
  );
};

/**
 * Wykres sentymentu per ticker.
 * Linia score w czasie z kolorowaniem wg wartości.
 */
export default function SentimentChart() {
  const [allScores, setAllScores] = useState<SentimentScore[]>([]);
  const [tickers, setTickers] = useState<string[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [scoresRes, tickersRes] = await Promise.all([
          fetchSentimentScores(500),
          fetchTickers(),
        ]);
        setAllScores(scoresRes.scores || []);

        // Wyciągnij unikalne tickery z wyników sentymentu (posortowane po ilości)
        const counts: Record<string, number> = {};
        for (const s of scoresRes.scores || []) {
          counts[s.symbol] = (counts[s.symbol] || 0) + 1;
        }
        const sorted = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([sym]) => sym);
        setTickers(sorted);

        // Domyślnie wybierz ticker z największą ilością danych
        if (sorted.length > 0) {
          setSelectedTicker(sorted[0]);
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  /** Dane wykresu — filtrowane po tickerze, posortowane chronologicznie */
  const chartData = useMemo(() => {
    if (!selectedTicker) return [];
    return allScores
      .filter((s) => s.symbol === selectedTicker)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((s) => ({
        ...s,
        score: Number(s.score),
        confidence: Number(s.confidence),
      }));
  }, [allScores, selectedTicker]);

  /** Statystyki dla wybranego tickera */
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;
    const scores = chartData.map((d) => d.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const pos = scores.filter((s) => s > 0.2).length;
    const neg = scores.filter((s) => s < -0.2).length;
    const neutral = scores.length - pos - neg;
    return { avg, pos, neg, neutral, total: scores.length };
  }, [chartData]);

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6" fontWeight={600}>
          Wykres sentymentu
        </Typography>

        <Autocomplete
          value={selectedTicker}
          onChange={(_, v) => setSelectedTicker(v)}
          options={tickers}
          getOptionLabel={(opt) => opt}
          renderInput={(params) => (
            <TextField {...params} label="Ticker" size="small" />
          )}
          sx={{ width: 180 }}
          disableClearable
        />

        {stats && (
          <Box sx={{ display: 'flex', gap: 1, ml: 'auto', flexWrap: 'wrap' }}>
            <Chip
              label={`Avg: ${stats.avg.toFixed(3)}`}
              size="small"
              sx={{
                fontWeight: 700,
                color: scoreColor(stats.avg),
                borderColor: scoreColor(stats.avg),
              }}
              variant="outlined"
            />
            <Chip label={`${stats.pos} pozytywnych`} size="small" color="success" variant="outlined" />
            <Chip label={`${stats.neutral} neutralnych`} size="small" variant="outlined" />
            <Chip label={`${stats.neg} negatywnych`} size="small" color="error" variant="outlined" />
            <Chip label={`${stats.total} total`} size="small" variant="outlined" />
          </Box>
        )}
      </Box>

      {chartData.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          Brak danych sentymentu dla {selectedTicker || 'tego tickera'}
        </Typography>
      ) : (
        <ResponsiveContainer width="100%" height={350}>
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
              dataKey="score"
              stroke="#64b5f6"
              strokeWidth={2}
              dot={<ScoreDot />}
              activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Paper>
  );
}
