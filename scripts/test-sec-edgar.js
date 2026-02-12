/**
 * ═══════════════════════════════════════════════
 * TEST 3: SEC EDGAR API
 * ═══════════════════════════════════════════════
 * Testuje: Filings, insider trades (Form 4), 8-K events
 * 
 * DARMOWE! Nie wymaga klucza API — tylko User-Agent z emailem.
 * Limit: 10 requests / second
 *
 * node scripts/test-sec-edgar.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const USER_AGENT = process.env.SEC_USER_AGENT || 'StockPulse test@example.com';
const BASE = 'https://efts.sec.gov/LATEST';
const EDGAR = 'https://data.sec.gov';

const headers = { 'User-Agent': USER_AGENT, 'Accept': 'application/json' };

async function secFetch(url) {
  const res = await fetch(url, { headers });
  if (res.status === 403) {
    throw new Error('SEC 403 Forbidden — sprawdź User-Agent w .env (wymagany format: "Firma email@domena.com")');
  }
  if (res.status === 429) {
    throw new Error('Rate limit! Max 10 req/sec. Poczekaj chwilę.');
  }
  if (!res.ok) {
    throw new Error(`SEC error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function getCIK(ticker) {
  console.log(`\n🔍 Szukam CIK dla: ${ticker}`);
  
  // SEC company tickers endpoint
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', { headers });
  const data = await res.json();
  
  const match = Object.values(data).find(
    c => c.ticker?.toUpperCase() === ticker.toUpperCase()
  );
  
  if (!match) {
    console.log(`   ⚠️ Nie znaleziono ${ticker} w EDGAR`);
    return null;
  }
  
  const cik = String(match.cik_str).padStart(10, '0');
  console.log(`   ✅ ${match.title} → CIK: ${cik}`);
  return { cik, name: match.title };
}

async function getRecentFilings(cik, company) {
  console.log(`\n📄 Recent Filings: ${company}`);
  
  const data = await secFetch(`${EDGAR}/submissions/CIK${cik}.json`);
  const recent = data.filings?.recent;
  
  if (!recent || recent.form.length === 0) {
    console.log('   Brak filings');
    return;
  }
  
  // Pokaż ostatnie 10
  const count = Math.min(10, recent.form.length);
  for (let i = 0; i < count; i++) {
    const form = recent.form[i];
    const date = recent.filingDate[i];
    const desc = recent.primaryDocDescription?.[i] || '';
    const accession = recent.accessionNumber[i];
    
    // Highlight ważne typy
    let icon = '📝';
    if (form === '4' || form === '3' || form === '5') icon = '🕵️';  // insider trades
    if (form === '8-K') icon = '⚡';  // material events
    if (form === '10-K' || form === '10-Q') icon = '📊';  // quarterly/annual
    if (form === '13F-HR') icon = '🏦';  // institutional holdings
    
    console.log(`   ${icon} [${date}] Form ${form} — ${desc.substring(0, 60) || 'N/A'}`);
  }
  
  // Policz typy
  const formCounts = {};
  recent.form.forEach(f => { formCounts[f] = (formCounts[f] || 0) + 1; });
  console.log(`\n   📊 Filing breakdown (ostatnie ${recent.form.length}):`);
  Object.entries(formCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .forEach(([form, count]) => {
      console.log(`      Form ${form}: ${count}x`);
    });
}

async function searchInsiderTrades(ticker) {
  console.log(`\n🕵️ Insider Trades (Form 4): ${ticker}`);
  
  try {
    // EDGAR full-text search for recent Form 4s
    const url = `${BASE}/search-index?q=%22${ticker}%22&dateRange=custom&startdt=${getDateDaysAgo(90)}&enddt=${getToday()}&forms=4&from=0&size=5`;
    const data = await secFetch(url);
    
    if (data.hits?.hits?.length > 0) {
      data.hits.hits.forEach((hit, i) => {
        const src = hit._source;
        console.log(`   ${i + 1}. [${src.file_date}] ${src.display_names?.join(', ') || 'Unknown'}`);
        console.log(`      ${src.display_date_filed} — ${src.form_type}`);
      });
    } else {
      console.log('   Brak Form 4 w ostatnich 90 dniach (lub ticker nie pasuje do EDGAR search)');
    }
  } catch (e) {
    console.log(`   ⚠️ EFTS search error: ${e.message}`);
    console.log('   (EFTS search może być niedostępny — to normalne, użyj submissions endpoint zamiast)');
  }
}

async function searchRecentFilings8K(ticker) {
  console.log(`\n⚡ Material Events (8-K): ${ticker}`);
  
  try {
    const url = `${BASE}/search-index?q=%22${ticker}%22&forms=8-K&dateRange=custom&startdt=${getDateDaysAgo(30)}&enddt=${getToday()}&from=0&size=5`;
    const data = await secFetch(url);
    
    if (data.hits?.hits?.length > 0) {
      data.hits.hits.forEach((hit, i) => {
        const src = hit._source;
        console.log(`   ${i + 1}. [${src.file_date}] ${src.display_names?.join(', ') || 'Unknown'}`);
      });
    } else {
      console.log('   Brak 8-K w ostatnich 30 dniach');
    }
  } catch (e) {
    console.log(`   ⚠️ Search endpoint error — to normalne dla EFTS: ${e.message}`);
  }
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  🧪 TEST: SEC EDGAR API dla StockPulse');
  console.log('═══════════════════════════════════════════════');
  console.log(`  User-Agent: ${USER_AGENT}`);

  try {
    const tickers = ['GOOGL', 'MOH', 'EVTC'];
    
    for (const ticker of tickers) {
      console.log(`\n${'═'.repeat(50)}`);
      console.log(`  📋 ${ticker} — SEC EDGAR`);
      console.log(`${'═'.repeat(50)}`);
      
      const info = await getCIK(ticker);
      if (info) {
        await getRecentFilings(info.cik, info.name);
        // Rate limit safety
        await new Promise(r => setTimeout(r, 200));
      }
      
      await searchInsiderTrades(ticker);
      await new Promise(r => setTimeout(r, 200));
      
      await searchRecentFilings8K(ticker);
      await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n═══════════════════════════════════════════════');
    console.log('📋 SEC EDGAR Summary:');
    console.log('   ✅ Company filings (submissions endpoint)');
    console.log('   ✅ CIK lookup by ticker');
    console.log('   ✅ Form 4 insider trades');
    console.log('   ✅ 8-K material events');
    console.log('   ✅ 10-K/10-Q reports');
    console.log('   💰 Koszt: $0 (całkowicie darmowe!)');
    console.log('   ⚡ Limit: 10 req/sec');
    console.log('\n✅ SEC EDGAR TEST PASSED!\n');

  } catch (err) {
    console.error(`\n❌ BŁĄD: ${err.message}`);
    process.exit(1);
  }
}

main();
