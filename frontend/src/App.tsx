import { useState } from 'react';
import { Box, Container, Typography, Chip, Divider, Dialog, DialogTitle, DialogContent, IconButton, Tabs, Tab, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import TimelineIcon from '@mui/icons-material/Timeline';
import TerminalIcon from '@mui/icons-material/Terminal';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import NewspaperIcon from '@mui/icons-material/Newspaper';
import GavelIcon from '@mui/icons-material/Gavel';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import EventIcon from '@mui/icons-material/Event';
import NotificationsIcon from '@mui/icons-material/Notifications';
import RuleIcon from '@mui/icons-material/Rule';
import ForumIcon from '@mui/icons-material/Forum';
import PsychologyIcon from '@mui/icons-material/Psychology';
import HubIcon from '@mui/icons-material/Hub';

import CollectorStatus from './components/CollectorStatus';
import DataPanel from './components/DataPanel';
import DbSummary from './components/DbSummary';
import SentimentChart from './components/SentimentChart';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { fetchTickers, fetchAlertRules, fetchAlerts, fetchAiScores, fetchPipelineLogs, fetchFilingsGpt } from './api';
import SystemLogsTab from './components/SystemLogsTab';

/** Klikalny podgląd tekstu — otwiera Dialog z możliwością zaznaczenia i kopiowania */
const TextDialog = ({ label, text, color = '#80cbc4' }: { label: string; text: string; color?: string }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <span
        onClick={() => setOpen(true)}
        style={{ cursor: 'pointer', fontSize: '0.7rem', color, textDecoration: 'underline dotted' }}
      >
        {label}
      </span>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          Szczegóły
          <Box>
            <IconButton size="small" onClick={handleCopy} title="Kopiuj do schowka">
              <ContentCopyIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => setOpen(false)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          {copied && (
            <Typography variant="caption" sx={{ color: '#66bb6a', mb: 1, display: 'block' }}>
              Skopiowano!
            </Typography>
          )}
          <Box
            sx={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              bgcolor: '#1a1a2e',
              p: 2,
              borderRadius: 1,
              maxHeight: '60vh',
              overflow: 'auto',
              userSelect: 'text',
            }}
          >
            {text}
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
};

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

declare const __BUILD_DATE__: string;

