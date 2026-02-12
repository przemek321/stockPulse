/**
 * ═══════════════════════════════════════════════
 * TEST 1: Reddit API
 * ═══════════════════════════════════════════════
 * Testuje: OAuth2 token → pobranie postów z r/wallstreetbets
 * 
 * Przed uruchomieniem:
 * 1. Uzupełnij .env (REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD)
 * 2. npm install dotenv
 * 3. node scripts/test-reddit.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const REDDIT = {
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
  userAgent: process.env.REDDIT_USER_AGENT || 'StockPulse/1.0',
};

async function getAccessToken() {
  console.log('🔑 Pobieranie Reddit OAuth2 tokena...');
  
  const auth = Buffer.from(`${REDDIT.clientId}:${REDDIT.clientSecret}`).toString('base64');
  
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': REDDIT.userAgent,
    },
    body: new URLSearchParams({
      grant_type: 'password',
      username: REDDIT.username,
      password: REDDIT.password,
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(`Reddit auth error: ${data.error} — ${data.message || ''}`);
  }
  
  console.log(`✅ Token otrzymany! Expires in: ${data.expires_in}s, Scope: ${data.scope}`);
  return data.access_token;
}

async function getSubredditPosts(token, subreddit, limit = 10) {
  console.log(`\n📡 Pobieram ${limit} postów z r/${subreddit}...`);
  
  const response = await fetch(`https://oauth.reddit.com/r/${subreddit}/hot?limit=${limit}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': REDDIT.userAgent,
    },
  });
  
  if (!response.ok) {
    throw new Error(`Reddit API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  const posts = data.data.children.map(child => ({
    title: child.data.title,
    author: child.data.author,
    score: child.data.score,
    num_comments: child.data.num_comments,
    created_utc: new Date(child.data.created_utc * 1000).toISOString(),
    url: `https://reddit.com${child.data.permalink}`,
  }));
  
  return posts;
}

// Prosty ticker extractor — na test
function extractTickers(text) {
  const cashtags = text.match(/\$[A-Z]{1,5}\b/g) || [];
  const knownTickers = ['AAPL', 'TSLA', 'NVDA', 'GOOGL', 'MSFT', 'AMZN', 'META', 'GME', 'AMC', 'PAGS', 'EVTC', 'MU', 'MOH'];
  const wordMatches = knownTickers.filter(t => text.toUpperCase().includes(t));
  const all = [...new Set([...cashtags.map(t => t.replace('$', '')), ...wordMatches])];
  return all;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  🧪 TEST: Reddit API dla StockPulse');
  console.log('═══════════════════════════════════════════════\n');

  // Sprawdź env
  if (!REDDIT.clientId || !REDDIT.clientSecret) {
    console.error('❌ Brak REDDIT_CLIENT_ID lub REDDIT_CLIENT_SECRET w .env');
    console.error('   Instrukcje: https://www.reddit.com/prefs/apps');
    process.exit(1);
  }

  try {
    // 1. Auth
    const token = await getAccessToken();

    // 2. Pobierz posty z kilku subredditów
    const subreddits = ['wallstreetbets', 'stocks', 'investing'];
    
    for (const sub of subreddits) {
      const posts = await getSubredditPosts(token, sub, 5);
      
      console.log(`\n📊 r/${sub} — Top 5 postów:`);
      console.log('─'.repeat(60));
      
      posts.forEach((post, i) => {
        const tickers = extractTickers(post.title);
        const tickerStr = tickers.length > 0 ? ` [${tickers.map(t => '$' + t).join(', ')}]` : '';
        console.log(`  ${i + 1}. ⬆️${post.score} 💬${post.num_comments} — ${post.title.substring(0, 80)}${tickerStr}`);
      });
    }

    // 3. Rate limit check
    console.log('\n📈 Rate limit info:');
    console.log('   Reddit API: 100 requests / minute (OAuth2)');
    console.log('   Nasz polling: co 30-60 sekund = ~1-2 req/min per subreddit');
    console.log('   Daleko od limitu ✅');

    console.log('\n✅ Reddit API TEST PASSED! Gotowy do użycia w StockPulse.\n');

  } catch (err) {
    console.error(`\n❌ BŁĄD: ${err.message}`);
    if (err.message.includes('invalid_grant')) {
      console.error('   → Sprawdź username/password w .env');
      console.error('   → Jeśli masz 2FA na Reddit, musisz je wyłączyć dla script apps');
    }
    process.exit(1);
  }
}

main();
