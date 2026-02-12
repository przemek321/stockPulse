/**
 * ═══════════════════════════════════════════════
 * TEST 5: Telegram Bot
 * ═══════════════════════════════════════════════
 * Testuje: Wysyłanie alertów na Telegram
 *
 * Przed uruchomieniem:
 * 1. Napisz do @BotFather na Telegramie → /newbot
 * 2. Zapisz token do .env (TELEGRAM_BOT_TOKEN)
 * 3. Napisz coś do swojego bota
 * 4. Otwórz: https://api.telegram.org/bot<TOKEN>/getUpdates
 * 5. Znajdź chat.id i zapisz do .env (TELEGRAM_CHAT_ID)
 * 6. node scripts/test-telegram.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tgFetch(method, body = {}) {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram error: ${data.description}`);
  }
  return data.result;
}

async function getBotInfo() {
  console.log('\n🤖 Bot Info:');
  const me = await tgFetch('getMe');
  console.log(`   Name: ${me.first_name}`);
  console.log(`   Username: @${me.username}`);
  console.log(`   ID: ${me.id}`);
  return me;
}

async function getChatId() {
  if (CHAT_ID) return CHAT_ID;
  
  console.log('\n📨 Szukam Chat ID (musisz najpierw napisać do bota!)...');
  const updates = await tgFetch('getUpdates');
  
  if (updates.length === 0) {
    console.log('   ⚠️ Brak wiadomości. Napisz cokolwiek do bota i uruchom ponownie.');
    return null;
  }
  
  const chatId = updates[0].message?.chat?.id;
  console.log(`   ✅ Znaleziony Chat ID: ${chatId}`);
  console.log(`   → Dodaj do .env: TELEGRAM_CHAT_ID=${chatId}`);
  return chatId;
}

async function sendTestAlert(chatId) {
  console.log('\n📤 Wysyłam test alert...');
  
  const message = `
⚡ *StockPulse Alert* — TEST

🔴 *CRITICAL* — \\$MOH Sentiment Crash

📊 *Molina Healthcare* \\(MOH\\)
• Sentiment: \\-0\\.91 \\(ULTRA BEARISH\\)
• Mention volume: 2000\\+ \\(norm: \\~50\\)
• Z\\-score: 15\\.2 \\(\\>3σ ANOMALY\\)

📰 Trigger: 8\\-K Filing \\- Q4 earnings miss
• EPS: \\-\\$2\\.75 vs est\\. \\+\\$0\\.34
• Guidance slashed 63%

⏰ ${new Date().toISOString().replace(/[-:.+]/g, '\\$&')}

_This is a test from StockPulse_ 🧪
`;

  await tgFetch('sendMessage', {
    chat_id: chatId,
    text: message,
    parse_mode: 'MarkdownV2',
  });
  
  console.log('   ✅ Alert wysłany! Sprawdź Telegram.');
}

async function sendSimpleAlert(chatId) {
  // Prostsza wersja bez MarkdownV2 escaping (backup)
  const message = `
⚡ StockPulse Alert — TEST

🟢 BUY SIGNAL — $EVTC
Score: +72/100 (STRONG BUY)
Sentiment: +0.68
Insider Activity: CEO bought $500K

📈 Price: $28.15 (+2.3%)
🕐 ${new Date().toLocaleTimeString()}
`;

  await tgFetch('sendMessage', {
    chat_id: chatId,
    text: message,
  });
  
  console.log('   ✅ Simple alert wysłany!');
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  🧪 TEST: Telegram Bot dla StockPulse');
  console.log('═══════════════════════════════════════════════');

  if (!BOT_TOKEN) {
    console.error('\n❌ Brak TELEGRAM_BOT_TOKEN w .env');
    console.error('   1. Otwórz Telegram → @BotFather');
    console.error('   2. /newbot → podaj nazwę i username');
    console.error('   3. Skopiuj token do .env');
    process.exit(1);
  }

  try {
    await getBotInfo();
    
    const chatId = await getChatId();
    if (!chatId) {
      console.error('\n❌ Nie znaleziono Chat ID.');
      console.error('   Napisz cokolwiek do bota na Telegramie i uruchom ponownie.');
      process.exit(1);
    }

    await sendTestAlert(chatId);
    await new Promise(r => setTimeout(r, 1000));
    await sendSimpleAlert(chatId);

    console.log('\n═══════════════════════════════════════════════');
    console.log('📱 Telegram Bot Summary:');
    console.log('   ✅ Bot authenticated');
    console.log('   ✅ Alert z formatowaniem Markdown');
    console.log('   ✅ Simple text alert');
    console.log('   💰 Koszt: $0');
    console.log('   ⚡ Limit: 30 msg/sec (wystarczy)');
    console.log('\n✅ Telegram Bot TEST PASSED!\n');

  } catch (err) {
    console.error(`\n❌ BŁĄD: ${err.message}`);
    process.exit(1);
  }
}

main();
