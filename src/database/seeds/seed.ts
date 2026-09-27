import { config as loadDotenv } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { AlertRule } from '../../entities/alert-rule.entity';
import { Ticker } from '../../entities/ticker.entity';
import { readUniverseAlertRules, readUniverseTickers, UniverseGroupJson } from './seed-universe.types';

/**
 * Seed tickerów i reguł alertów z plików JSON.
 * Obsługuje wiele sektorów: healthcare + semi supply chain.
 *
 * Uruchomienie:
 *   npm run seed
 *
 * Skrypt jest idempotentny — używa UPSERT (ON CONFLICT UPDATE),
 * więc można go uruchamiać wielokrotnie bez duplikatów.
 */

/** Mapowanie grup z JSON na priorytet w encji Ticker */
const GROUP_PRIORITY: Record<string, string> = {
  // Healthcare
  managed_care_insurers: 'CRITICAL',
  hospitals_health_systems: 'HIGH',
  pbm_pharmacy: 'HIGH',
  health_it_digital: 'MEDIUM',
  medical_devices_diagnostics: 'MEDIUM',
  pharma_biotech: 'HIGH',
  // Semi supply chain
  memory_producers: 'MEDIUM',
  equipment_packaging: 'MEDIUM',
  oem_anti_signal: 'LOW',
  // APLS-class biotech (Faza 3 seed observation, 09.06.2026)
  apls_strict: 'MEDIUM',
  apls_stretch: 'LOW',
};

async function seed() {
  // Konfiguracja połączenia z .env
  loadDotenv();

  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'stockpulse',
    username: process.env.POSTGRES_USER || 'stockpulse',
    password: process.env.POSTGRES_PASSWORD || 'stockpulse_dev_2026',
    entities: [Ticker, AlertRule],
    synchronize: true,
  });

  await dataSource.initialize();
  console.log('✓ Połączono z PostgreSQL');

  // ── Wczytanie plików JSON ─────────────────────────────────
  // Parsowanie tu (błąd składni JSON = wyjątek przed seedem), kształt (`seed-universe.types.ts`)
  // sprawdzany dopiero w punkcie użycia — zachowuje dawną kolejność: wadliwy plik semi
  // nie blokuje seedu healthcare, który leci pierwszy.
  const docDir = path.resolve(__dirname, '../../../doc');

  const healthcarePath = path.resolve(docDir, 'stockpulse-healthcare-universe.json');
  const healthcare: unknown = JSON.parse(fs.readFileSync(healthcarePath, 'utf-8'));

  const semiPath = path.resolve(docDir, 'stockpulse-semi-supply-chain.json');
  const semi: unknown = JSON.parse(fs.readFileSync(semiPath, 'utf-8'));

  const aplsPath = path.resolve(docDir, 'stockpulse-biotech-apls.json');
  const apls: unknown = JSON.parse(fs.readFileSync(aplsPath, 'utf-8'));

  // ── SEED: Tickery ────────────────────────────────────────
  const tickerRepo = dataSource.getRepository(Ticker);
  let tickerCount = 0;

  /** Wspólna logika seedowania tickerów z dowolnego pliku JSON */
  async function seedTickers(
    groups: Record<string, UniverseGroupJson>,
    sector: string,
    observationOnly: boolean,
  ): Promise<number> {
    let count = 0;
    for (const [groupKey, group] of Object.entries(groups)) {
      const priority = GROUP_PRIORITY[groupKey] || 'MEDIUM';

      for (const company of group.companies) {
        await tickerRepo
          .createQueryBuilder()
          .insert()
          .into(Ticker)
          .values({
            symbol: company.ticker,
            name: company.name,
            cik: company.cik,
            subsector: company.subsector,
            priority,
            aliases: company.aliases,
            keyMetrics: company.key_metrics,
            ceo: company.ceo,
            cfo: company.cfo,
            notes: company.notes,
            isActive: true,
            sector,
            observationOnly,
          })
          .orUpdate(
            [
              'name',
              'cik',
              'subsector',
              'priority',
              'aliases',
              'keyMetrics',
              'ceo',
              'cfo',
              'notes',
              'sector',
              'observationOnly',
            ],
            ['symbol'],
          )
          .execute();

        count++;
      }
    }
    return count;
  }

  // Healthcare: sector='healthcare', observationOnly=false
  const healthcareCount = await seedTickers(
    readUniverseTickers(healthcare, 'stockpulse-healthcare-universe.json'),
    'healthcare',
    false,
  );
  console.log(`✓ Zaimportowano ${healthcareCount} tickerów healthcare`);

  // Semi supply chain: sector='semi_supply_chain', observationOnly=true
  const semiCount = await seedTickers(
    readUniverseTickers(semi, 'stockpulse-semi-supply-chain.json'),
    'semi_supply_chain',
    true,
  );
  console.log(`✓ Zaimportowano ${semiCount} tickerów semi supply chain (observation mode)`);

  // APLS-class biotech: sector='biotech_apls', observationOnly=true (Faza 3, 09.06.2026).
  // W odróżnieniu od semi: Form4Pipeline NIE skipuje ich przed GPT (prompt healthcare
  // semantycznie poprawny dla biotechu) — alerty BUY >= $500K lądują w DB jako observation.
  const aplsCount = await seedTickers(
    readUniverseTickers(apls, 'stockpulse-biotech-apls.json'),
    'biotech_apls',
    true,
  );
  console.log(`✓ Zaimportowano ${aplsCount} tickerów APLS biotech (observation mode, BUY >= $500K)`);

  tickerCount = healthcareCount + semiCount + aplsCount;

  // ── SEED: Reguły alertów (tylko z healthcare — semi używa tych samych reguł) ──
  const ruleRepo = dataSource.getRepository(AlertRule);
  const rules = readUniverseAlertRules(healthcare, 'stockpulse-healthcare-universe.json');
  let ruleCount = 0;

  for (const rule of rules) {
    await ruleRepo
      .createQueryBuilder()
      .insert()
      .into(AlertRule)
      .values({
        name: rule.name,
        condition: rule.condition,
        priority: rule.priority,
        throttleMinutes: rule.throttle_minutes,
        isActive: rule.is_active !== false,
      })
      .orUpdate(
        ['condition', 'priority', 'throttleMinutes', 'isActive'],
        ['name'],
      )
      .execute();

    ruleCount++;
  }

  console.log(`✓ Zaimportowano ${ruleCount} reguł alertów`);

  // ── Podsumowanie ─────────────────────────────────────────
  const totalTickers = await tickerRepo.count();
  const observationTickers = await tickerRepo.count({ where: { observationOnly: true } });
  const totalRules = await ruleRepo.count();
  console.log(`\n─── Seed zakończony ───`);
  console.log(`  Tickery w bazie:  ${totalTickers} (w tym ${observationTickers} observation mode)`);
  console.log(`  Reguły alertów:   ${totalRules}`);

  await dataSource.destroy();
  console.log('✓ Rozłączono z PostgreSQL');
}

seed().catch((err: unknown) => {
  console.error('Seed nie powiódł się:', err);
  process.exit(1);
});
