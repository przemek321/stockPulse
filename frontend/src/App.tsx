import { Box, Container, Typography, Chip, Divider } from '@mui/material';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import NewspaperIcon from '@mui/icons-material/Newspaper';
import GavelIcon from '@mui/icons-material/Gavel';
import NotificationsIcon from '@mui/icons-material/Notifications';
import RuleIcon from '@mui/icons-material/Rule';
import ForumIcon from '@mui/icons-material/Forum';
import PsychologyIcon from '@mui/icons-material/Psychology';

import CollectorStatus from './components/CollectorStatus';
import DataPanel from './components/DataPanel';
import DbSummary from './components/DbSummary';
import SentimentChart from './components/SentimentChart';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { fetchTickers, fetchAlertRules, fetchAlerts, fetchAiScores } from './api';

/** Formatowanie daty do czytelnej formy */
const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/** Chip z kolorem wg priorytetu */
const PriorityChip = ({ value }: { value: string }) => {
  const color =
    value === 'CRITICAL'
      ? 'error'
      : value === 'HIGH'
      ? 'warning'
      : value === 'MEDIUM'
      ? 'info'
      : 'default';
  return <Chip label={value} color={color as any} size="small" />;
};

export default function App() {
  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      {/* Nagłówek */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          StockPulse
          <Typography component="span" variant="h4" color="primary" fontWeight={700}>
            {' '}Dashboard
          </Typography>
        </Typography>
        <DbSummary />
      </Box>

      {/* Status kolektorów */}
      <CollectorStatus />

      <Divider sx={{ my: 3 }} />

      {/* Wykres sentymentu per ticker */}
      <SentimentChart />

      <Divider sx={{ my: 3 }} />

      {/* Tabele danych — rozwijane na kliknięcie */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Tabele danych
      </Typography>

      {/* ── Analiza AI (gpt-4o-mini) ─────────── */}
      <DataPanel
        title="Analiza AI (gpt-4o-mini)"
        icon={<SmartToyIcon sx={{ color: '#ce93d8' }} />}
        badgeColor="secondary"
        defaultSortKey="timestamp"
        defaultSortDir="desc"
        columns={[
          { key: 'symbol', label: 'Ticker' },
          {
            key: 'score',
            label: 'FinBERT',
            render: (v: number) => {
              const num = Number(v);
              const color = num > 0.2 ? '#66bb6a' : num < -0.2 ? '#ef5350' : '#90a4ae';
              return <span style={{ color, fontWeight: 700 }}>{num.toFixed(3)}</span>;
            },
          },
          {
            key: 'enrichedAnalysis',
            label: 'AI Sentyment',
            render: (_: any, row: any) => {
              const ea = row.enrichedAnalysis;
              if (!ea) return '—';
              const sentColor =
                ea.sentiment === 'BULLISH' ? '#66bb6a' : ea.sentiment === 'BEARISH' ? '#ef5350' : '#90a4ae';
              return <span style={{ color: sentColor, fontWeight: 700 }}>{ea.sentiment}</span>;
            },
          },
          {
            key: '_conviction',
            label: 'Conviction',
            render: (_: any, row: any) => {
              const ea = row.enrichedAnalysis;
              if (!ea) return '—';
              const color = ea.conviction > 0 ? '#66bb6a' : ea.conviction < 0 ? '#ef5350' : '#90a4ae';
              return <span style={{ color, fontWeight: 700 }}>{ea.conviction}</span>;
            },
          },
          {
            key: '_urgency',
            label: 'Pilność',
            render: (_: any, row: any) => {
              const ea = row.enrichedAnalysis;
              if (!ea) return '—';
              const color =
                ea.urgency === 'HIGH' ? '#ef5350' : ea.urgency === 'MEDIUM' ? '#ffa726' : '#90a4ae';
              return <Chip label={ea.urgency} size="small" sx={{ bgcolor: color, color: '#fff', fontWeight: 700, fontSize: '0.65rem' }} />;
            },
          },
          {
            key: '_catalyst',
            label: 'Katalizator',
            render: (_: any, row: any) => {
              const ea = row.enrichedAnalysis;
              if (!ea?.catalyst_type) return '—';
              return ea.catalyst_type;
            },
          },
          {
            key: '_priceImpact',
            label: 'Wpływ cenowy',
            render: (_: any, row: any) => {
              const ea = row.enrichedAnalysis;
              if (!ea) return '—';
              const dir = ea.price_impact_direction || '?';
              const mag = ea.price_impact_magnitude || '?';
              const arrow = dir === 'positive' ? '↑' : dir === 'negative' ? '↓' : '→';
              const color = dir === 'positive' ? '#66bb6a' : dir === 'negative' ? '#ef5350' : '#90a4ae';
              return (
                <span style={{ color }}>
                  {arrow} {mag}
                </span>
              );
            },
          },
          {
            key: '_summary',
            label: 'Podsumowanie AI',
            render: (_: any, row: any) => {
              const ea = row.enrichedAnalysis;
              if (!ea?.summary) return '—';
              return (
                <span title={ea.summary} style={{ cursor: 'help' }}>
                  {ea.summary.slice(0, 100)}{ea.summary.length > 100 ? '…' : ''}
                </span>
              );
            },
          },
          {
            key: 'rawText',
            label: 'Tekst źródłowy',
            render: (v: string) => (
              <span title={v || ''} style={{ cursor: 'help', fontSize: '0.7rem', color: '#b0bec5' }}>
                {v?.slice(0, 80) || '—'}{v && v.length > 80 ? '…' : ''}
              </span>
            ),
          },
          {
            key: '_time',
            label: 'Czas AI',
            render: (_: any, row: any) => {
              const ea = row.enrichedAnalysis;
              if (!ea?.processing_time_ms) return '—';
              return `${(ea.processing_time_ms / 1000).toFixed(1)}s`;
            },
          },
          {
            key: 'timestamp',
            label: 'Data',
            render: (v: string) => fmtDate(v),
          },
        ]}
        fetchData={async () => {
          const data = await fetchAiScores(200);
          return data.scores;
        }}
      />

      {/* ── Tickery ──────────────────────────── */}
      <DataPanel
        title="Tickery Healthcare"
        icon={<ShowChartIcon color="primary" />}
        badge={27}
        badgeColor="primary"
        columns={[
          { key: 'symbol', label: 'Symbol' },
          { key: 'name', label: 'Nazwa' },
          { key: 'subsector', label: 'Podsektor' },
          {
            key: 'priority',
            label: 'Priorytet',
            render: (v: string) => <PriorityChip value={v} />,
          },
          { key: 'ceo', label: 'CEO' },
          {
            key: 'aliases',
            label: 'Aliasy',
            render: (v: string[]) => v?.slice(0, 3).join(', ') || '—',
          },
          {
            key: 'isActive',
            label: 'Aktywny',
            render: (v: boolean) => (
              <Chip
                label={v ? 'TAK' : 'NIE'}
                color={v ? 'success' : 'default'}
                size="small"
              />
            ),
          },
        ]}
        fetchData={async () => {
          const data = await fetchTickers();
          return data.tickers;
        }}
      />

      {/* ── Wyniki sentymentu ─────────── */}
      <DataPanel
        title="Wyniki sentymentu"
        icon={<PsychologyIcon sx={{ color: '#ef5350' }} />}
        badgeColor="error"
        defaultSortKey="timestamp"
        defaultSortDir="desc"
        columns={[
          { key: 'symbol', label: 'Ticker' },
          {
            key: 'score',
            label: 'Score',
            render: (v: number) => {
              const num = Number(v);
              const color = num > 0.2 ? '#66bb6a' : num < -0.2 ? '#ef5350' : '#90a4ae';
              return <span style={{ color, fontWeight: 700 }}>{num.toFixed(3)}</span>;
            },
          },
          {
            key: 'confidence',
            label: 'Confidence',
            render: (v: number) => `${(Number(v) * 100).toFixed(1)}%`,
          },
          { key: 'model', label: 'Model' },
          {
            key: 'enrichedAnalysis',
            label: 'AI',
            render: (ea: any) => {
              if (!ea) return <span style={{ color: '#555' }}>—</span>;
              const convColor = ea.conviction > 0 ? '#66bb6a' : ea.conviction < 0 ? '#ef5350' : '#90a4ae';
              return (
                <span title={`${ea.type} | ${ea.urgency} | ${ea.catalyst_type}\n${ea.summary || ''}`}>
                  <span style={{ color: '#ce93d8', fontWeight: 700 }}>{ea.sentiment}</span>
                  {' '}
                  <span style={{ color: convColor, fontSize: 11 }}>
                    ({ea.conviction})
                  </span>
                </span>
              );
            },
          },
          { key: 'source', label: 'Źródło' },
          {
            key: 'rawText',
            label: 'Tekst',
            render: (v: string) => v?.slice(0, 80) || '—',
          },
          {
            key: 'timestamp',
            label: 'Data',
            render: (v: string) => fmtDate(v),
          },
        ]}
        fetchData={async () => {
          const res = await fetch('/api/sentiment/scores?limit=200');
          if (res.ok) return (await res.json()).scores || [];
          return [];
        }}
      />

      {/* ── News (Finnhub) ──────────────────── */}
      <DataPanel
        title="News (Finnhub)"
        icon={<NewspaperIcon color="secondary" />}
        badgeColor="secondary"
        defaultSortKey="publishedAt"
        defaultSortDir="desc"
        columns={[
          { key: 'symbol', label: 'Ticker' },
          {
            key: 'headline',
            label: 'Nagłówek',
            render: (v: string, row: any) =>
              row.url ? (
                <a href={row.url} target="_blank" rel="noreferrer" style={{ color: '#4fc3f7' }}>
                  {v?.slice(0, 80) || '—'}
                </a>
              ) : (
                v?.slice(0, 80) || '—'
              ),
          },
          { key: 'source', label: 'Źródło' },
          {
            key: 'publishedAt',
            label: 'Data',
            render: (v: string) => fmtDate(v),
          },
        ]}
        fetchData={async () => {
          // Pobierz newsy bezpośrednio z API — top 100 najnowszych
          const res = await fetch('/api/sentiment/news?limit=100');
          if (res.ok) return (await res.json()).articles || [];
          // Fallback: ticker po tickerze (ograniczone)
          const tickers = await fetchTickers();
          const all: any[] = [];
          for (const t of tickers.tickers.slice(0, 5)) {
            try {
              const r = await fetch(`/api/sentiment/${t.symbol}`);
              if (r.ok) {
                const d = await r.json();
                if (d.news) all.push(...d.news);
              }
            } catch { /* */ }
          }
          return all.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
        }}
      />

      {/* ── SEC Filings ─────────────────────── */}
      <DataPanel
        title="SEC EDGAR Filings"
        icon={<GavelIcon sx={{ color: '#ab47bc' }} />}
        badgeColor="info"
        defaultSortKey="filingDate"
        defaultSortDir="desc"
        columns={[
          { key: 'symbol', label: 'Ticker' },
          { key: 'formType', label: 'Form' },
          { key: 'description', label: 'Opis' },
          {
            key: 'documentUrl',
            label: 'Link',
            render: (v: string) =>
              v ? (
                <a href={v} target="_blank" rel="noreferrer" style={{ color: '#4fc3f7' }}>
                  SEC
                </a>
              ) : (
                '—'
              ),
          },
          {
            key: 'filingDate',
            label: 'Data',
            render: (v: string) => fmtDate(v),
          },
        ]}
        fetchData={async () => {
          const res = await fetch('/api/sentiment/filings?limit=100');
          if (res.ok) return (await res.json()).filings || [];
          return [];
        }}
      />

      {/* ── Alerty wysłane ──────────────────── */}
      <DataPanel
        title="Alerty wysłane"
        icon={<NotificationsIcon color="warning" />}
        badgeColor="warning"
        defaultSortKey="sentAt"
        defaultSortDir="desc"
        columns={[
          { key: 'symbol', label: 'Ticker' },
          { key: 'ruleName', label: 'Reguła' },
          {
            key: 'priority',
            label: 'Priorytet',
            render: (v: string) => <PriorityChip value={v} />,
          },
          { key: 'channel', label: 'Kanał' },
          {
            key: 'catalystType',
            label: 'Katalizator',
            render: (v: string | null) => v || '—',
          },
          {
            key: 'message',
            label: 'Wiadomość',
            render: (v: string) => v?.slice(0, 100) || '—',
          },
          {
            key: 'sentAt',
            label: 'Wysłano',
            render: (v: string) => fmtDate(v),
          },
        ]}
        fetchData={async () => {
          const data = await fetchAlerts();
          return data.alerts || [];
        }}
      />

      {/* ── Reguły alertów ──────────────────── */}
      <DataPanel
        title="Reguły alertów"
        icon={<RuleIcon color="info" />}
        badgeColor="info"
        columns={[
          { key: 'name', label: 'Nazwa' },
          {
            key: 'priority',
            label: 'Priorytet',
            render: (v: string) => <PriorityChip value={v} />,
          },
          { key: 'condition', label: 'Warunek' },
          { key: 'throttleMinutes', label: 'Throttle (min)' },
          {
            key: 'isActive',
            label: 'Aktywna',
            render: (v: boolean) => (
              <Chip label={v ? 'TAK' : 'NIE'} color={v ? 'success' : 'default'} size="small" />
            ),
          },
        ]}
        fetchData={async () => {
          const data = await fetchAlertRules();
          return data.rules || [];
        }}
      />

      {/* ── StockTwits wzmianki ─────────────── */}
      <DataPanel
        title="StockTwits Wzmianki"
        icon={<ForumIcon sx={{ color: '#66bb6a' }} />}
        badgeColor="success"
        defaultSortKey="publishedAt"
        defaultSortDir="desc"
        columns={[
          {
            key: 'detectedTickers',
            label: 'Tickery',
            render: (v: string[]) => v?.join(', ') || '—',
          },
          { key: 'body', label: 'Treść', render: (v: string) => v?.slice(0, 120) || '—' },
          { key: 'author', label: 'Autor' },
          { key: 'score', label: 'Score' },
          {
            key: 'publishedAt',
            label: 'Data',
            render: (v: string) => fmtDate(v),
          },
        ]}
        fetchData={async () => {
          const res = await fetch('/api/sentiment/mentions?limit=100');
          if (res.ok) return (await res.json()).mentions || [];
          return [];
        }}
      />

      <Typography variant="caption" color="text.secondary" sx={{ mt: 4, display: 'block' }}>
        StockPulse v1.0 — Healthcare Sentiment Analysis
      </Typography>
    </Container>
  );
}
