/**
 * ═══════════════════════════════════════════════
 * TEST 4: StockTwits (Public Endpoints)
 * ═══════════════════════════════════════════════
 * StockTwits API jest ZAMKNIĘTE dla nowych rejestracji!
 * ALE: publiczne endpointy działają bez tokena.
 * Limit: ~200 req/hour bez auth
 *
 * node scripts/test-stocktwits.js
 */

const BASE = 'https://api.stocktwits.com/api/2';

async function stFetch(endpoint) {
  const res = await fetch(`${BASE}${endpoint}`, {
    headers: { 'User-Agent': 'StockPulse/1.0' },
  });
  
  if (res.status === 429) {
    throw new Error('Rate limit! ~200 req/hour na public endpoints');
  }
  if (!res.ok) {
    throw new Error(`StockTwits error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function testTrendingSymbols() {
  console.log('\n📈 Trending Symbols:');
  const data = await stFetch('/trending/symbols.json');
  
  if (data.symbols) {
    data.symbols.slice(0, 10).forEach((s, i) => {
      console.log(`   ${i + 1}. $${s.symbol} — ${s.title} (watchlist: ${s.watchlist_count})`);
    });
  }
  return data;
}

async function testSymbolStream(symbol) {
  console.log(`\n💬 Stream: $${symbol} (ostatnie wiadomości)`);
  const data = await stFetch(`/streams/symbol/${symbol}.json`);
  
  if (data.messages) {
    console.log(`   Znalezione wiadomości: ${data.messages.length}`);
    
    data.messages.slice(0, 5).forEach((msg, i) => {
      const sentiment = msg.entities?.sentiment?.basic || 'N/A';
      const sentimentIcon = sentiment === 'Bullish' ? '🟢' : sentiment === 'Bearish' ? '🔴' : '⚪';
      const date = new Date(msg.created_at).toISOString().split('T')[0];
      const body = msg.body.substring(0, 100).replace(/\n/g, ' ');
      
      console.log(`   ${i + 1}. ${sentimentIcon} [${date}] @${msg.user.username}: ${body}`);
    });
    
    // Policz sentiment
    const sentiments = { Bullish: 0, Bearish: 0, None: 0 };
    data.messages.forEach(msg => {
      const s = msg.entities?.sentiment?.basic || 'None';
      sentiments[s] = (sentiments[s] || 0) + 1;
    });
    
    const total = data.messages.length;
    console.log(`\n   📊 Sentiment breakdown ($${symbol}):`);
    console.log(`      🟢 Bullish: ${sentiments.Bullish} (${((sentiments.Bullish/total)*100).toFixed(0)}%)`);
    console.log(`      🔴 Bearish: ${sentiments.Bearish} (${((sentiments.Bearish/total)*100).toFixed(0)}%)`);
    console.log(`      ⚪ Neutral: ${sentiments.None} (${((sentiments.None/total)*100).toFixed(0)}%)`);
  }
  
  return data;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  🧪 TEST: StockTwits Public API');
  console.log('═══════════════════════════════════════════════');
  console.log('  ⚠️ Public endpoints — bez auth, ~200 req/h');

  try {
    await testTrendingSymbols();
    
    const symbols = ['AAPL', 'TSLA', 'NVDA'];
    for (const symbol of symbols) {
      await testSymbolStream(symbol);
      await new Promise(r => setTimeout(r, 1000)); // rate limit safety
    }

    console.log('\n═══════════════════════════════════════════════');
    console.log('💬 StockTwits Summary:');
    console.log('   ✅ Trending symbols (public)');
    console.log('   ✅ Symbol streams z wiadomościami');
    console.log('   ✅ Wbudowany sentiment (Bullish/Bearish)');
    console.log('   💰 Koszt: $0 (public endpoints)');
    console.log('   ⚠️ ~200 req/hour bez auth');
    console.log('   ⚠️ Oficjalna rejestracja API zamknięta');
    console.log('   💡 Alternatywa: RapidAPI StockTwits wrapper');
    console.log('\n✅ StockTwits TEST PASSED!\n');

  } catch (err) {
    console.error(`\n❌ BŁĄD: ${err.message}`);
    process.exit(1);
  }
}

main();
