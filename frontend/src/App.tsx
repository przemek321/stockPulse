import { useState } from 'react';
import { Box, Container, Typography, Chip, Divider, Dialog, DialogTitle, DialogContent, IconButton, Tabs, Tab } from '@mui/material';
import TerminalIcon from '@mui/icons-material/Terminal';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import EventIcon from '@mui/icons-material/Event';
import NotificationsIcon from '@mui/icons-material/Notifications';
import RuleIcon from '@mui/icons-material/Rule';
import PsychologyIcon from '@mui/icons-material/Psychology';
import HubIcon from '@mui/icons-material/Hub';

import CollectorStatus from './components/CollectorStatus';
import DataPanel from './components/DataPanel';
import DbSummary from './components/DbSummary';
import { fetchTickers, fetchAlertRules, fetchAlerts, fetchPipelineLogs, fetchFilingsGpt, fetchAlertOutcomes, fetchOptionsFlow, AlertOutcome } from './api';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import SystemLogsTab from './components/SystemLogsTab';
import PriceOutcomePanel from './components/PriceOutcomePanel';
import JetsonStatsBar from './components/JetsonStatsBar';
import SystemHealthPanel from './components/SystemHealthPanel';
import SignalTimeline from './components/SignalTimeline';
import GlossaryTab from './components/GlossaryTab';
import TimelineIcon from '@mui/icons-material/Timeline';
import MenuBookIcon from '@mui/icons-material/MenuBook';

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

/** Formatowanie daty bez godziny (dla filingow, insider trades) */
const fmtDateShort = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

