import { Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const PriorityChip = ({ p }: { p: string }) => {
  const color = p === 'KRYTYCZNY' ? 'error' : p === 'WYSOKI' ? 'warning' : p === 'SREDNI' ? 'info' : 'default';
  return <Chip label={p} color={color as any} size="small" sx={{ fontSize: '0.65rem', height: 20 }} />;
};

const S = ({ children, title }: { children: React.ReactNode; title: string }) => (
  <Accordion defaultExpanded={false} sx={{ bgcolor: 'transparent', '&:before': { display: 'none' }, boxShadow: 'none' }}>
    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 36, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
      <Typography variant="subtitle2" fontWeight={700}>{title}</Typography>
    </AccordionSummary>
    <AccordionDetails sx={{ px: 0, pt: 0 }}>{children}</AccordionDetails>
  </Accordion>
);

const T = ({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) => (
  <TableContainer sx={{ mb: 1 }}>
    <Table size="small">
      <TableHead>
        <TableRow>{headers.map((h, i) => <TableCell key={i} sx={{ py: 0.5, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>)}</TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i}>
            {row.map((cell, j) => <TableCell key={j} sx={{ py: 0.3, fontSize: '0.7rem' }}>{cell}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </TableContainer>
);

export default function GlossaryTab() {
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>Slownik terminow StockPulse</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
        Wszystkie metryki, skroty i terminy uzywane na dashboardzie i w alertach Telegram.
      </Typography>

      <S title="Metryki sygnalw — priorytet interpretacji">
        <T headers={['Termin', 'Skrot', 'Znaczenie', 'Priorytet']} rows={[
          ['Conviction', 'conv', 'Sila przekonania AI o kierunku ceny. Skala -2.0 do +2.0. Ujemna = bearish, dodatnia = bullish.', <PriorityChip p="KRYTYCZNY" />],
          ['Hit Rate 1d', 'hit rate', '% alertow gdzie kierunek potwierdzil sie cena po 1 dniu. >70% = edge, <50% = moneta.', <PriorityChip p="KRYTYCZNY" />],
          ['Direction', 'dir, ▲/▼', 'Kierunek sygnalu: positive (▲ bullish) = wzrost, negative (▼ bearish) = spadek.', <PriorityChip p="WYSOKI" />],
          ['Direction Consistency', 'consistency', '% alertow w dominujacym kierunku na tickerze. 90% = trend, 50% = szum.', <PriorityChip p="WYSOKI" />],
          ['Price at Alert', 'priceAtAlert', 'Cena akcji w momencie alertu (Finnhub /quote). Punkt odniesienia dla delt.', <PriorityChip p="WYSOKI" />],
          ['Delta 1h/4h/1d/3d', '+1h%, +1d%', 'Zmiana ceny w % od priceAtAlert. Zielony = wzrost, czerwony = spadek.', <PriorityChip p="WYSOKI" />],
          ['Gap', 'gap', 'Czas (h) miedzy kolejnymi alertami na tickerze. Krotki gap + ten sam kierunek = pattern.', <PriorityChip p="SREDNI" />],
          ['Price Delta from Prev', 'delta od poprz.', 'Zmiana ceny % miedzy dwoma kolejnymi alertami.', <PriorityChip p="SREDNI" />],
          ['Same Direction', 'zgodny/sprzeczny', 'Czy alert ma ten sam kierunek co poprzedni. Zielony = pattern, czerwony = mixed.', <PriorityChip p="SREDNI" />],
          ['Avg Gap', 'avg gap', 'Sredni czas miedzy alertami. Krotki = aktywny ticker, dlugi = sporadyczne.', <PriorityChip p="NISKI" />],
        ]} />
      </S>

      <S title="Typy alertow (7 aktywnych regul)">
        <T headers={['Regula', 'Skrot', 'Co wykrywa', 'Zrodlo']} rows={[
          [<strong>Form 4 Insider Signal</strong>, 'Form4', 'Insider (CEO/CFO/EVP) kupuje/sprzedaje. Tylko discretionary. Claude analizuje.', 'SEC EDGAR Form 4'],
          [<strong>8-K Material Event GPT</strong>, '8-K', 'Istotne zdarzenie korporacyjne. Claude analizuje tresc.', 'SEC EDGAR 8-K'],
          [<strong>8-K Earnings Miss</strong>, '8-K Earnings', 'Wyniki kwartalne gorsze od oczekiwan.', '8-K Item 2.02'],
          [<strong>8-K Leadership Change</strong>, '8-K Leadership', 'Zmiana CEO/CFO/CLO. Claude rozroznia: planowa vs kryzys vs relief rally.', '8-K Item 5.02'],
          [<strong>8-K Bankruptcy</strong>, '8-K Bankruptcy', 'Wniosek o upadlosc. CRITICAL bez czekania na AI.', '8-K Item 1.03'],
          [<strong>Correlated Signal</strong>, 'Correlated', '2+ zrodla potwierdzaja kierunek (insider+opcje, insider+8-K, cluster).', 'CorrelationService'],
          [<strong>Unusual Options Activity</strong>, 'Options', 'Volume >= 3x sredniej 20d. Alert TYLKO z PDUFA boost.', 'Polygon.io EOD'],
        ]} />
      </S>

      <S title="Wzorce korelacji (3 aktywne)">
        <T headers={['Wzorzec', 'Co wykrywa', 'Okno']} rows={[
          ['INSIDER_CLUSTER', '2+ insiders C-suite sprzedaje/kupuje ten sam ticker', '7 dni'],
          ['INSIDER_PLUS_8K', 'Insider trade + filing 8-K na tym samym tickerze', '24h'],
          ['INSIDER_PLUS_OPTIONS', 'Insider trade + anomalia opcyjna', '72h'],
        ]} />
      </S>

      <S title="Terminy opcyjne (Options Flow)">
        <T headers={['Termin', 'Skrot', 'Znaczenie']} rows={[
          ['Spike Ratio', 'spike', 'Volume dzis / srednia 20d. 3x = min, 10x = silny, >1000x = suspicious.'],
          ['Call/Put Ratio', 'call/put', '>0.65 = call dominance (bullish), <0.35 = put dominance (bearish), 0.35-0.65 = mixed.'],
          ['OTM Distance', 'OTM%', 'Odleglosc strike od ceny. 2% = blisko (wazne), 25% = daleko (spekulacja).'],
          ['DTE', 'DTE', 'Days to Expiration. Krotsze = pilniejszy sygnal.'],
          ['PDUFA Boost', 'PDUFA', 'Mnoznik x1.3 gdy ticker ma date FDA < 30 dni. Standalone alert TYLKO z boost.'],
        ]} />
      </S>

      <S title="Terminy insiderskie (Form 4)">
        <T headers={['Termin', 'Znaczenie']} rows={[
          ['Discretionary', 'Transakcja z wlasnej woli insidera (realny sygnal). Przeciwienstwo planu 10b5-1.'],
          ['10b5-1 Plan', 'Pre-zaplanowany auto plan sprzedazy. Niski sygnal — CEO moze miec plan niezaleznie od newsow.'],
          ['C-suite', 'CEO, CFO, COO, CMO, CTO, President, Chairman, EVP. Wyzszy priorytet.'],
          ['Cluster selling', '2+ insiders sprzedaje ten sam ticker w 7 dni. Silniejszy sygnal bearish.'],
        ]} />
      </S>

      <S title="Price Outcome (sledzenie cen)">
        <T headers={['Termin', 'Znaczenie']} rows={[
          ['Price at Alert', 'Cena w momencie alertu. Punkt referencyjny.'],
          ['Effective Start', 'Alerty pre-market → start od otwarcia NYSE (9:30 ET). W sesji → od momentu alertu.'],
          ['Price 1h/4h/1d/3d', 'Cena po 1h/4h/1d/3d od effective start.'],
          ['Direction Correct', '▲ + cena wzrosla = trafny (✓), ▲ + cena spadla = nietrafny (✗).'],
          ['Price Outcome Done', 'Wszystkie 4 sloty wypelnione lub hard timeout 7d.'],
        ]} />
      </S>

      <S title="Status Systemu">
        <T headers={['Termin', 'Znaczenie']} rows={[
          ['HEALTHY / WARNING / CRITICAL', 'HEALTHY = 0 bledow 24h. WARNING = 1-2. CRITICAL = 3+.'],
          ['Errors 24h', 'Bledy kolektora w ostatnich 24h.'],
          ['Failed jobs 7d', 'Nieudane joby BullMQ w 7 dniach.'],
          ['Pipeline 24h: total (AI)', 'Filingi SEC przetworzone w 24h. "(89 AI)" = wyslane do Claude.'],
          ['Delivered vs Silent', 'Delivered = na Telegram. Silent = w DB bez wysylki.'],
          ['Daily limit', 'Max 5 alertow Telegram per ticker per dzien.'],
        ]} />
      </S>

      <S title="Priorytety alertow">
        <T headers={['Priorytet', 'Ikona', 'Kiedy']} rows={[
          ['CRITICAL', '🔴', 'Bankruptcy, korelacja multi-source, opcje conv >= 0.7'],
          ['HIGH', '🟠', 'Insider discretionary, 8-K z Claude, opcje z PDUFA boost'],
          ['MEDIUM', '🔵', 'Insider mniejszy, 8-K rutynowy'],
          ['LOW', '⚪', 'Nie wysylany na Telegram (tylko DB)'],
        ]} />
      </S>

      <S title="Ticker Profile (kontekst AI)">
        <T headers={['Termin', 'Znaczenie']} rows={[
          ['Signal Profile', 'Profil historyczny (90d) wstrzykiwany do promptu Claude. Hit rate, direction, breakdown per regula.'],
          ['Calibration Rules', 'Instrukcje: hit rate >70% → boost conviction, <40% → reduce conviction.'],
          ['Dominant Direction', 'Dominujacy kierunek na tickerze: bullish / bearish / mixed.'],
        ]} />
      </S>
    </Paper>
  );
}
