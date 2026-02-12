/**
 * ═══════════════════════════════════════════════
 * TEST ALL: Uruchom wszystkie testy API
 * ═══════════════════════════════════════════════
 * 
 * Sprawdza które API keys są skonfigurowane
 * i uruchamia odpowiednie testy.
 *
 * node scripts/test-all.js
 */

require('dotenv').config();
const { execSync } = require('child_process');

const tests = [
  {
    name: 'StockTwits (Public)',
    script: 'test-stocktwits.js',
    envRequired: [],  // no auth needed!
    cost: 'FREE',
    priority: '⭐⭐⭐⭐⭐',
  },
  {
    name: 'SEC EDGAR',
    script: 'test-sec-edgar.js',
    envRequired: [],  // only User-Agent
    cost: 'FREE',
    priority: '⭐⭐⭐⭐⭐',
  },
  {
    name: 'Finnhub',
    script: 'test-finnhub.js',
    envRequired: ['FINNHUB_API_KEY'],
    cost: 'FREE (60 req/min)',
    priority: '⭐⭐⭐⭐⭐',
  },
  {
    name: 'Reddit',
    script: 'test-reddit.js',
    envRequired: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USERNAME', 'REDDIT_PASSWORD'],
    cost: 'FREE (100 req/min)',
    priority: '⭐⭐⭐⭐',
  },
  {
    name: 'Telegram Bot',
    script: 'test-telegram.js',
    envRequired: ['TELEGRAM_BOT_TOKEN'],
    cost: 'FREE',
    priority: '⭐⭐⭐⭐',
  },
];

function checkEnv(vars) {
  return vars.every(v => process.env[v] && process.env[v].length > 0);
}

async function main() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  ⚡ StockPulse — API Test Suite               ║');
  console.log('╚═══════════════════════════════════════════════╝\n');

  // Status overview
  console.log('📋 Status konfiguracji:\n');
  
  const ready = [];
  const missing = [];
  
  for (const test of tests) {
    const isReady = checkEnv(test.envRequired);
    const status = isReady ? '✅ READY' : '❌ BRAK';
    const missingVars = test.envRequired.filter(v => !process.env[v]);
    
    console.log(`   ${status}  ${test.name.padEnd(22)} ${test.cost.padEnd(20)} ${test.priority}`);
    if (!isReady && missingVars.length > 0) {
      console.log(`           Brakuje: ${missingVars.join(', ')}`);
    }
    
    if (isReady) ready.push(test);
    else if (test.envRequired.length > 0) missing.push(test);
    else ready.push(test); // no env needed
  }

  console.log(`\n   Gotowe: ${ready.length}/${tests.length} API\n`);

  if (ready.length === 0) {
    console.log('⚠️ Żadne API nie jest skonfigurowane!');
    console.log('   Skopiuj .env.example → .env i uzupełnij klucze.');
    process.exit(1);
  }

  // Run tests
  console.log('═══════════════════════════════════════════════');
  console.log('  🚀 Uruchamiam testy...');
  console.log('═══════════════════════════════════════════════\n');

  const results = [];
  
  for (const test of ready) {
    console.log(`\n${'━'.repeat(50)}`);
    console.log(`  🧪 ${test.name}`);
    console.log(`${'━'.repeat(50)}`);
    
    try {
      execSync(`node scripts/${test.script}`, { 
        stdio: 'inherit', 
        cwd: process.cwd(),
        timeout: 30000 
      });
      results.push({ name: test.name, status: '✅ PASS' });
    } catch (err) {
      results.push({ name: test.name, status: '❌ FAIL' });
    }
  }

  // Summary
  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║  📊 WYNIKI TESTÓW                             ║');
  console.log('╠═══════════════════════════════════════════════╣');
  results.forEach(r => {
    console.log(`║  ${r.status}  ${r.name.padEnd(38)}║`);
  });
  
  if (missing.length > 0) {
    missing.forEach(m => {
      console.log(`║  ⏭️  ${m.name.padEnd(38)} (pominięto) ║`);
    });
  }
  console.log('╚═══════════════════════════════════════════════╝');

  const passed = results.filter(r => r.status.includes('PASS')).length;
  const failed = results.filter(r => r.status.includes('FAIL')).length;
  
  console.log(`\n   ✅ Passed: ${passed}  ❌ Failed: ${failed}  ⏭️ Skipped: ${missing.length}`);
  
  if (failed === 0 && passed > 0) {
    console.log('\n   🎉 Wszystkie skonfigurowane API działają! Gotowy na Sprint 1.');
  }
  
  console.log('');
}

main();
