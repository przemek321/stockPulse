/**
 * Kształty odpowiedzi Reddit API używane przez `RedditService`: token OAuth2
 * (`https://www.reddit.com/api/v1/access_token`) oraz listing postów
 * (`https://oauth.reddit.com/r/<sub>/hot`). `redditFetch` zwraca `unknown`,
 * a każdy endpoint ma tu własny guard/reader odwzorowujący dawne odczyty na `any`.
 *
 * Zasada (jak w `finnhub-api.types.ts`): guard wymusza WYŁĄCZNIE pola, od których
 * zależy przepływ w serwisie. Pola nieużywane są deklarowane opcjonalnie i nie są
 * sprawdzane — brak lub inny typ nie może zmienić decyzji, której dawny kod i tak
 * by nie podjął.
 *
 * Kolektor jest WYŁĄCZONY w produkcji (czeka na dostęp do API) — typy odzwierciedlają
 * dokumentowany kształt Reddit API, nie zarejestrowany payload produkcyjny.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Pole nieobecne / `null` / string — dopuszczalne wartości opcjonalnych pól tekstowych JSON. */
function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

// ---------------------------------------------------------------------------
// POST /api/v1/access_token (grant_type=password)
// ---------------------------------------------------------------------------

/**
 * Odpowiedź OAuth2 przy poprawnych poświadczeniach:
 * ```json
 * { "access_token": "eyJ...", "token_type": "bearer", "expires_in": 86400, "scope": "*" }
 * ```
 * PUŁAPKA: przy błędnych poświadczeniach Reddit oddaje HTTP 200 z `{ "error": "invalid_grant" }`
 * (bez `access_token`) — dlatego guard wymusza `access_token` i `expires_in`, a serwis
 * traktuje niezgodny kształt jako błąd autoryzacji.
 */
export interface RedditOAuthToken {
  access_token: string;
  /** Ważność tokenu w SEKUNDACH (serwis odejmuje 60 s zapasu i mnoży ×1000). */
  expires_in: number;
  token_type?: string;
  scope?: string;
}

export function isRedditOAuthToken(value: unknown): value is RedditOAuthToken {
  return (
    isRecord(value) &&
    typeof value.access_token === 'string' &&
    typeof value.expires_in === 'number'
  );
}

/**
 * Komunikat błędu z odpowiedzi OAuth2 bez tokenu (`{ "error": "invalid_grant" }`);
 * `undefined` gdy odpowiedź nie ma stringowego `error`.
 */
export function readRedditOAuthError(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.error === 'string' ? value.error : undefined;
}

// ---------------------------------------------------------------------------
// GET /r/<subreddit>/hot?limit=25 (listing)
// ---------------------------------------------------------------------------

/**
 * Post (`kind: "t3"`) z listingu. Realny payload (fragment `data.children[].data`):
 * ```json
 * {
 *   "id": "1abc2de", "title": "UNH earnings thread", "selftext": "...", "author": "someuser",
 *   "permalink": "/r/stocks/comments/1abc2de/unh_earnings_thread/", "url": "https://...",
 *   "created_utc": 1756713600.0, "score": 123, "num_comments": 45, "subreddit": "stocks"
 * }
 * ```
 * `created_utc` = unix ts w SEKUNDACH (serwis mnoży ×1000). `selftext` bywa pustym
 * stringiem (posty-linki); `author` = `"[deleted]"` dla usuniętych kont.
 * `url`/`score`/`num_comments`/`subreddit` nie są używane i nie są wymuszane w guardzie.
 */
export interface RedditPost {
  id: string;
  title: string;
  permalink: string;
  created_utc: number;
  selftext?: string | null;
  author?: string | null;
  url?: string;
  score?: number;
  num_comments?: number;
  subreddit?: string;
}

export interface RedditListingChild {
  kind?: string;
  data: RedditPost;
}

export interface RedditListing {
  kind?: string;
  data: {
    children: RedditListingChild[];
    after?: string | null;
    before?: string | null;
  };
}

/**
 * Obiekt z czterema polami, od których zależy zapis wzmianki (`id` → externalId,
 * `title` → body, `permalink` → url, `created_utc` → publishedAt) we właściwym typie;
 * `selftext`/`author` nieobecne, `null` albo string (serwis podstawia `''`/`'unknown'`).
 */
export function isRedditPost(value: unknown): value is RedditPost {
  if (!isRecord(value)) return false;
  const { author, created_utc, id, permalink, selftext, title } = value;
  return (
    typeof id === 'string' &&
    typeof title === 'string' &&
    typeof permalink === 'string' &&
    typeof created_utc === 'number' &&
    isOptionalString(selftext) &&
    isOptionalString(author)
  );
}

/**
 * Odpowiednik dawnego `if (!data?.data?.children) return 0` + `for (child of children) child.data`:
 * brak obiektu / brak tablicy `data.children` → `[]` (serwis zwraca 0 dla subreddita).
 * Dzieci bez obiektu `data` albo bez kompletu pól z `isRedditPost` są pomijane —
 * dawny kod zapisałby wzmiankę z `reddit_undefined` / `Invalid Date` (albo rzucił
 * TypeError łapany w `collect`). W realnym listingu każdy post ma komplet pól,
 * więc filtr jest wyłącznie zabezpieczeniem typów.
 */
export function readRedditListingPosts(data: unknown): RedditPost[] {
  if (!isRecord(data) || !isRecord(data.data) || !isUnknownArray(data.data.children)) {
    return [];
  }
  const posts: RedditPost[] = [];
  for (const child of data.data.children) {
    if (isRecord(child) && isRedditPost(child.data)) posts.push(child.data);
  }
  return posts;
}
