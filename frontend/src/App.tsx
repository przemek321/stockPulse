import { useState } from 'react';
import { Box, Container, Typography, Chip, Divider, Dialog, DialogTitle, DialogContent, IconButton, Tabs, Tab } from '@mui/material';
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
import TopStatusBar from './components/TopStatusBar';
import { fetchTickers, fetchAlertRules, fetchAlerts, fetchFilingsGpt, fetchAlertOutcomes, fetchOptionsFlow, AlertOutcome } from './api';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import SystemLogsTab from './components/SystemLogsTab';
import PriceOutcomePanel from './components/PriceOutcomePanel';
import JetsonStatsBar from './components/JetsonStatsBar';
import SystemHealthPanel from './components/SystemHealthPanel';
import SignalTimeline from './components/SignalTimeline';
import GlossaryTab from './components/GlossaryTab';

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
              bgcolor: '#f5f7fa',
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

// S19-FIX-12 (06.05.2026): label mapping wyciągnięty do shared util — wcześniej
// duplikat w SignalTimeline.tsx z drift'em (brak gpt_missing_data/direction_conflict).
// Centralizuje 15 reason values (10 dispatcher + 4 consensus_* FIX-12 + legacy silent_hour).
import { nonDeliveryLabel } from './utils/nonDeliveryLabel';

/** Chip z kolorem wg priorytetu.
 *  TASK-05 (22.04.2026): gdy alert ma nonDeliveryReason, wizualnie wyciszamy —
 *  chip "default" (szary) + sufix typu "(obserwacja)" — żeby observation mode
 *  nie pokazywał się jak pełny CRITICAL. Magnitude conviction pozostaje w DB
 *  bez zmian (potrzebne do future backtest). */
const PriorityChip = ({ value, row }: {
  value: string;
  row?: { nonDeliveryReason?: string | null };
}) => {
  const reason = row?.nonDeliveryReason;
  const suppressed = !!reason;

  const color = suppressed
    ? 'default'
    : value === 'CRITICAL'
    ? 'error'
    : value === 'HIGH'
    ? 'warning'
    : value === 'MEDIUM'
    ? 'info'
    : 'default';

  const label = suppressed
    ? `${value} (${nonDeliveryLabel(reason)})`
    : value;

  return (
    <Chip
      label={label}
      color={color as any}
      size="small"
      variant={suppressed ? 'outlined' : 'filled'}
    />
  );
};

declare const __BUILD_DATE__: string;

