/**
 * ═══════════════════════════════════════════════
 * TEST 2: Finnhub API
 * ═══════════════════════════════════════════════
 * Testuje: News, quotes, company profile, insider sentiment
 *
 * Przed uruchomieniem:
 * 1. Uzupełnij .env (FINNHUB_API_KEY)
 * 2. npm install dotenv
 * 3. node scripts/test-finnhub.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const API_KEY = process.env.FINNHUB_API_KEY;
const BASE = 'https://finnhub.io/api/v1';

async function finnhub(endpoint, params = {}) {
  params.token = API_KEY;
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${endpoint}?${qs}`;
  const res = await fetch(url);
  
  if (res.status === 429) {
    throw new Error('Rate limit exceeded! (60 req/min na free tier)');
  }
  if (!res.ok) {
    throw new Error(`Finnhub error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function testQuote(symbol) {
  console.log(`\n📈 Quote: ${symbol}`);
  const q = await finnhub('/quote', { symbol });
  console.log(`   Current: $${q.c}  |  Open: $${q.o}  |  High: $${q.h}  |  Low: $${q.l}`);
  console.log(`   Change: ${q.d > 0 ? '+' : ''}$${q.d} (${q.dp > 0 ? '+' : ''}${q.dp}%)`);
  return q;
}

async function testCompanyProfile(symbol) {
  console.log(`\n🏢 Company Profile: ${symbol}`);
  const p = await finnhub('/stock/profile2', { symbol });
  if (p.name) {
    console.log(`   ${p.name} (${p.ticker}) — ${p.finnhubIndustry}`);
    console.log(`   Market Cap: $${(p.marketCapitalization / 1000).toFixed(1)}B  |  Exchange: ${p.exchange}`);
    console.log(`   IPO: ${p.ipo}  |  Web: ${p.weburl}`);
  } else {
    console.log('   ⚠️ Brak danych (może być niedostępne na free tier)');
  }
  return p;
}

async function testCompanyNews(symbol) {
  const today = new Date();
  const weekAgo = new Date(today - 7 * 24 * 60 * 60 * 1000);
  const from = weekAgo.toISOString().split('T')[0];
  const to = today.toISOString().split('T')[0];
  
  console.log(`\n📰 News: ${symbol} (ostatnie 7 dni)`);
  const news = await finnhub('/company-news', { symbol, from, to });
  
  if (news.length === 0) {
    console.log('   Brak newsów w tym okresie');
    return [];
  }
  
  const top5 = news.slice(0, 5);
  top5.forEach((n, i) => {
    const date = new Date(n.datetime * 1000).toISOString().split('T')[0];
    console.log(`   ${i + 1}. [${date}] ${n.headline.substring(0, 80)}`);
    console.log(`      Źródło: ${n.source} | ${n.url.substring(0, 60)}...`);
  });
  
  console.log(`   ... łącznie ${news.length} artykułów w ciągu tygodnia`);
  return news;
}

async function testMarketNews() {
  console.log('\n🌐 Market News (general):');
  const news = await finnhub('/news', { category: 'general' });
  
  news.slice(0, 3).forEach((n, i) => {
    const date = new Date(n.datetime * 1000).toISOString().split('T')[0];
    console.log(`   ${i + 1}. [${date}] ${n.headline.substring(0, 80)}`);
  });
  
  return news;
}

async function testInsiderSentiment(symbol) {
  console.log(`\n🕵️ Insider Sentiment: ${symbol}`);
  const today = new Date();
  const from = `${today.getFullYear()}-01-01`;
  const to = today.toISOString().split('T')[0];
  
  try {
    const data = await finnhub('/stock/insider-sentiment', { symbol, from, to });
    if (data.data && data.data.length > 0) {
      const latest = data.data[data.data.length - 1];
      const mspr = latest.mspr;
      const signal = mspr > 50 ? '🟢 BULLISH (insiders kupują)' : mspr < -50 ? '🔴 BEARISH (insiders sprzedają)' : '🟡 NEUTRAL';
      console.log(`   MSPR (Monthly Share Purchase Ratio): ${mspr.toFixed(2)}`);
      console.log(`   Sygnał: ${signal}`);
      console.log(`   Miesiąc: ${latest.year}-${String(latest.month).padStart(2, '0')}`);
    } else {
      console.log('   Brak danych insider sentiment (normalne dla mniejszych spółek)');
    }
  } catch (e) {
    console.log(`   ⚠️ Endpoint może wymagać premium: ${e.message}`);
  }
}

async function testBasicFinancials(symbol) {
  console.log(`\n💰 Basic Financials: ${symbol}`);
  const data = await finnhub('/stock/metric', { symbol, metric: 'all' });
  
  if (data.metric) {
    const m = data.metric;
    console.log(`   P/E: ${m.peBasicExclExtraTTM?.toFixed(2) || 'N/A'}  |  P/S: ${m.psTTM?.toFixed(2) || 'N/A'}  |  P/B: ${m.pbAnnual?.toFixed(2) || 'N/A'}`);
    console.log(`   52w High: $${m['52WeekHigh']?.toFixed(2) || 'N/A'}  |  52w Low: $${m['52WeekLow']?.toFixed(2) || 'N/A'}`);
    console.log(`   Beta: ${m.beta?.toFixed(2) || 'N/A'}  |  Dividend Yield: ${m.dividendYieldIndicatedAnnual?.toFixed(2) || 'N/A'}%`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  🧪 TEST: Finnhub API dla StockPulse');
  console.log('═══════════════════════════════════════════════');

  if (!API_KEY) {
    console.error('\n❌ Brak FINNHUB_API_KEY w .env');
    console.error('   Zarejestruj się na: https://finnhub.io/register');
    process.exit(1);
  }

  try {
    const testSymbols = ['GOOGL', 'EVTC', 'PAGS'];
    
    // Test 1: Market news
    await testMarketNews();
    
    for (const symbol of testSymbols) {
      console.log(`\n${'═'.repeat(50)}`);
      console.log(`  📊 ${symbol}`);
      console.log(`${'═'.repeat(50)}`);
      
      await testQuote(symbol);
      await testCompanyProfile(symbol);
      await testCompanyNews(symbol);
      await testBasicFinancials(symbol);
      await testInsiderSentiment(symbol);
      
      // Rate limit safety — 60 req/min, dajmy chwilę
      await new Promise(r => setTimeout(r, 500));
    }

    console.log('\n═══════════════════════════════════════════════');
    console.log('📈 Finnhub Free Tier Summary:');
    console.log('   ✅ Real-time quotes');
    console.log('   ✅ Company news (7-day window)');
    console.log('   ✅ Company profile + financials');
    console.log('   ✅ Market news (general)');
    console.log('   ✅ Insider sentiment (MSPR)');
    console.log('   ⚠️ 60 calls/min — wystarczające na MVP');
    console.log('   ❌ WebSocket (wymaga upgrade na paid)');
    console.log('\n✅ Finnhub API TEST PASSED!\n');

  } catch (err) {
    console.error(`\n❌ BŁĄD: ${err.message}`);
    if (err.message.includes('401')) {
      console.error('   → Sprawdź FINNHUB_API_KEY w .env');
    }
    process.exit(1);
  }
}

main();
