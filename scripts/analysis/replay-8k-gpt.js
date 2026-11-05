/*
 * Replay analizy GPT dla 8-K BEZ zapisu do bazy (raport informacyjny, NIE sygnał).
 *
 * Powód (05.11.2026): 27.10–05.11 API Anthropic bez kredytów → 23 filingi 8-K dostały SKIP_VM_OFFLINE i nie mają
 * analizy ani wiersza w alerts. Ponowne puszczenie przez pipeline dałoby alerty z dzisiejszą ceną wejścia (zafałszowany
 * pomiar), więc ten skrypt odtwarza TYLKO część „co powiedziałby GPT”: te same funkcje co Form8kPipeline (fetch filingu
 * i Exhibit 99.1, detectItems, extractItemText, prompt builder, guidance facts, parseGptResponse, guidance floor, sign fix,
 * missing-data guard, scoreToAlertPriority, mapToRuleName, bullish gate). Różnice wobec produkcji (świadome):
 *   - brak konsensusu Alpha Vantage (FIX-12) — dziś zwracałby dane po fakcie; 2.02 bullish → 'bullish_no_consensus_data',
 *     bearish 2.02 może w produkcji trafić w consensus guard (oznaczone w wyniku),
 *   - brak profilu sygnałowego tickera (signalProfile = null), throttle i dziennego limitu.
 * Zero zapisu: nie używa repozytoriów TypeORM, nie wysyła Telegrama.
 *
 * Uruchomienie (w kontenerze app, wejście = JSON z listą filingów {id, symbol, name, url, collected_at}):
 *   docker cp in.json stockpulse-app:/tmp/in.json && docker cp replay-8k-gpt.js stockpulse-app:/tmp/r.js
 *   docker exec stockpulse-app node /tmp/r.js /tmp/in.json > out.jsonl
 */
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
const D = '/app/dist/sec-filings';
const { detectItems, extractItemText, selectPromptBuilder, isBankruptcyItem, stripHtml, MAX_TEXT_LENGTH } = require(`${D}/parsers/form8k.parser`);
const { Form8kPipeline, formatGuidanceFactsForPrompt } = require(`${D}/pipelines/form8k.pipeline`);
const { extractGuidanceStatus, shouldEnforceConvictionFloor } = require(`${D}/utils/extract-guidance-status`);
const { detectMissingDataFacts } = require(`${D}/utils/missing-data-detector`);
const { parseGptResponse } = require(`${D}/types/sec-filing-analysis`);
const { scoreToAlertPriority, mapToRuleName } = require(`${D}/scoring/price-impact.scorer`);

