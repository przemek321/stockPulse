/**
 * Narzędzia do sprawdzania godzin sesji NYSE.
 * NYSE: poniedziałek-piątek, 9:30-16:00 Eastern Time (America/New_York).
 * DST obsługiwane automatycznie przez Intl.DateTimeFormat.
 */

/** Formatter do konwersji UTC → Eastern Time */
const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hour12: false,
});

/**
 * Parsuje datę UTC na komponenty Eastern Time.
 * Używa Intl.DateTimeFormat — obsługuje DST automatycznie.
 */
function parseET(date: Date): { weekday: string; hour: number; minute: number } {
  const parts = etFormatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  return {
    weekday: get('weekday'),       // Mon, Tue, Wed, Thu, Fri, Sat, Sun
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
  };
}

/** Dni robocze NYSE (pon-pt) */
const TRADING_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

/** Sesja NYSE: 9:30-16:00 ET */
const OPEN_HOUR = 9;
const OPEN_MINUTE = 30;
const CLOSE_HOUR = 16;
const CLOSE_MINUTE = 0;

/**
 * Sprawdza czy giełda NYSE jest otwarta w podanym momencie.
 * Nie uwzględnia świąt NYSE (~9 dni/rok) — do dodania opcjonalnie.
 */
export function isNyseOpen(now: Date = new Date()): boolean {
  const { weekday, hour, minute } = parseET(now);

  if (!TRADING_DAYS.has(weekday)) return false;

  const timeMinutes = hour * 60 + minute;
  const openMinutes = OPEN_HOUR * 60 + OPEN_MINUTE;   // 9:30 = 570
  const closeMinutes = CLOSE_HOUR * 60 + CLOSE_MINUTE; // 16:00 = 960

  return timeMinutes >= openMinutes && timeMinutes < closeMinutes;
}

/**
 * Zwraca efektywny czas startu dla Price Outcome slotów.
 * Jeśli alert wysłany w trakcie sesji → czas alertu.
 * Jeśli alert wysłany poza sesją → najbliższe otwarcie NYSE (9:30 ET).
 *
 * Dzięki temu alerty Options Flow (22:15 UTC) i SEC pre-market (7:00 UTC)
 * mają sloty 1h/4h liczone od otwarcia sesji, nie od czasu alertu.
 * Efekt: price1h ≠ price4h (realne zmiany intraday zamiast identycznych wartości).
 */
export function getEffectiveStartTime(alertSentAt: Date): Date {
  if (isNyseOpen(alertSentAt)) return alertSentAt;

  // Znajdź najbliższe otwarcie NYSE po alercie
  const d = new Date(alertSentAt);

  // Sprawdzaj po dniu aż znajdziesz dzień roboczy
  for (let attempt = 0; attempt < 5; attempt++) {
    const { weekday, hour, minute } = parseET(d);

    if (TRADING_DAYS.has(weekday)) {
      const timeMinutes = hour * 60 + minute;
      const openMinutes = OPEN_HOUR * 60 + OPEN_MINUTE;

      if (timeMinutes < openMinutes) {
        // Przed otwarciem tego dnia — zwróć 9:30 ET tego dnia
        const diffMinutes = openMinutes - timeMinutes;
        return new Date(d.getTime() + diffMinutes * 60_000);
      }
    }

    // Po zamknięciu lub weekend — przejdź do następnego dnia 0:00 ET
    // Ustawiamy na następny dzień rano (5:00 UTC ~ 0:00-1:00 ET)
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(5, 0, 0, 0);
  }

  // Fallback — zwróć oryginalny czas
  return alertSentAt;
}
