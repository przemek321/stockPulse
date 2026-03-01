/**
 * Test parsera Form 4 XML z prawdziwym filingiem z SEC EDGAR.
 * Użycie: docker exec stockpulse-app node scripts/test-form4-parser.js
 */
const { parseForm4Xml } = require('../dist/collectors/sec-edgar/form4-parser');

const TEST_URL = 'https://www.sec.gov/Archives/edgar/data/1035267/000133026926000006/edgardoc.xml';

async function main() {
  console.log('Pobieranie Form 4 XML:', TEST_URL);
  const res = await fetch(TEST_URL, {
    headers: { 'User-Agent': 'StockPulse test@example.com' },
  });

  if (!res.ok) {
    console.error('HTTP error:', res.status, res.statusText);
    process.exit(1);
  }

  const xml = await res.text();
  console.log('XML length:', xml.length, 'bytes');
  console.log('---');

  const transactions = parseForm4Xml(xml);
  console.log('Znalezione transakcje:', transactions.length);
  console.log('---');

  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    console.log(`[${i}] ${t.insiderName} (${t.insiderRole || 'brak roli'})`);
    console.log(`    Typ: ${t.transactionType}`);
    console.log(`    Akcje: ${t.shares}`);
    console.log(`    Cena: $${t.pricePerShare ?? 'N/A'}`);
    console.log(`    Wartość: $${t.totalValue.toLocaleString('en-US')}`);
    console.log(`    Data: ${t.transactionDate.toISOString().split('T')[0]}`);
    console.log('');
  }

  if (transactions.length === 0) {
    console.log('UWAGA: Brak transakcji — sprawdź parser!');
  }
}

main().catch((e) => {
  console.error('BŁĄD:', e.message);
  process.exit(1);
});
