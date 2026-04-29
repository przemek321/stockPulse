/**
 * Parser i router dla filingów 8-K SEC.
 *
 * Wykrywa numery Item z tekstu 8-K i wyciąga treść per-sekcja.
 * 8-K może zawierać wiele Itemów (np. Item 2.02 + Item 9.01).
 */

import { buildForm8k101Prompt } from '../prompts/form8k-1-01.prompt';
import { buildForm8k202Prompt } from '../prompts/form8k-2-02.prompt';
import { buildForm8k502Prompt } from '../prompts/form8k-5-02.prompt';
import { buildForm8kOtherPrompt } from '../prompts/form8k-other.prompt';

/** Maksymalna długość tekstu wysyłanego do GPT */
const MAX_TEXT_LENGTH = 8000;

/**
 * Wykrywa numery Item w tekście 8-K.
 * 8-K może mieć wiele sekcji Item (np. "Item 1.01", "Item 9.01").
 * Zwraca unikalne numery w kolejności pojawienia się.
 */
export function detectItems(filingText: string): string[] {
  const regex = /Item\s+(\d+\.\d+)/gi;
  const items: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(filingText)) !== null) {
    const item = match[1];
    if (!seen.has(item)) {
      seen.add(item);
      items.push(item);
    }
  }

  return items;
}

/**
 * Wyciąga tekst sekcji dla danego Item z filingu 8-K.
 * Szuka treści między "Item X.XX" a następnym "Item" lub "SIGNATURES".
 * Zwraca oczyszczony tekst (bez tagów HTML) o maksymalnej długości MAX_TEXT_LENGTH.
 */
export function extractItemText(filingText: string, itemNumber: string): string {
  // Escapuj kropkę w numerze Item
  const escapedItem = itemNumber.replace('.', '\\.');
  const startRegex = new RegExp(`Item\\s+${escapedItem}[^\\d]`, 'i');
  const startMatch = startRegex.exec(filingText);

  if (!startMatch) {
    // Fallback: weź cały tekst (po stripnięciu HTML)
    return stripHtml(filingText).slice(0, MAX_TEXT_LENGTH);
  }

  const startIdx = startMatch.index;

  // Szukaj końca sekcji: następny "Item X.XX" lub "SIGNATURES"
  const restText = filingText.slice(startIdx + startMatch[0].length);
  const endRegex = /Item\s+\d+\.\d+|SIGNATURES/i;
  const endMatch = endRegex.exec(restText);

  const sectionText = endMatch
    ? filingText.slice(startIdx, startIdx + startMatch[0].length + endMatch.index)
    : filingText.slice(startIdx);

  return stripHtml(sectionText).slice(0, MAX_TEXT_LENGTH);
}

/**
 * Wybiera odpowiedni prompt builder na podstawie numeru Item.
 * Zwraca null dla Item 1.03 (Bankruptcy) — obsługiwany bez GPT.
 */
export function selectPromptBuilder(
  item: string,
): ((
  ticker: string,
  companyName: string,
  text: string,
  itemNumber?: string,
  tickerProfile?: string | null,
  extractedFacts?: string | null,
) => string) | null {
  const map: Record<string, typeof buildForm8k101Prompt | typeof buildForm8kOtherPrompt | null> = {
    '1.01': buildForm8k101Prompt,
    '1.03': null,                    // Bankruptcy — CRITICAL bez GPT
    '2.02': buildForm8k202Prompt,
    '5.02': buildForm8k502Prompt,
    '7.01': buildForm8kOtherPrompt,
    '8.01': buildForm8kOtherPrompt,
  };

  if (item in map) return map[item];
  return buildForm8kOtherPrompt;
}

/**
 * Sprawdza czy Item oznacza bankruptcy (1.03) — wymaga natychmiastowego alertu bez GPT.
 */
export function isBankruptcyItem(item: string): boolean {
  return item === '1.03';
}

/**
 * Usuwa tagi HTML/SGML z tekstu filingu SEC.
 * EDGAR zwraca pliki w formacie SGML/HTML — czyścimy do plain text.
 */
export function stripHtml(html: string): string {
  return html
    // Usuń ukryte divy z inline XBRL (metadane, taksonomia — nie treść dokumentu)
    .replace(/<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/gi, '')
    // Usuń nagłówek inline XBRL (schematy, konteksty, linki)
    .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, '')
    // Zamień <br>, <p>, <div> na newline
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    // Usuń tagi HTML
    .replace(/<[^>]+>/g, ' ')
    // Dekoduj podstawowe encje HTML
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#\d+;/g, ' ')
    // Normalizuj whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