const fake = {
  userAgent: process.env.SEC_USER_AGENT || 'StockPulse replay',
  logger: { warn: () => {}, debug: () => {}, log: () => {}, error: () => {} },
};
const P = Form8kPipeline.prototype;
fake.fetchDirectDocument = P.fetchDirectDocument.bind(fake);
const fetchFilingText = P.fetchFilingText.bind(fake);
const fetchExhibit991 = P.fetchExhibit991.bind(fake);

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 240000, maxRetries: 1 });
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wariant NIEPRODUKCYJNY (05.11): gdy regex produkcji nie znajduje Exhibit 99.1 (np. LLY
// „q326lillysalesandearningsp.htm”), bierzemy największy .htm w katalogu filingu poza dokumentem głównym i R*.htm.
async function fetchExhibitFallback(url) {
  const dir = url.substring(0, url.lastIndexOf('/'));
  const main = url.substring(url.lastIndexOf('/') + 1).toLowerCase();
  const res = await fetch(`${dir}/index.json`, { headers: { 'User-Agent': fake.userAgent, Accept: 'application/json' } });
  if (!res.ok) return null;
  const items = ((await res.json()).directory || {}).item || [];
  const cands = items.filter((i) => /\.html?$/i.test(i.name) && i.name.toLowerCase() !== main
    && !/^r\d+\.htm$/i.test(i.name) && !/index/i.test(i.name))
    .sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
  if (!cands.length) return null;
  const doc = await fetch(`${dir}/${cands[0].name}`, { headers: { 'User-Agent': fake.userAgent } });
  if (!doc.ok) return null;
  return { name: cands[0].name, text: stripHtml(await doc.text()) };
}

async function analyzeOne(f, fallbackExhibit) {
  const out = { id: f.id, symbol: f.symbol, collected_at: f.collected_at };
  const text = await fetchFilingText(f.url);
  if (!text || text.length < 100) return { ...out, outcome: 'SKIP_SHORT_TEXT' };
  const items = detectItems(text);
  out.items = items;
  if (items.length === 0) return { ...out, outcome: 'SKIP_NO_ITEMS' };
  const mainItem = items.find((i) => !isBankruptcyItem(i));
  out.mainItem = mainItem;
  if (!mainItem) return { ...out, outcome: 'BANKRUPTCY_ONLY' };
  const builder = selectPromptBuilder(mainItem);
  if (!builder) return { ...out, outcome: 'SKIP_NO_PROMPT' };
  await sleep(300);
  let exhibit = null;
  if (items.includes('2.02')) {
    const ex = await fetchExhibit991(f.url);
    if (ex && ex.length > 200) exhibit = ex;
    if (!exhibit && fallbackExhibit) {
      const fb = await fetchExhibitFallback(f.url);
      if (fb && fb.text.length > 200) { exhibit = fb.text; out.exhibit_fallback = fb.name; }
    }
  }
  out.exhibit991 = Boolean(exhibit);
  out.variant = fallbackExhibit ? 'z zapasowym exhibitem (NIEPRODUKCYJNY)' : 'wierny produkcji';
  let itemText = extractItemText(text, mainItem);
  if (exhibit) itemText = (itemText + '\n\n=== EXHIBIT 99.1 (PRESS RELEASE) ===\n\n' + exhibit).slice(0, MAX_TEXT_LENGTH);
  const guidance = extractGuidanceStatus(exhibit ? text + '\n\n' + exhibit : text);
  const prompt = builder(f.symbol, f.name, itemText, mainItem, null, formatGuidanceFactsForPrompt(guidance), null);

  const t0 = Date.now();
  const msg = await client.messages.create({
    model, max_tokens: 1024,
    messages: [{ role: 'user', content: prompt + '\n\nRespond with JSON only. No markdown, no preamble, no explanation.' }],
  });
  out.gpt_seconds = Math.round((Date.now() - t0) / 1000);
  const raw = msg.content[0].text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  let a;
  try { a = parseGptResponse(raw); } catch (e) { return { ...out, outcome: 'SKIP_INVALID_JSON', error: String(e).slice(0, 200) }; }
  out.conviction_raw = a.conviction;
  if (shouldEnforceConvictionFloor(guidance) && a.conviction < -0.3) a.conviction = -0.3;
  if (a.price_impact.direction === 'negative' && a.conviction > 0) a.conviction = -a.conviction;
  else if (a.price_impact.direction === 'positive' && a.conviction < 0) a.conviction = -a.conviction;
  Object.assign(out, {
    direction: a.price_impact.direction, magnitude: a.price_impact.magnitude, confidence: a.price_impact.confidence,
    conviction: a.conviction, catalyst: a.catalyst_type, conclusion: a.conclusion, key_facts: a.key_facts,
  });
  if (detectMissingDataFacts(a.key_facts).length > 0) {
    return { ...out, conviction: Math.max(-0.3, Math.min(0.3, a.conviction)), rule: mapToRuleName(a, '8-K'), outcome: 'gpt_missing_data' };
  }
  const priority = scoreToAlertPriority(a, '8-K');
  out.priority = priority;
  if (!priority) return { ...out, outcome: 'SKIP_LOW_PRIORITY (brak alertu)' };
  const rule = mapToRuleName(a, '8-K');
  out.rule = rule;
  const eff = a.price_impact.direction === 'neutral' ? (a.conviction >= 0 ? 'positive' : 'negative') : a.price_impact.direction;
  out.effective_direction = eff;
  if (eff === 'positive') {
    out.outcome = mainItem === '2.02' ? 'bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)' : 'bullish_8k_no_edge';
  } else if (rule === '8-K Material Event GPT') {
    out.outcome = 'material_event_obs';
  } else if (mainItem === '2.02') {
    out.outcome = 'DELIVERED? (bearish 2.02 — w produkcji najpierw consensus guard FIX-12)';
  } else {
    out.outcome = 'DELIVERED (Telegram)';
  }
  return out;
}

(async () => {
  const filings = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  for (const f of filings) {
    try {
      const r = await analyzeOne(f, false);
      process.stdout.write(JSON.stringify(r) + '\n');
      // drugi przebieg tylko tam, gdzie produkcja nie miała exhibitu dla 2.02
      if ((r.items || []).includes('2.02') && !r.exhibit991) {
        process.stdout.write(JSON.stringify(await analyzeOne(f, true)) + '\n');
      }
    } catch (e) {
      process.stdout.write(JSON.stringify({ id: f.id, symbol: f.symbol, outcome: 'ERROR', error: String(e).slice(0, 300) }) + '\n');
    }
  }
})();
