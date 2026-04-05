import { Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, Accordion, AccordionSummary, AccordionDetails, Box, Alert as MuiAlert } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const PriorityChip = ({ p }: { p: string }) => {
  const color = p === 'KRYTYCZNY' ? 'error' : p === 'WYSOKI' ? 'warning' : p === 'SREDNI' ? 'info' : 'default';
  return <Chip label={p} color={color as any} size="small" sx={{ fontSize: '0.65rem', height: 20 }} />;
};

const S = ({ children, title, intro }: { children: React.ReactNode; title: string; intro?: string }) => (
  <Accordion defaultExpanded={false} sx={{ bgcolor: 'transparent', '&:before': { display: 'none' }, boxShadow: 'none', mb: 0.5 }}>
    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
      <Typography variant="subtitle2" fontWeight={700}>{title}</Typography>
    </AccordionSummary>
    <AccordionDetails sx={{ px: 0, pt: 0 }}>
      {intro && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, lineHeight: 1.6 }}>{intro}</Typography>}
      {children}
    </AccordionDetails>
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
            {row.map((cell, j) => <TableCell key={j} sx={{ py: 0.5, fontSize: '0.7rem', lineHeight: 1.5 }}>{cell}</TableCell>)}
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
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Kompletny przewodnik po metrykach, skrotach i terminach finansowych uzywanych na dashboardzie, w alertach Telegram i w Signal Timeline.
        Kazda sekcja zawiera wyjasnienie jak interpretowac dane i na co zwracac uwage.
      </Typography>
      <MuiAlert severity="info" sx={{ mb: 2, fontSize: '0.75rem' }}>
        <strong>Jak czytac sygnaly:</strong> Pojedynczy alert z conviction 0.5 to slab y sygnal (~55% trafnosc, niewiele lepszy niz moneta).
        Sekwencja 2-3 alertow w tym samym kierunku na jednym tickerze z hit rate &gt;70% — to jest edge.
        Signal Timeline pokazuje te sekwencje. Patrzuj na: consistency kierunku, hit rate, i czy rozne zrodla (insider + opcje + 8-K) sie potwierdzaja.
      </MuiAlert>

      <S title="Metryki sygnalw — priorytet interpretacji"
         intro="Metryki uszeregowane od najwazniejszych. Conviction i hit rate to dwa kluczowe wskazniki — razem mowia czy sygnal ma realna wartosc predykcyjna. Pozostale metryki (gap, delta, consistency) pomagaja ulozyc sygnaly w kontekst i rozpoznac rozwijajace sie patterny.">
        <T headers={['Termin', 'Skrot', 'Znaczenie', 'Priorytet']} rows={[
          ['Conviction', 'conv',
            'Sila przekonania AI (Claude Sonnet) o kierunku ceny. Skala od -2.0 (silnie bearish) do +2.0 (silnie bullish). ' +
            'Wartosc bliska 0 = brak sygnalu. |conv| < 0.3 = slaby (ignoruj), 0.3-0.7 = umiarkowany, 0.7-1.2 = silny, >1.2 = bardzo silny (rzadki). ' +
            'Na dashboardzie: zielony chip = bullish, czerwony = bearish. Pomaranczowy border przy |conv| >= 0.4, czerwony przy >= 0.7.',
            <PriorityChip p="KRYTYCZNY" />],
          ['Hit Rate 1d', 'hit rate',
            'Procent alertow na danym tickerze, gdzie przewidziany kierunek potwierdzil sie rzeczywista zmiana ceny po 1 dniu handlowym. ' +
            'Przyklad: 10 alertow bearish, w 7 przypadkach cena faktycznie spadla = hit rate 70%. ' +
            'Interpretacja: >70% = realny edge (system trafnie przewiduje), 50-60% = moneta (brak wartosci predykcyjnej), <40% = kontrarian sygnal (rynek robi odwrotnie). ' +
            'UWAGA: Hit rate ma sens dopiero od 5+ alertow — przy 3 alertach 67% moze byc przypadkiem.',
            <PriorityChip p="KRYTYCZNY" />],
          ['Direction', 'dir, ▲/▼',
            'Kierunek sygnalu przewidziany przez system. Positive (▲ zielona strzalka) = oczekujemy ze cena wzrosnie (bullish). ' +
            'Negative (▼ czerwona strzalka) = oczekujemy spadku (bearish). Na Signal Timeline strzalka jest przy kazdej karcie sygnalu. ' +
            'Direction jest ustalany: dla Form 4 — z analizy Claude (SELL = negative, BUY = positive), ' +
            'dla Options — z call/put ratio (wiekszosc call = positive), dla korelacji — z dominant direction skladowych.',
            <PriorityChip p="WYSOKI" />],
          ['Direction Consistency', 'consistency',
            'Jaki procent alertow na danym tickerze idzie w tym samym kierunku. ' +
            'Przyklad: CNC ma 8 alertow, z tego 6 bullish i 2 bearish = consistency 75% bullish. ' +
            'Interpretacja: >80% = silny jednokierunkowy pattern (insider selling cascade lub bullish options flow), ' +
            '50-60% = mixed signals (jeden dzien call, nastepny put — brak edge), <50% = sprzeczne sygnaly. ' +
            'Wyswietlany jako chip w summary bar Signal Timeline (np. "75% bullish").',
            <PriorityChip p="WYSOKI" />],
          ['Price at Alert', 'priceAtAlert',
            'Cena akcji pobrana z Finnhub API (endpoint /quote, pole "c" = current/last close) w momencie tworzenia alertu. ' +
            'To jest punkt referencyjny — od niego liczone sa wszystkie delty procentowe (1h, 4h, 1d, 3d). ' +
            'Dla alertow wysylanych poza sesja NYSE (Options Flow 22:15 UTC, SEC pre-market) jest to cena zamkniecia poprzedniej sesji.',
            <PriorityChip p="WYSOKI" />],
          ['Delta 1h/4h/1d/3d', '+1h%, +4h%, +1d%, +3d%',
            'Procentowa zmiana ceny w stosunku do priceAtAlert po danym czasie. ' +
            'Przyklad: priceAtAlert = $100, price1d = $102 → delta 1d = +2.00%. ' +
            'Zielona wartosc = cena wzrosla, czerwona = spadla. ' +
            'WAZNE: Sloty 1h/4h sa liczone od otwarcia NYSE (9:30 ET) dla alertow pre-market, ' +
            'wiec delta 1h = cena godzine po otwarciu sesji, nie godzine po alercie. ' +
            'Delta 1d i 3d to najwazniejsze — pokazuja czy sygnal mial racje w horyzoncie inwestycyjnym.',
            <PriorityChip p="WYSOKI" />],
          ['Gap', 'gap',
            'Czas w godzinach miedzy aktualnym alertem a poprzednim na tym samym tickerze. ' +
            'Wyswietlany jako separator miedzy kartami w Signal Timeline (np. "23h gap"). ' +
            'Interpretacja: gap < 48h + ten sam kierunek = pattern sie buduje (insider sprzedaje ponownie). ' +
            'Gap > 7 dni = sygnaly niepowiazane czasowo, mniejsza wartosc korelacji.',
            <PriorityChip p="SREDNI" />],
          ['Price Delta from Prev', 'delta od poprz.',
            'Zmiana ceny w % miedzy momentem poprzedniego alertu a momentem aktualnego. ' +
            'Pokazuje co rynek zrobil w przerwie miedzy sygnalami. ' +
            'Przyklad: pierwszy alert przy $32.74, drugi przy $33.95 = delta +3.70%. ' +
            'Jezeli bearish alert, a cena miedzy sygnalami rosla — to moze byc szum (rynek ignoruje sygnaly).',
            <PriorityChip p="SREDNI" />],
          ['Same Direction', 'zgodny/sprzeczny',
            'Czy aktualny alert ma ten sam kierunek (positive/negative) co poprzedni alert na tym tickerze. ' +
            'Na Signal Timeline: zielony separator = "zgodny" (pattern sie wzmacnia, np. 3 bearish z rzedu), ' +
            'czerwony separator = "sprzeczny" (flip — wczoraj bullish, dzis bearish = mixed signal, brak edge). ' +
            'Seria 3+ zgodnych sygnalw z roznych zrodel (insider + opcje + korelacja) = najsilniejszy edge w systemie.',
            <PriorityChip p="SREDNI" />],
          ['Avg Gap', 'avg gap',
            'Sredni czas miedzy alertami na danym tickerze (w godzinach lub dniach). ' +
            'Przyklad: 8 alertow w 30 dni, avg gap = 3.7d. ' +
            'Krotki avg gap (1-2 dni) = ticker jest aktywny (duzo insider tradow lub opcji) — wiecej danych do analizy. ' +
            'Dlugi avg gap (>7 dni) = sporadyczne sygnaly — trudniej zbudowac pattern.',
            <PriorityChip p="NISKI" />],
        ]} />
      </S>

      <S title="Typy alertow (7 aktywnych regul)"
         intro="System ma 19 zdefiniowanych regul, z ktorych 7 jest aktywnych. Kazda regula monitoruje inne zrodlo danych i inny typ zdarzenia. Najsilniejsze sygnaly to te gdzie rozne reguly potwierdzaja ten sam kierunek na jednym tickerze (np. insider sell + bearish opcje + negatywny 8-K).">
        <T headers={['Regula', 'Skrot', 'Co wykrywa', 'Zrodlo']} rows={[
          [<strong>Form 4 Insider Signal</strong>, 'Form4',
            'Transakcja insiderska (kupno lub sprzedaz akcji) przez osobe z kadry zarzadzajacej (CEO, CFO, EVP itd.). ' +
            'System filtruje: tylko discretionary (bez planow 10b5-1), totalValue > $100K. ' +
            'Claude Sonnet analizuje kontekst: rola insidera, wielkosc transakcji vs posiadane akcje, historia 30 dni, profil tickera. ' +
            'CEO sprzedajacy 30% swoich akcji bez planu 10b5-1 = silny sygnal bearish. Director sprzedajacy 2% = slaby.',
            'SEC EDGAR Form 4'],
          [<strong>8-K Material Event GPT</strong>, '8-K',
            'Istotne zdarzenie korporacyjne zglaszane do SEC na formularzu 8-K. Moze byc: nowy kontrakt (Item 1.01), ' +
            'wyniki kwartalne (Item 2.02), zmiana CEO/CFO (Item 5.02), bankructwo (Item 1.03), decyzja FDA, M&A. ' +
            'Claude Sonnet czyta pelna tresc dokumentu SEC i ocenia wplyw na cene. ' +
            'Parser automatycznie wykrywa typ Item i wybiera specjalistyczny prompt.',
            'SEC EDGAR 8-K'],
          [<strong>8-K Earnings Miss</strong>, '8-K Earnings',
            'Wyniki kwartalne (Item 2.02: Results of Operations) gorsze od oczekiwan rynkowych. ' +
            'Claude analizuje: revenue vs consensus, EPS miss/beat, zmiana guidance (prognoz), MLR (Medical Loss Ratio dla ubezpieczycieli). ' +
            'Earnings miss + obnizenie guidance = silny bearish. Earnings miss ale podtrzymanie guidance = slabszy sygnal.',
            '8-K Item 2.02'],
          [<strong>8-K Leadership Change</strong>, '8-K Leadership',
            'Zmiana na kluczowym stanowisku kierowniczym (Item 5.02: Departure/Appointment of Officers). ' +
            'Claude rozroznia 3 scenariusze: (A) Planowe odejscie z nastepca = neutralne (conv ±0.1-0.5), ' +
            '(B) Nagle odejscie bez nastepcy = bearish kryzysowy (conv -0.8 do -1.5), ' +
            '(C) Relief rally — odejscie niepopularnego CEO = bullish (conv +0.2 do +0.5). ' +
            'Przyklad: BIIB CLO odchodzi planowo z 2.5-miesiecznym przejsciem = conv -0.2 (neutralne).',
            '8-K Item 5.02'],
          [<strong>8-K Bankruptcy</strong>, '8-K Bankruptcy',
            'Wniosek o upadlosc (Item 1.03: Bankruptcy or Receivership). ' +
            'Natychmiastowy alert CRITICAL z conviction -1.0 — BEZ czekania na analize Claude. ' +
            'To jedyny typ alertu ktory omija AI i idzie bezposrednio na Telegram. ' +
            'Bankructwo spolki healthcare = niemal pewny spadek akcji do ~$0.',
            '8-K Item 1.03'],
          [<strong>Correlated Signal</strong>, 'Correlated',
            'Dwa lub wiecej niezaleznych zrodel sygnalu potwierdzaja ten sam kierunek na jednym tickerze w krotkim oknie czasowym. ' +
            'To najsilniejszy typ alertu — multi-source confirmation. ' +
            '3 wzorce: INSIDER_CLUSTER (2+ insiders sprzedaje w 7 dni), ' +
            'INSIDER_PLUS_8K (insider + 8-K w 24h), INSIDER_PLUS_OPTIONS (insider + anomalia opcyjna w 72h). ' +
            'Agregowana conviction z najsilniejszego sygnalu + 20% boost per dodatkowe zrodlo, cap 1.0.',
            'CorrelationService (Redis)'],
          [<strong>Unusual Options Activity</strong>, 'Options',
            'Anomalia wolumenu opcji: dzisiejszy volume >= 3x sredniej z ostatnich 20 sesji, minimum 100 kontraktow, minimum 5 dni danych. ' +
            'Scoring heurystyczny (bez AI): 35% spike ratio + 20% volume + 15% OTM + 15% DTE + 15% call/put dominance. ' +
            'WAZNE: Standalone alert wychodzi na Telegram TYLKO gdy ticker ma nadchodzaca date decyzji FDA (PDUFA) w ciagu 30 dni ' +
            '(PDUFA boost x1.3). Bez PDUFA kontekstu options spike = szum (52.5% hit rate — moneta). ' +
            'Spike ratio > 1000x = suspicious (anomalia danych Polygon), conviction automatycznie x0.5.',
            'Polygon.io (EOD)'],
        ]} />
      </S>

      <S title="Wzorce korelacji (3 aktywne)"
         intro="CorrelationService monitoruje sygnaly z roznych zrodel w Redis Sorted Sets i szuka zbieznosci czasowych. Gdy 2+ niezalezne zrodla wskazuja ten sam kierunek na jednym tickerze w krotkim oknie — generuje alert Correlated Signal. To najmocniejszy sygnalw systemie bo eliminuje ryzyko falszywego alarmu z jednego zrodla.">
        <T headers={['Wzorzec', 'Co wykrywa', 'Okno', 'Przyklad']} rows={[
          ['INSIDER_CLUSTER', '2+ insiders z kadry zarzadzajacej (C-suite) sprzedaje lub kupuje ten sam ticker. Klaster insiderski to silniejszy sygnal niz pojedyncza transakcja — sugeruje ze wiecej osob z wewnatrz firmy ma te sama informacje.', '7 dni', 'CEO i CFO sprzedaja GILD w ciagu 5 dni = bearish cluster'],
          ['INSIDER_PLUS_8K', 'Insider trade pojawia sie w tym samym czasie co filing 8-K (material event). Insider mogl wiedziec o zdarzeniu zanim zostalo upublicznione — to jest typowy pattern insider tradingu.', '24h', 'CFO sprzedaje $500K BIIB, nastepnego dnia 8-K o odejsciu CLO'],
          ['INSIDER_PLUS_OPTIONS', 'Insider trade pokrywa sie z anomalia na rynku opcji. Smart money (insiderzy) i smart money (opcje) ida w te sama strone — silna konfirmacja kierunku.', '72h', 'CEO kupuje $1M BMY + call options spike 38x na tym samym tickerze'],
        ]} />
      </S>

      <S title="Terminy opcyjne (Options Flow)"
         intro="Options Flow to dane o wolumenie opcji pobierane codziennie po zamknieciu sesji NYSE z Polygon.io. System szuka anomalii — dni gdzie volume opcji jest wielokrotnie wyzszy niz zwykle. Taka anomalia moze wskazywac ze ktos z informacja (smart money) stawia duzy zaklad na ruch ceny.">
        <T headers={['Termin', 'Skrot', 'Znaczenie']} rows={[
          ['Spike Ratio', 'spike',
            'Stosunek dzisiejszego wolumenu opcji do sredniej z 20 ostatnich sesji. ' +
            'Przyklad: sredni volume opcji CALL na BMY $60 = 41 kontraktow/dzien, dzis = 1560 → spike ratio = 38x. ' +
            'Minimum do wykrycia: 3x. Silny sygnal: 10x+. ' +
            'UWAGA: Spike ratio > 1000x (np. MRNA 5032x) to anomalia danych Polygon (np. nowa seria opcji z avg=1), ' +
            'nie realny spike — system automatycznie obcina conviction x0.5.'],
          ['Call/Put Ratio', 'call/put',
            'Proporcja opcji CALL (prawo kupna = bullish zaklad) do PUT (prawo sprzedazy = bearish zaklad) w wykrytych anomaliach. ' +
            '>0.65 = call dominance — wiekszosc anomalii to opcje CALL, sygnal bullish. ' +
            '<0.35 = put dominance — wiekszosc anomalii to opcje PUT, sygnal bearish. ' +
            '0.35-0.65 = mixed — brak jasnego kierunku, conviction automatycznie x0.7 (penalty za niezdecydowanie).'],
          ['OTM Distance', 'OTM%',
            'Out-of-the-money distance — jak daleko strike price opcji jest od aktualnej ceny akcji. ' +
            'Przyklad: akcja = $60, call strike $61 = OTM 1.7%. Call strike $75 = OTM 25%. ' +
            'Opcje blisko ceny (OTM < 5%) sa drogie i wazne — ktos placi premium za realistyczny zaklad. ' +
            'Opcje daleko (OTM > 20%) sa tanie i spekulacyjne — mniej wiarygodny sygnal. ' +
            'System filtruje: OTM <= 30% (odrzuca skrajne spekulacje).'],
          ['DTE', 'DTE',
            'Days to Expiration — ile dni pozostalo do wygasniecia opcji. ' +
            'Krotkie DTE (1-7 dni) = pilny sygnal — ktos stawia na ruch ceny w tym tygodniu (np. przed earnings, FDA). ' +
            'Dlugie DTE (30-60 dni) = mniej pilne, moze byc hedging lub dlugoterminowa pozycja. ' +
            'System filtruje: DTE <= 60 (odrzuca LEAPS — zbyt dlugi horyzont). ' +
            'Przyklad: BMY $60 Call, DTE 1 dzien, spike 82x = pilny bullish sygnal na jutro.'],
          ['PDUFA Boost', 'PDUFA',
            'Mnoznik x1.3 na conviction gdy dany ticker ma nadchodzaca date decyzji FDA (PDUFA) w ciagu 30 dni. ' +
            'PDUFA = Prescription Drug User Fee Act — termin w ktorym FDA musi podjac decyzje o zatwierdzeniu leku. ' +
            'Opcje na tickerze z PDUFA datA + spike = ktos prawdopodobnie stawia na wynik decyzji FDA. ' +
            'To jest jedyny warunek pod ktorym Options Flow generuje standalone alert na Telegram (bez PDUFA = tylko zapis do DB i korelacji). ' +
            'Powod: bez kontekstu FDA, options spike ma hit rate 52.5% — moneta.'],
        ]} />
      </S>

      <S title="Terminy insiderskie (Form 4)"
         intro="SEC wymaga od insiderow (kadra zarzadzajaca, dyrektorzy, udziałowcy >10%) raportowania kazdej transakcji na swoich akcjach w ciagu 2 dni roboczych na formularzu Form 4. System monitoruje te filingi co 30 minut i analizuje je Claude Sonnet.">
        <T headers={['Termin', 'Znaczenie']} rows={[
          ['Discretionary',
            'Transakcja wykonana z wlasnej woli insidera — on sam podjal decyzje o kupnie/sprzedazy. ' +
            'To jest realny sygnal informacyjny: insider wie cos o firmie i dziala na tej wiedzy. ' +
            'System analizuje TYLKO discretionary trades (is10b51Plan = false). ' +
            'Przyklad: CEO sprzedaje 30% swoich akcji bez planu — moze wiedziec o zblizajacych sie zlych wynikach.'],
          ['10b5-1 Plan',
            'Pre-zaplanowany, automatyczny plan sprzedazy akcji zarejestrowany w SEC. ' +
            'Insider ustala z gory: "sprzedaj 10,000 akcji co miesiac przez rok" — i plan sie wykonuje automatycznie. ' +
            'Niski sygnal informacyjny — decyzja byla podjeta miesiace/lata temu, nie odzwierciedla biezacej wiedzy. ' +
            'System POMIJA transakcje z 10b5-1 plan (is10b51Plan = true → skip w Form4Pipeline). ' +
            'UWAGA: Insider moze anulowac plan 10b5-1 a potem zalozyc nowy z innymi parametrami — to jest sygnal, ale trudny do wykrycia.'],
          ['C-suite',
            'Kadra najwyzszego szczebla zarzadzania: CEO (Chief Executive Officer), CFO (Chief Financial Officer), ' +
            'COO (Chief Operating Officer), CMO (Chief Medical Officer), CTO (Chief Technology Officer), ' +
            'President, Chairman of the Board, EVP (Executive Vice President). ' +
            'Transakcje C-suite maja wyzszy priorytet niz transakcje Directors czy VPs — maja lepszy dostep do informacji. ' +
            'System automatycznie boostuje priorytet alertu (MEDIUM → HIGH) gdy insider jest C-suite.'],
          ['Cluster selling',
            'Sytuacja gdy 2 lub wiecej insiderow z tej samej firmy sprzedaje akcje w ciagu 7 dni. ' +
            'To silniejszy sygnal niz pojedyncza sprzedaz — sugeruje ze wiecej osob z wewnatrz ma negatywna informacje. ' +
            'System wykrywa to jako wzorzec INSIDER_CLUSTER w CorrelationService. ' +
            'Przyklad: CEO i CFO GILD sprzedaja lacznie $3M w 5 dni → conviction agregowany z boostem 20%.'],
        ]} />
      </S>

      <S title="Price Outcome — sledzenie trafnosci"
         intro="System mierzy trafnosc kazdego alertu — zapisuje cene w momencie alertu i potem co godzine (w godzinach sesji NYSE) sprawdza jak cena sie zmienila. To pozwala obiektywnie ocenic ktore reguly i ktore tickery daja trafne sygnaly.">
        <T headers={['Termin', 'Znaczenie']} rows={[
          ['Price at Alert',
            'Cena akcji pobrana z Finnhub API w momencie tworzenia alertu. To jest punkt zero — od niego mierzymy czy alert mial racje. ' +
            'Dla alertow wysylanych poza sesja (Options Flow o 22:15 UTC) jest to cena zamkniecia ostatniej sesji.'],
          ['Effective Start',
            'Czas od ktorego liczone sa sloty cenowe (1h, 4h, 1d, 3d). ' +
            'Alerty w trakcie sesji NYSE: effective start = czas alertu. ' +
            'Alerty poza sesja (pre-market, po sesji, weekend): effective start = najblizsze otwarcie NYSE (9:30 ET). ' +
            'Dzieki temu price1h i price4h pokazuja realne zmiany intraday, a nie te sama cene zamkniecia.'],
          ['Price 1h / 4h / 1d / 3d',
            'Cena akcji po 1 godzinie / 4 godzinach / 1 dniu / 3 dniach od effective start. ' +
            'Uzupelniane przez CRON co godzine, TYLKO gdy gielda NYSE jest otwarta (pon-pt 9:30-16:00 ET). ' +
            'Poza sesja cena = last close (bez wartosci), dlatego system czeka na otwarcie. ' +
            'Max 30 zapytan Finnhub na cykl CRON (free tier 60 req/min).'],
          ['Direction Correct',
            'Czy alert trafnie przewidzial kierunek ceny po 1 dniu: ' +
            '✓ (zielony haczyk) = trafny: alert bearish (▼) i cena spadla, LUB alert bullish (▲) i cena wzrosla. ' +
            '✗ (czerwony krzyzyk) = nietrafny: alert bearish ale cena wzrosla, lub odwrotnie. ' +
            '— (szary myslnik) = brak danych (price1d jeszcze nie wypelniony lub brak alertDirection).'],
          ['Price Outcome Done',
            'Flaga oznaczajaca ze CRON zakonczyl zbieranie cen dla tego alertu. ' +
            'Ustawiana gdy: (A) wszystkie 4 sloty (1h, 4h, 1d, 3d) sa wypelnione, LUB (B) minal hard timeout 7 dni od alertu ' +
            '(uwzglednia weekendy i swieta — piatkowy alert moze potrzebowac do srody na 3d).'],
        ]} />
      </S>

      <S title="Status Systemu (panel na dashboardzie)"
         intro="Panel Status Systemu na gorze zakladki Dashboard pokazuje w czasie rzeczywistym (auto-refresh 60s) czy kolektory dzialaja, ile jest bledow, i ile alertow przetwarza pipeline.">
        <T headers={['Termin', 'Znaczenie']} rows={[
          ['HEALTHY / WARNING / CRITICAL',
            'Ogolny status systemu. HEALTHY (zielony) = zero bledow kolektorow w 24h i zero bledow systemowych. ' +
            'WARNING (pomaranczowy) = 1-2 bledy w 24h — np. timeout SEC EDGAR (czesto jednorazowy, naprawia sie sam). ' +
            'CRITICAL (czerwony) = 3+ bledy w 24h na jednym kolektorze — moze oznaczac problem z API, kluczem, lub siecia.'],
          ['Errors 24h',
            'Liczba bledow danego kolektora w ostatnich 24 godzinach. ' +
            '0 = wszystko OK. 1-2 = prawdopodobnie jednorazowy timeout. 3+ = sprawdz logi (System Logs → filtr module).'],
          ['Failed jobs 7d',
            'Liczba jobow BullMQ ktore zakonczyly sie bledem w ostatnich 7 dniach. ' +
            'Normalnie 0. Jesli > 0 — sprawdz co to za joby w System Logs.'],
          ['Pipeline 24h: total (AI)',
            'Ile filingow SEC zostalo przetworzonych w ostatnich 24h. ' +
            '"422 total" = 422 filingow przeszlo przez pipeline. "(89 AI)" = 89 z nich wyslano do Claude Sonnet do analizy. ' +
            'Roznica = filingi odrzucone przez filtry (10b5-1 plan, niska wartosc, daily cap).'],
          ['Delivered vs Silent',
            'Delivered = alert wyslany na Telegram i dostarczony. ' +
            'Silent = alert zapisany w bazie danych ale NIE wyslany na Telegram (regula w SILENT_RULES lub daily limit osiagniety). ' +
            'Silent alerty sa przydatne do analizy retrospektywnej ale nie zasmiecaja Telegram.'],
          ['Daily limit',
            'Maksymalnie 5 alertow Telegram per ticker per dzien (UTC). ' +
            'Zapobiega spamowi — np. HIMS mial 46 alertow/tydzien przed limitem. ' +
            'Silent rules (Sentiment Crash, Strong FinBERT) nie licza sie do limitu. ' +
            'Po osiagnieciu limitu alerty sa nadal zapisywane w DB ale nie wysylane.'],
        ]} />
      </S>

      <S title="Priorytety alertow">
        <T headers={['Priorytet', 'Ikona', 'Kiedy', 'Przyklad']} rows={[
          ['CRITICAL', '🔴',
            'Bankructwo (Item 1.03), korelacja multi-source (2+ zrodla), opcje z |conviction| >= 0.7.',
            'BIIB: 8-K Bankruptcy → natychmiastowy alert. BMY: insider + options spike = Correlated CRITICAL.'],
          ['HIGH', '🟠',
            'Insider discretionary C-suite z analiza Claude, 8-K z istotnym eventem, opcje z PDUFA boost.',
            'VRTX: EVP sprzedaje $439K discretionary. CNC: 8-K zmiana CFO.'],
          ['MEDIUM', '🔵',
            'Insider mniejszej rangi (Director, VP), 8-K rutynowy (renewal kontraktu).',
            'REGN: Director sprzedaje $77K. GDRX: 8-K Item 4.01 (zmiana audytora).'],
          ['LOW', '⚪',
            'Nie wysylany na Telegram — tylko zapis do bazy danych. Uzywany do analizy retrospektywnej.',
            'Alerty ponizej progu priority w score8kPriority() lub scoreForm4Priority().'],
        ]} />
      </S>

      <S title="Ticker Profile — kontekst AI (Sprint 14)"
         intro="Od Sprint 14 kazdy prompt wysylany do Claude Sonnet zawiera profil historyczny tickera (200-400 tokenow). Claude widzi track record — ile razy sygnaly na tym tickerze byly trafne, jaki jest dominujacy kierunek, i co wydarzylo sie ostatnio. Dzieki temu kalibruje conviction na podstawie danych, nie zgaduje.">
        <T headers={['Termin', 'Znaczenie']} rows={[
          ['Signal Profile',
            'Blok tekstu wstrzykiwany do promptu Claude przed skala conviction. Zawiera: ' +
            'liczbe sygnalow w 90 dni, hit rate 1d, sredni |ruch| ceny, breakdown per regula (Form4 4x hit 75%, Options 6x hit 50%), ' +
            'dominant direction (bullish/bearish/mixed), i 3 ostatnie sygnaly z faktycznym ruchem ceny. ' +
            'Cache in-memory 2h — nie obciaza bazy przy kazdym requestcie.'],
          ['Calibration Rules',
            'Konkretne instrukcje dla Claude jak uzywac profilu: ' +
            '"Hit rate > 70%: boost |conviction| by 0.1-0.3" — jesli sygnaly na tym tickerze sa trafne, zwieksz pewnosc. ' +
            '"Hit rate < 40%: reduce |conviction| by 0.1-0.3" — jesli sygnaly sa nietrafne, zmniejsz pewnosc. ' +
            '"Recent 3 signals all same direction: developing pattern" — seria w jednym kierunku to rozwijajacy sie pattern.'],
          ['Dominant Direction',
            'Dominujacy kierunek sygnalow na tickerze w ostatnich 90 dniach. ' +
            'Bullish = >50% sygnalow ma direction positive. Bearish = >50% negative. Mixed = okolo 50/50. ' +
            'Uzywany przez Claude do kontekstualizacji: jesli ticker jest konsekwentnie bearish i przychodzi kolejny sell — to wzmacnia sygnal.'],
        ]} />
      </S>

      <Box sx={{ mt: 3, p: 2, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 1, border: '1px solid rgba(255,255,255,0.08)' }}>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>Jak czytac Signal Timeline — krok po kroku</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
          1. Wybierz ticker z dropdown (posortowane po ilosci alertow — wiecej = wiecej danych do analizy).<br/>
          2. Sprawdz <strong>summary bar</strong>: hit rate &gt;70% + consistency &gt;80% = ticker z edge'em. Hit rate ~50% = szum.<br/>
          3. Patrz na <strong>kolory separatorow</strong>: seria zielonych (zgodny kierunek) = rozwijajacy sie pattern. Czerwone = mixed.<br/>
          4. Sprawdz <strong>conviction</strong> na chipach: |conv| &gt; 0.7 z CRITICAL priority = silny sygnal. conv ~0.5 HIGH = umiarkowany.<br/>
          5. Patrz na <strong>rozne typy regul</strong>: jesli Form4 + Options + Correlated ida w te sama strone = multi-source confirmation.<br/>
          6. Sprawdz <strong>delty cenowe</strong> (✓/✗): czy alert mial racje? Seria ✓ = system dobrze czyta ten ticker.<br/>
          7. <strong>Nie handluj na pojedynczym alercie</strong> z conv 0.5 i hit rate 55%. Szukaj sekwencji 2-3 sygnalow z roznych zrodel.
        </Typography>
      </Box>
    </Paper>
  );
}
