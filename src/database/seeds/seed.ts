import { DataSource } from 'typeorm';
import { Ticker } from '../../entities/ticker.entity';
import { AlertRule } from '../../entities/alert-rule.entity';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Seed tickerów healthcare i reguł alertów z healthcare-universe.json.
 *
 * Uruchomienie:
 *   npm run seed
 *
 * Skrypt jest idempotentny — używa UPSERT (ON CONFLICT UPDATE),
 * więc można go uruchamiać wielokrotnie bez duplikatów.
 */

/** Mapowanie grup z JSON na priorytet w encji Ticker */
const GROUP_PRIORITY: Record<string, string> = {
  managed_care_insurers: 'CRITICAL',
  hospitals_health_systems: 'HIGH',
  pbm_pharmacy: 'HIGH',
  health_it_digital: 'MEDIUM',
  medical_devices_diagnostics: 'MEDIUM',
  pharma_biotech: 'HIGH',
};

interface CompanyJson {
  ticker: string;
  name: string;
  cik: string;
  subsector: string;
  market_cap_tier: string;
  aliases: string[];
  key_metrics: string[];
  ceo: string;
  cfo: string;
  notes: string;
}

interface AlertRuleJson {
  name: string;
  condition: string;
  priority: string;
  throttle_minutes: number;
  is_active?: boolean;
}

async function seed() {
  // Konfiguracja połączenia z .env
  require('dotenv').config();

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

  // ── Wczytanie healthcare-universe.json ───────────────────
  const jsonPath = path.resolve(
    __dirname,
    '../../../doc/stockpulse-healthcare-universe.json',
  );
  const universe = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  // ── SEED: Tickery ────────────────────────────────────────
  const tickerRepo = dataSource.getRepository(Ticker);
  let tickerCount = 0;

  const tickerGroups = universe.tickers as Record<
    string,
    { companies: CompanyJson[] }
  >;

  for (const [groupKey, group] of Object.entries(tickerGroups)) {
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
          ],
          ['symbol'],
        )
        .execute();

      tickerCount++;
    }
  }

  console.log(`✓ Zaimportowano ${tickerCount} tickerów healthcare`);

  // ── SEED: Reguły alertów ─────────────────────────────────
  const ruleRepo = dataSource.getRepository(AlertRule);
  const rules = universe.alert_rules.rules as AlertRuleJson[];
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
  const totalRules = await ruleRepo.count();
  console.log(`\n─── Seed zakończony ───`);
  console.log(`  Tickery w bazie:  ${totalTickers}`);
  console.log(`  Reguły alertów:   ${totalRules}`);

  await dataSource.destroy();
  console.log('✓ Rozłączono z PostgreSQL');
}

seed().catch((err) => {
  console.error('Seed nie powiódł się:', err);
  process.exit(1);
});
