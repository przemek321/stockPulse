import * as cheerio from 'cheerio';

/**
 * Wynik parsowania jednego wiersza tabeli PDUFA z pdufa.bio.
 */
export interface ParsedPdufaEvent {
  date: string; // YYYY-MM-DD
  ticker: string; // Symbol giełdowy
  drugName: string; // Nazwa leku
  indication: string; // Wskazanie terapeutyczne
  therapeuticArea: string; // Obszar terapeutyczny (TA)
}

/**
 * Parsuje HTML strony pdufa.bio i wyciąga eventy PDUFA z tabel.
 *
 * Struktura HTML (zweryfikowana — server-rendered Next.js):
 * <table>
 *   <thead><tr><th>Date</th><th>Ticker</th><th>Drug</th><th>Indication</th><th>TA</th></tr></thead>
 *   <tbody>
 *     <tr>
 *       <td>2026-02-25</td>
 *       <td style="color:#60a5fa">OTSKF</td>
 *       <td>INQOVI + Venetoclax</td>
 *       <td>Acute Myeloid Leukemia</td>
 *       <td>Oncology</td>
 *     </tr>
 *   </tbody>
 * </table>
 */
export function parsePdufaCalendarHtml(html: string): ParsedPdufaEvent[] {
  const $ = cheerio.load(html);
  const events: ParsedPdufaEvent[] = [];

  $('table tbody tr').each((_i, row) => {
    const cells = $(row).find('td');
    if (cells.length < 5) return;

    const dateText = $(cells[0]).text().trim();
    const ticker = $(cells[1]).text().trim();
    const drugName = $(cells[2]).text().trim();
    const indication = $(cells[3]).text().trim();
    const therapeuticArea = $(cells[4]).text().trim();

    // Walidacja: data musi pasować do formatu YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return;
    // Ticker nie może być pusty
    if (!ticker) return;

    events.push({
      date: dateText,
      ticker: ticker.toUpperCase(),
      drugName,
      indication,
      therapeuticArea,
    });
  });

  return events;
}
