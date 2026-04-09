import { DataSource } from 'typeorm';
import { Ticker } from '../../entities/ticker.entity';
import { AlertRule } from '../../entities/alert-rule.entity';
import * as path from 'path';
import * as fs from 'fs';

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

  // ── Wczytanie plików JSON ─────────────────────────────────
  const docDir = path.resolve(__dirname, '../../../doc');

  const healthcarePath = path.resolve(docDir, 'stockpulse-healthcare-universe.json');
  const healthcare = JSON.parse(fs.readFileSync(healthcarePath, 'utf-8'));

  const semiPath = path.resolve(docDir, 'stockpulse-semi-supply-chain.json');
  const semi = JSON.parse(fs.readFileSync(semiPath, 'utf-8'));

  // ── SEED: Tickery ────────────────────────────────────────
  const tickerRepo = dataSource.getRepository(Ticker);
  let tickerCount = 0;

  /** Wspólna logika seedowania tickerów z dowolnego pliku JSON */
  async function seedTickers(
    groups: Record<string, { companies: CompanyJson[] }>,
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
  const healthcareCount = await seedTickers(healthcare.tickers, 'healthcare', false);
  console.log(`✓ Zaimportowano ${healthcareCount} tickerów healthcare`);

  // Semi supply chain: sector='semi_supply_chain', observationOnly=true
  const semiCount = await seedTickers(semi.tickers, 'semi_supply_chain', true);
  console.log(`✓ Zaimportowano ${semiCount} tickerów semi supply chain (observation mode)`);

  tickerCount = healthcareCount + semiCount;

  // ── SEED: Reguły alertów (tylko z healthcare — semi używa tych samych reguł) ──
  const ruleRepo = dataSource.getRepository(AlertRule);
  const rules = healthcare.alert_rules.rules as AlertRuleJson[];
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

seed().catch((err) => {
  console.error('Seed nie powiódł się:', err);
  process.exit(1);
});