export default function App() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      {/* Data kompilacji — prawy dolny róg */}
      <Typography
        sx={{
          position: 'fixed', bottom: 8, right: 12,
          fontSize: '0.65rem', color: 'grey.600', opacity: 0.7, zIndex: 1,
        }}
      >
        Build: {new Date(__BUILD_DATE__).toLocaleString('pl-PL')}
      </Typography>

      {/* Nagłówek */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          StockPulse
          <Typography component="span" variant="h4" color="primary" fontWeight={700}>
            {' '}Dashboard
          </Typography>
        </Typography>
        <DbSummary />
      </Box>

      {/* Zakładki */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab icon={<DashboardIcon />} iconPosition="start" label="Dashboard" />
        <Tab icon={<TerminalIcon />} iconPosition="start" label="System Logs" />
      </Tabs>

      {/* Tab 0: Dashboard */}
      {activeTab === 0 && (
        <>
          {/* Status kolektorów */}
          <CollectorStatus />

      <Divider sx={{ my: 3 }} />

      {/* Wykres sentymentu — domyślnie zwinięty */}
      <Accordion
        sx={{
          mb: 2,
          bgcolor: 'background.paper',
          '&:before': { display: 'none' },
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <TimelineIcon sx={{ color: '#64b5f6' }} />
            <Typography fontWeight={600}>Wykres sentymentu</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 0 }}>
          <SentimentChart />
        </AccordionDetails>
      </Accordion>

      <Divider sx={{ my: 2 }} />

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

      {/* ── Pipeline AI — Logi Egzekucji ────── */}
      <DataPanel
        title="Pipeline AI — Logi Egzekucji"
        icon={<PsychologyIcon sx={{ color: '#ff9800' }} />}
        badgeColor="warning"
        defaultSortKey="createdAt"
        defaultSortDir="desc"
        columns={[
          {
            key: 'status',
            label: 'Status',
            render: (v: string) => {
              const colors: Record<string, string> = {
                AI_ESCALATED: '#66bb6a',
                FINBERT_ONLY: '#90a4ae',
                AI_FAILED: '#ef5350',
                AI_DISABLED: '#ffa726',
                SKIPPED_SHORT: '#616161',
                SKIPPED_NOT_FOUND: '#616161',
                FINBERT_FALLBACK: '#ce93d8',
                ERROR: '#ef5350',
              };
              return (
                <Chip
                  label={v}
                  size="small"
                  sx={{ bgcolor: colors[v] || '#616161', color: '#fff', fontWeight: 700, fontSize: '0.6rem' }}
                />
              );
            },
          },
          { key: 'symbol', label: 'Ticker' },
          {
            key: 'tier',
            label: 'Tier',
            render: (v: number | null) => {
              if (v == null) return '—';
              const colors: Record<number, string> = { 1: '#66bb6a', 2: '#ffa726', 3: '#90a4ae' };
              return <span style={{ color: colors[v] || '#fff', fontWeight: 700 }}>T{v}</span>;
            },
          },
          { key: 'source', label: 'Źródło' },
          {
            key: 'finbertScore',
            label: 'FinBERT',
            render: (v: number | null) => {
              if (v == null) return '—';
              const num = Number(v);
              const color = num > 0.2 ? '#66bb6a' : num < -0.2 ? '#ef5350' : '#90a4ae';
              return <span style={{ color, fontWeight: 700 }}>{num.toFixed(3)}</span>;
            },
          },
          {
            key: 'finbertConfidence',
            label: 'Conf.',
            render: (v: number | null) => (v != null ? `${(Number(v) * 100).toFixed(1)}%` : '—'),
          },
          {
            key: 'tierReason',
            label: 'Powód',
            render: (v: string | null) => (
              <span title={v || ''} style={{ cursor: 'help', fontSize: '0.7rem', color: '#b0bec5' }}>
                {v?.slice(0, 50) || '—'}{v && v.length > 50 ? '…' : ''}
              </span>
            ),
          },
          {
            key: 'inputText',
            label: 'Tekst',
            render: (v: string | null) => {
              if (!v) return '—';
              return <TextDialog label={`${v.slice(0, 50)}${v.length > 50 ? '…' : ''}`} text={v} color="#b0bec5" />;
            },
          },
          {
            key: 'pdufaContext',
            label: 'PDUFA',
            render: (v: string | null) =>
              v ? <Chip label="TAK" size="small" sx={{ bgcolor: '#42a5f5', color: '#fff', fontSize: '0.6rem' }} /> : '—',
          },
          {
            key: 'responsePayload',
            label: 'AI Wynik',
            render: (v: any) => {
              if (!v) return '—';
              const sentColor =
                v.sentiment === 'BULLISH' ? '#66bb6a' : v.sentiment === 'BEARISH' ? '#ef5350' : '#90a4ae';
              return <span style={{ color: sentColor, fontWeight: 700 }}>{v.sentiment} ({v.conviction})</span>;
            },
          },
          {
            key: '_prompt',
            label: 'Prompt',
            render: (_: any, row: any) => {
              const prompt = row.responsePayload?.prompt_used;
              if (!prompt) return '—';
              return <TextDialog label={`${prompt.slice(0, 50)}…`} text={prompt} />;
            },
          },
          {
            key: 'finbertDurationMs',
            label: 'FinBERT ms',
            render: (v: number | null) => (v != null ? `${v}ms` : '—'),
          },
          {
            key: 'azureDurationMs',
            label: 'Azure ms',
            render: (v: number | null) => (v != null ? `${v}ms` : '—'),
          },
          {
            key: 'errorMessage',
            label: 'Błąd',
            render: (v: string | null) => {
              if (!v) return '—';
              return <TextDialog label={`${v.slice(0, 35)}…`} text={v} color="#ef5350" />;
            },
          },
          {
            key: 'createdAt',
            label: 'Data',
            render: (v: string) => fmtDate(v),
          },
        ]}
        fetchData={async () => {
          const data = await fetchPipelineLogs(200);
          return data.logs;
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

      {/* ── Analiza GPT Filingów SEC ──────────── */}
      <DataPanel
        title="Analiza GPT Filingów SEC"
        icon={<PsychologyIcon sx={{ color: '#ce93d8' }} />}
        badgeColor="secondary"
        defaultSortKey="filingDate"
        defaultSortDir="desc"
        columns={[
          { key: 'symbol', label: 'Ticker' },
          {
            key: 'formType',
            label: 'Form',
            render: (v: string) => {
              const color = v === '8-K' ? '#ab47bc' : v === '4' ? '#ff7043' : '#90a4ae';
              return <Chip label={v} size="small" sx={{ bgcolor: color, color: '#fff', fontWeight: 700, fontSize: '0.65rem' }} />;
            },
          },
          {
            key: 'priceImpactDirection',
            label: 'Kierunek',
            render: (v: string) => {
              const color = v === 'positive' ? '#66bb6a' : v === 'negative' ? '#ef5350' : '#90a4ae';
              const arrow = v === 'positive' ? '↑' : v === 'negative' ? '↓' : '→';
              return <Chip label={`${arrow} ${v || 'neutral'}`} size="small" sx={{ bgcolor: color, color: '#fff', fontWeight: 700, fontSize: '0.65rem' }} />;
            },
          },
          {
            key: '_conviction',
            label: 'Conviction',
            render: (_: any, row: any) => {
              const conv = row.gptAnalysis?.conviction;
              if (conv == null) return '—';
              const color = conv > 0 ? '#66bb6a' : conv < 0 ? '#ef5350' : '#90a4ae';
              return <span style={{ color, fontWeight: 700 }}>{Number(conv).toFixed(2)}</span>;
            },
          },
          {
            key: '_summary',
            label: 'Podsumowanie',
            render: (_: any, row: any) => {
              const s = row.gptAnalysis?.summary;
              if (!s) return '—';
              return <TextDialog label={`${s.slice(0, 60)}${s.length > 60 ? '…' : ''}`} text={s} color="#ce93d8" />;
            },
          },
          {
            key: '_keyFacts',
            label: 'Key Facts',
            render: (_: any, row: any) => {
              const facts = row.gptAnalysis?.key_facts;
              if (!facts || facts.length === 0) return '—';
              return (
                <TextDialog
                  label={`${facts.length} faktów`}
                  text={facts.map((f: string, i: number) => `${i + 1}. ${f}`).join('\n')}
                  color="#80cbc4"
                />
              );
            },
          },
          {
            key: 'filingDate',
            label: 'Data',
            render: (v: string) => fmtDate(v),
          },
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
        ]}
        fetchData={async () => {
          const data = await fetchFilingsGpt(100);
          return data.filings;
        }}
      />

      {/* ── Skorelowane Sygnały ────────────────── */}
      <DataPanel
        title="Skorelowane Sygnały"
        icon={<HubIcon sx={{ color: '#42a5f5' }} />}
        badgeColor="info"
        defaultSortKey="sentAt"
        defaultSortDir="desc"
        columns={[
          { key: 'symbol', label: 'Ticker' },
          {
            key: 'priority',
            label: 'Priorytet',
            render: (v: string) => <PriorityChip value={v} />,
          },
          {
            key: 'catalystType',
            label: 'Wzorzec',
            render: (v: string | null) => v || '—',
          },
          {
            key: 'message',
            label: 'Wiadomość',
            render: (v: string) => {
              if (!v) return '—';
              return <TextDialog label={`${v.slice(0, 80)}${v.length > 80 ? '…' : ''}`} text={v} color="#42a5f5" />;
            },
          },
          {
            key: 'sentAt',
            label: 'Data',
            render: (v: string) => fmtDate(v),
          },
        ]}
        fetchData={async () => {
          const data = await fetchAlerts();
          return (data.alerts || []).filter((a: any) => a.ruleName === 'Correlated Signal');
        }}
      />

      {/* ── Insider Trades (Form 4) ──────────── */}
      <DataPanel
        title="Insider Trades (Form 4)"
        icon={<PersonSearchIcon sx={{ color: '#ff7043' }} />}
        badgeColor="warning"
        defaultSortKey="transactionDate"
        defaultSortDir="desc"
        columns={[
          { key: 'symbol', label: 'Ticker' },
          { key: 'insiderName', label: 'Insider' },
          { key: 'insiderRole', label: 'Rola' },
          {
            key: 'transactionType',
            label: 'Typ',
            render: (v: string) => {
              const color = v === 'BUY' ? '#66bb6a' : v === 'SELL' ? '#ef5350' : '#90a4ae';
              return <Chip label={v} size="small" sx={{ bgcolor: color, color: '#fff', fontWeight: 700, fontSize: '0.65rem' }} />;
            },
          },
          {
            key: 'shares',
            label: 'Akcje',
            render: (v: number) => v ? Number(v).toLocaleString('en-US') : '—',
          },
          {
            key: 'pricePerShare',
            label: 'Cena/szt',
            render: (v: number) => v ? `$${Number(v).toFixed(2)}` : '—',
          },
          {
            key: 'totalValue',
            label: 'Wartość',
            render: (v: number) => {
              const num = Number(v);
              if (!num) return '—';
              const color = num > 100000 ? '#ef5350' : '#90a4ae';
              return <span style={{ color, fontWeight: 700 }}>${num.toLocaleString('en-US')}</span>;
            },
          },
          {
            key: 'transactionDate',
            label: 'Data',
            render: (v: string) => fmtDate(v),
          },
        ]}
        fetchData={async () => {
          const res = await fetch('/api/sentiment/insider-trades?limit=100');
          if (!res.ok) return [];
          const all = (await res.json()).trades || [];
          return all.filter((t: any) => t.transactionType === 'BUY' || t.transactionType === 'SELL');
        }}
      />

      {/* ── PDUFA Calendar (Decyzje FDA) ────── */}
      <DataPanel
        title="PDUFA Kalendarz (Decyzje FDA)"
        icon={<EventIcon sx={{ color: '#42a5f5' }} />}
        badgeColor="info"
        defaultSortKey="pdufaDate"
        defaultSortDir="asc"
        columns={[
          {
            key: 'pdufaDate',
            label: 'Data PDUFA',
            render: (v: string) => {
              const date = new Date(v);
              const now = new Date();
              const daysUntil = Math.ceil((date.getTime() - now.getTime()) / 86400000);
              const color = daysUntil <= 1 ? '#ef5350' : daysUntil <= 3 ? '#ffa726' : daysUntil <= 7 ? '#42a5f5' : '#90a4ae';
              const label = daysUntil > 0 ? `(${daysUntil}d)` : daysUntil === 0 ? '(dziś!)' : '';
              return (
                <span style={{ color, fontWeight: 700 }}>
                  {fmtDate(v)} {label}
                </span>
              );
            },
          },
          { key: 'symbol', label: 'Ticker' },
          { key: 'drugName', label: 'Lek' },
          {
            key: 'indication',
            label: 'Wskazanie',
            render: (v: string) => v || '—',
          },
          {
            key: 'therapeuticArea',
            label: 'Obszar',
            render: (v: string) => v || '—',
          },
          {
            key: 'outcome',
            label: 'Wynik',
            render: (v: string | null) => {
              if (!v) return <span style={{ color: '#90a4ae' }}>Oczekuje</span>;
              const color = v === 'APPROVED' ? '#66bb6a' : v === 'CRL' ? '#ef5350' : '#ffa726';
              return <Chip label={v} size="small" sx={{ bgcolor: color, color: '#fff', fontWeight: 700, fontSize: '0.65rem' }} />;
            },
          },
        ]}
        fetchData={async () => {
          const res = await fetch('/api/sentiment/pdufa?upcoming_only=true&limit=100');
          if (res.ok) return (await res.json()).catalysts || [];
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
        </>
      )}

      {/* Tab 1: System Logs */}
      {activeTab === 1 && <SystemLogsTab />}
    </Container>
  );
}