export default function App() {
  const [activeTab, setActiveTab] = useState(0);
  const [dashSubTab, setDashSubTab] = useState(0);

  return (
    <>
      {/* Data kompilacji — prawy dolny róg */}
      <Typography
        sx={{
          position: 'fixed', bottom: 8, right: 12,
          fontSize: '0.65rem', color: 'grey.600', opacity: 0.7, zIndex: 1,
        }}
      >
        Build: {new Date(__BUILD_DATE__).toLocaleString('pl-PL')}
      </Typography>

      {/* Bloomberg-style top bar (logo + metryki + tabs) */}
      <TopStatusBar activeTab={activeTab} onTabChange={setActiveTab} />

      <Container
        maxWidth="lg"
        sx={{
          py: 2,
          px: { xs: 1, sm: 2, md: 3 },
        }}
      >

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
        variant="scrollable"
        scrollButtons={false}
        sx={{ mb: 2 }}
        TabIndicatorProps={{ sx: { height: 3 } }}
      >
        <Tab label="Kluczowe" sx={{ fontWeight: 700, fontSize: { xs: '0.85rem', sm: '0.95rem' } }} />
        <Tab label="Szczegóły & Dane" sx={{ fontWeight: 700, fontSize: { xs: '0.85rem', sm: '0.95rem' } }} />
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
              render: (v: string, row: any) => <PriorityChip value={v} row={row} />,
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
            render: (v: string, row: any) => <PriorityChip value={v} row={row} />,
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
        defaultSortKey="conviction"
        defaultSortDir="desc"
        columns={[
          {
            key: 'symbol',
            label: 'Ticker',
            render: (_v: string, row: any) => {
              const dir = row.direction;
              const type = row.optionType;
              const arrow = dir === 'positive' ? '▲' : dir === 'negative' ? '▼' : '◆';
              const color = dir === 'positive' ? '#66bb6a' : dir === 'negative' ? '#ef5350' : '#90a4ae';
              return (
                <span style={{ fontWeight: 700 }}>
                  {row.symbol}{' '}
                  <span style={{ color, fontSize: '0.7rem' }}>{arrow} {type?.toUpperCase()}</span>
                  {row.pdufaBoosted && <Chip label="PDUFA" size="small" sx={{ ml: 0.5, bgcolor: '#42a5f5', color: '#fff', fontSize: '0.55rem', height: 16 }} />}
                </span>
              );
            },
          },
          {
            key: 'strike',
            label: 'Strike / Cena',
            render: (_v: number, row: any) => {
              const otm = (Number(row.otmDistance) * 100).toFixed(0);
              return (
                <span>
                  <span style={{ fontWeight: 600 }}>${Number(row.strike).toFixed(0)}</span>
                  <span style={{ color: '#90a4ae', fontSize: '0.75rem' }}> / ${Number(row.underlyingPrice).toFixed(2)}</span>
                  <span style={{ color: '#78909c', fontSize: '0.7rem' }}> ({otm}% OTM)</span>
                </span>
              );
            },
          },
          {
            key: '_currentPrice',
            label: 'Kurs',
            render: (_v: number, row: any) => {
              const cur = row._currentPrice;
              if (cur == null) return <span style={{ color: '#555' }}>—</span>;
              const old = Number(row.underlyingPrice);
              const delta = old > 0 ? ((cur - old) / old) * 100 : 0;
              const color = delta > 0 ? '#66bb6a' : delta < 0 ? '#ef5350' : '#999';
              return (
                <span>
                  <span style={{ fontWeight: 700 }}>${cur.toFixed(2)}</span>
                  <span style={{ color, fontSize: '0.7rem', fontWeight: 600 }}> {delta > 0 ? '+' : ''}{delta.toFixed(1)}%</span>
                </span>
              );
            },
          },
          {
            key: 'expiry',
            label: 'Wygasa',
            render: (v: string) => {
              const exp = new Date(v);
              const now = new Date();
              now.setUTCHours(0, 0, 0, 0);
              const dte = Math.ceil((exp.getTime() - now.getTime()) / 86400000);
              const color = dte <= 3 ? '#ef5350' : dte <= 7 ? '#ffa726' : '#90a4ae';
              const dateStr = exp.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
              return (
                <span>
                  <span style={{ color, fontWeight: 700 }}>{dte}d</span>
                  <span style={{ color: '#607d8b', fontSize: '0.7rem' }}> ({dateStr})</span>
                </span>
              );
            },
          },
          {
            key: 'dailyVolume',
            label: 'Volume / Spike',
            render: (_v: number, row: any) => {
              const vol = Number(row.dailyVolume);
              const ratio = Number(row.volumeSpikeRatio);
              const color = ratio >= 10 ? '#ef5350' : ratio >= 5 ? '#ffa726' : '#66bb6a';
              return (
                <span>
                  {vol.toLocaleString()}{' '}
                  <span style={{ color, fontWeight: 700 }}>({ratio.toFixed(1)}×)</span>
                </span>
              );
            },
          },
          {
            key: '_contracts',
            label: 'Kontrakty',
            render: (v: number, row: any) => {
              const n = Number(v);
              const color = n >= 5 ? '#66bb6a' : n >= 3 ? '#ffa726' : '#90a4ae';
              return (
                <span style={{ color, fontWeight: 700 }}>
                  {n}{n > 1 ? ' spike' : ''}
                </span>
              );
            },
          },
          {
            key: '_notional',
            label: 'Ekspozycja',
            render: (_v: number, row: any) => {
              const shares = Number(row.dailyVolume) * 100;
              const fmtShares = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);
              const notional = Number(row._notional);
              const fmtDollar = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}K`;
              return (
                <span>
                  <span style={{ fontWeight: 600 }}>{fmtShares(shares)} szt</span>
                  <span style={{ color: '#78909c', fontSize: '0.7rem' }}> ≈ {fmtDollar(notional)}</span>
                </span>
              );
            },
          },
          {
            key: 'conviction',
            label: 'Conviction',
            render: (v: number) => {
              const n = Number(v);
              const abs = Math.abs(n);
              const color = n > 0 ? '#66bb6a' : n < 0 ? '#ef5350' : '#90a4ae';
              const bars = abs >= 0.6 ? '███' : abs >= 0.4 ? '██░' : abs >= 0.2 ? '█░░' : '░░░';
              return (
                <span style={{ fontWeight: 700 }}>
                  <span style={{ color, fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: -1 }}>{bars}</span>
                  {' '}<span style={{ color }}>{n > 0 ? '+' : ''}{n.toFixed(2)}</span>
                </span>
              );
            },
          },
          {
            key: 'sessionDate',
            label: 'Sesja',
            render: (v: string) => {
              const d = new Date(v);
              return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
            },
          },
        ]}
        fetchData={async () => {
          const res = await fetchOptionsFlow(200);
          const todayMs = new Date().setUTCHours(0, 0, 0, 0);
          const rows = (res.data || []).filter((r: any) => new Date(r.expiry).getTime() >= todayMs);
          const quotes = res.quotes || {};
          // Grupowanie: ile kontraktów spike'uje per ticker+sesja + sumaryczne $
          const grouped = new Map<string, { count: number; totalNotional: number }>();
          for (const r of rows) {
            const key = `${r.symbol}|${r.sessionDate}`;
            const prev = grouped.get(key) || { count: 0, totalNotional: 0 };
            prev.count++;
            prev.totalNotional += Number(r.dailyVolume) * 100 * Number(r.underlyingPrice);
            grouped.set(key, prev);
          }
          return rows.map((r: any) => {
            const g = grouped.get(`${r.symbol}|${r.sessionDate}`)!;
            return {
              ...r,
              _contracts: g.count,
              _notional: Number(r.dailyVolume) * 100 * Number(r.underlyingPrice),
              _sessionNotional: g.totalNotional,
              _currentPrice: quotes[r.symbol] ?? null,
            };
          });
        }}
      />

      {/* ── Trafność Alertów (Price Outcome) ─── */}
      <PriceOutcomePanel />

      </>)}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ═══ SZCZEGÓŁY & DANE — debug, dane źródłowe, config   ═══ */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {dashSubTab === 1 && (<>

      {/* ── Tickery Healthcare ──────────────────────────── */}
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
        ]}
        fetchData={async () => {
          const data = await fetchTickers('healthcare');
          return data.tickers;
        }}
      />

      {/* ── Tickery Semi Supply Chain (observation) ──────── */}
      <DataPanel
        title="Semi Supply Chain (obserwacja)"
        icon={<ShowChartIcon sx={{ color: '#ff9800' }} />}
        badgeColor="warning"
        columns={[
          { key: 'symbol', label: 'Symbol' },
          { key: 'name', label: 'Nazwa' },
          { key: 'subsector', label: 'Koszyk' },
          {
            key: 'priority',
            label: 'Priorytet',
            render: (v: string) => <PriorityChip value={v} />,
          },
          {
            key: 'observationOnly',
            label: 'Tryb',
            render: (v: boolean) => (
              <Chip
                label={v ? 'OBS' : 'LIVE'}
                color={v ? 'warning' : 'success'}
                size="small"
                variant={v ? 'outlined' : 'filled'}
              />
            ),
          },
          { key: 'ceo', label: 'CEO' },
        ]}
        fetchData={async () => {
          const data = await fetchTickers('semi_supply_chain');
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
    </>
  );
}