/** Usuniecie escapowania MarkdownV2 z wiadomosci Telegram */
const stripMd = (v: string) =>
  v?.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\$])/g, '$1') || '';

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
  const [dashSubTab, setDashSubTab] = useState(0);

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

      {/* Zakładki główne */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab icon={<DashboardIcon />} iconPosition="start" label="Dashboard" />
        <Tab icon={<TimelineIcon />} iconPosition="start" label="Signal Timeline" />
        <Tab icon={<TerminalIcon />} iconPosition="start" label="System Logs" />
        <Tab icon={<MenuBookIcon />} iconPosition="start" label="Slownik" />
      </Tabs>

      {/* Tab 0: Dashboard */}
      {activeTab === 0 && (
        <>
          {/* Status kolektorów */}
          <JetsonStatsBar />
          <CollectorStatus />

      <Divider sx={{ my: 2 }} />

      {/* Pod-zakładki dashboardu */}
      <Tabs
        value={dashSubTab}
        onChange={(_, v) => setDashSubTab(v)}
        sx={{ mb: 2 }}
        TabIndicatorProps={{ sx: { height: 3 } }}
      >
        <Tab label="Kluczowe" sx={{ fontWeight: 700, fontSize: '0.85rem' }} />
        <Tab label="Szczegóły & Dane" sx={{ fontWeight: 700, fontSize: '0.85rem' }} />
      </Tabs>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ═══ KLUCZOWE — co trzeba widzieć na co dzień             ═══ */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {dashSubTab === 0 && (<>

      {/* ═══ STATUS SYSTEMU — szybki przeglad zdrowia ═══ */}
      <SystemHealthPanel />

      {/* ═══ EDGE SIGNALS — Form 4 + 8-K + Insider ═══ */}
      <Box sx={{
        borderLeft: '4px solid #ffa726',
        pl: 2, mb: 3,
        bgcolor: 'rgba(255, 167, 38, 0.04)',
        borderRadius: '0 8px 8px 0',
        py: 1,
      }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, color: '#ffa726' }}>
          Edge Signals — SEC & Insider
        </Typography>

        {/* ── Analiza GPT Filingów SEC ──────────── */}
        <DataPanel
          title="Analiza GPT Filingów SEC (Form 4 + 8-K)"
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
              key: '_magnitude',
              label: 'Magnitude',
              render: (_: any, row: any) => {
                const mag = row.gptAnalysis?.price_impact?.magnitude;
                if (!mag) return '—';
                const color = mag === 'high' ? '#ef5350' : mag === 'medium' ? '#ffa726' : '#90a4ae';
                return <Chip label={mag} size="small" sx={{ bgcolor: color, color: '#fff', fontWeight: 700, fontSize: '0.65rem' }} />;
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
              render: (v: string) => fmtDateShort(v),
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
            const data = await fetchFilingsGpt(200);
            return data.filings;
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
              key: 'is10b51Plan',
              label: '10b5-1',
              render: (v: boolean) => (
                <Chip
                  label={v ? 'Plan' : 'Discr.'}
                  size="small"
                  sx={{
                    bgcolor: v ? '#616161' : '#ff7043',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.6rem',
                  }}
                />
              ),
            },
            {
              key: 'transactionDate',
              label: 'Data',
              render: (v: string) => fmtDateShort(v),
            },
          ]}
          fetchData={async () => {
            const res = await fetch('/api/sentiment/insider-trades?limit=200');
            if (!res.ok) return [];
            const all = (await res.json()).trades || [];
            return all.filter((t: any) =>
              (t.transactionType === 'BUY' || t.transactionType === 'SELL') &&
              Number(t.totalValue) >= 100000
            );
          }}
        />

        {/* ── Alerty SEC & Insider ──────────────── */}
        <DataPanel
          title="Alerty SEC & Insider"
          icon={<NotificationsIcon sx={{ color: '#ffa726' }} />}
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
            {
              key: 'catalystType',
              label: 'Katalizator',
              render: (v: string | null) => v || '—',
            },
            {
              key: 'delivered',
              label: 'Telegram',
              render: (v: boolean) => (
                <Chip
                  label={v ? 'Wysłano' : 'Silent'}
                  size="small"
                  sx={{
                    bgcolor: v ? '#66bb6a' : '#616161',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.6rem',
                  }}
                />
              ),
            },
            {
              key: 'message',
              label: 'Wiadomość',
              render: (v: string) => {
                if (!v) return '—';
                const clean = stripMd(v);
                return <TextDialog label={`${clean.slice(0, 80)}${clean.length > 80 ? '…' : ''}`} text={clean} color="#ffa726" />;
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
            const edgeRules = new Set([
              'Form 4 Insider Signal',
              '8-K Earnings Miss',
              '8-K Leadership Change',
              '8-K Material Event GPT',
              '8-K Material Event',
              '8-K Bankruptcy',
              'Correlated Signal',
              'Unusual Options Activity',
            ]);
            return (data.alerts || []).filter((a: any) => edgeRules.has(a.ruleName));
          }}
        />
      </Box>


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
              const clean = stripMd(v);
              return <TextDialog label={`${clean.slice(0, 80)}${clean.length > 80 ? '…' : ''}`} text={clean} color="#42a5f5" />;
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

      {/* Panel "Alerty wysłane" usunięty — duplikował "Alerty SEC & Insider" bez filtra */}

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

      {/* ── Options Flow — Volume Spike Detection ─── */}
      <DataPanel
        title="Options Flow — Nietypowa Aktywność Opcyjna"
        icon={<TrendingUpIcon sx={{ color: '#29b6f6' }} />}
        badgeColor="info"
        defaultSortKey="sessionDate"
        defaultSortDir="desc"
        columns={[
          { key: 'symbol', label: 'Ticker' },
          {
            key: 'optionType',
            label: 'Typ',
            render: (v: string) => {
              const color = v === 'call' ? '#66bb6a' : '#ef5350';
              return <Chip label={v?.toUpperCase()} size="small" sx={{ bgcolor: color, color: '#fff', fontWeight: 700, fontSize: '0.65rem' }} />;
            },
          },
          { key: 'strike', label: 'Strike', render: (v: number) => `$${Number(v).toFixed(2)}` },
          { key: 'underlyingPrice', label: 'Underlying', render: (v: number) => `$${Number(v).toFixed(2)}` },
          { key: 'dte', label: 'DTE' },
          { key: 'dailyVolume', label: 'Volume', render: (v: number) => Number(v).toLocaleString() },
          {
            key: 'volumeSpikeRatio',
            label: 'Spike',
            render: (v: number) => {
              const ratio = Number(v);
              const color = ratio >= 10 ? '#ef5350' : ratio >= 5 ? '#ffa726' : '#66bb6a';
              return <span style={{ color, fontWeight: 700 }}>{ratio.toFixed(1)}×</span>;
            },
          },
          {
            key: 'otmDistance',
            label: 'OTM',
            render: (v: number) => `${(Number(v) * 100).toFixed(1)}%`,
          },
          {
            key: 'conviction',
            label: 'Conviction',
            render: (v: number) => {
              const n = Number(v);
              const color = n > 0 ? '#66bb6a' : n < 0 ? '#ef5350' : '#90a4ae';
              return <span style={{ color, fontWeight: 700 }}>{n.toFixed(3)}</span>;
            },
          },
          {
            key: 'direction',
            label: 'Kierunek',
            render: (v: string) => {
              const color = v === 'positive' ? '#66bb6a' : v === 'negative' ? '#ef5350' : '#90a4ae';
              const label = v === 'positive' ? 'BULL' : v === 'negative' ? 'BEAR' : 'MIX';
              return <Chip label={label} size="small" sx={{ bgcolor: color, color: '#fff', fontSize: '0.65rem' }} />;
            },
          },
          {
            key: 'pdufaBoosted',
            label: 'PDUFA',
            render: (v: boolean) => v ? <Chip label="BOOST" size="small" sx={{ bgcolor: '#42a5f5', color: '#fff', fontSize: '0.6rem' }} /> : <span style={{ color: '#555' }}>—</span>,
          },
          { key: 'sessionDate', label: 'Sesja', render: (v: string) => fmtDate(v) },
        ]}
        fetchData={async () => {
          const res = await fetchOptionsFlow(200);
          return res.data || [];
        }}
      />

      {/* ── Trafność Alertów (Price Outcome) ─── */}
      <PriceOutcomePanel />

      </>)}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ═══ SZCZEGÓŁY & DANE — debug, dane źródłowe, config   ═══ */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {dashSubTab === 1 && (<>

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

      </>)}

      <Typography variant="caption" color="text.secondary" sx={{ mt: 4, display: 'block' }}>
        StockPulse v2.0 — Healthcare Edge Detection (Insider + PDUFA + Options)
      </Typography>
        </>
      )}

      {/* Tab 1: System Logs */}
      {/* Tab 1: Signal Timeline */}
      {activeTab === 1 && <SignalTimeline />}

      {/* Tab 2: System Logs */}
      {activeTab === 2 && <SystemLogsTab />}

      {/* Tab 3: Slownik terminow */}
      {activeTab === 3 && <GlossaryTab />}
    </Container>
  );
}
