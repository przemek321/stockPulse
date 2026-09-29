import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigModule } from '../../config/config.module';
import { AgentOrchestratorService } from '../agent-orchestrator.service';
import { AgentsModule } from '../agents.module';

/**
 * Shadow-run audytora (tasks-2026-09-27/06) — jednorazowy przebieg orkiestratora na N ostatnich alertach
 * (domyślnie 30, niezależnie od priceOutcomeDone), bez CRON-a, `AUDITOR_ENABLED` bez znaczenia.
 *
 * Uruchomienie w kontenerze (obok działającej aplikacji):
 *   docker exec stockpulse-app node dist/agents/cli/auditor-shadow-run.js [--limit 30] [--ids 2441,2479]
 *
 * Bezpieczeństwo: MINIMALNY kontekst Nest — Config + TypeORM (synchronize:false, bez schema sync)
 * + AgentsModule. Bez QueuesModule (żaden worker BullMQ nie podbierze jobów), bez kolektorów, bez
 * Telegrama, bez ScheduleModule (CRON-y nie startują). Jedyny zapis: agent_findings.
 */

interface CliArgs {
  readonly limit: number;
  readonly alertIds: readonly number[] | undefined;
}

const DEFAULT_LIMIT = 30;

function parseArgs(argv: readonly string[]): CliArgs {
  let limit = DEFAULT_LIMIT;
  let alertIds: number[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1] ?? '';
    if (arg === '--limit') {
      const n = Number(next);
      if (Number.isInteger(n) && n > 0) limit = n;
      i++;
    } else if (arg === '--ids') {
      alertIds = next
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      i++;
    }
  }
  return { limit, alertIds };
}

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('POSTGRES_HOST'),
        port: config.get<number>('POSTGRES_PORT'),
        database: config.get<string>('POSTGRES_DB'),
        username: config.get<string>('POSTGRES_USER'),
        password: config.get<string>('POSTGRES_PASSWORD'),
        entities: [`${__dirname}/../../entities/*.entity{.ts,.js}`],
        // CLI nigdy nie dotyka schematu — sync robi wyłącznie główna aplikacja (database.module.ts).
        synchronize: false,
        logging: false,
      }),
    }),
    AgentsModule,
  ],
})
class ShadowRunModule implements OnModuleInit {
  private readonly logger = new Logger(ShadowRunModule.name);

  onModuleInit(): void {
    this.logger.log('ShadowRunModule: minimalny kontekst — bez kolejek, kolektorów, Telegrama i CRON-ów');
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(ShadowRunModule, { logger: ['log', 'warn', 'error'] });
  const logger = new Logger('ShadowRun');
  try {
    const orchestrator = app.get(AgentOrchestratorService);
    logger.log(
      `start: limit=${args.limit}, ids=${args.alertIds === undefined ? '(ostatnie wg id DESC)' : args.alertIds.join(',')}, ` +
        `requireOutcomeDone=false, sinceDays=null`,
    );
    const summary = await orchestrator.runOnce({
      limit: args.limit,
      requireOutcomeDone: false,
      sinceDays: null,
      order: 'DESC',
      alertIds: args.alertIds,
    });
    logger.log(`podsumowanie: ${JSON.stringify(summary)}`);

    const ds = app.get(DataSource);
    const byCheck: unknown = await ds.query(
      'SELECT "checkId", severity, count(*)::int AS n FROM agent_findings WHERE agent = $1 GROUP BY 1, 2 ORDER BY 3 DESC, 1',
      ['AUDITOR'],
    );
    console.log('\n== agent_findings: checkId × severity × count (cała tabela, agent=AUDITOR) ==');
    console.table(byCheck);
    const perAlert: unknown = await ds.query(
      'SELECT f."alertId", f.ticker, f."checkId", f.severity, f.status, left(f.summary, 110) AS summary ' +
        'FROM agent_findings f WHERE f.agent = $1 AND f."checkId" <> $2 AND f."alertId" IS NOT NULL ' +
        'ORDER BY f."alertId" DESC, f.severity, f."checkId"',
      ['AUDITOR', '_AUDITED'],
    );
    console.log('\n== findingi per alert (bez markerów _AUDITED) ==');
    console.table(perAlert);
    const globals: unknown = await ds.query(
      'SELECT f.id, f."checkId", f.severity, f.status, f.evidence FROM agent_findings f WHERE f.agent = $1 AND f."alertId" IS NULL ORDER BY f.id',
      ['AUDITOR'],
    );
    console.log('\n== findingi globalne (alertId IS NULL) ==');
    console.log(JSON.stringify(globals, null, 1));
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  Logger.error(`ShadowRun nieudany: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`, 'ShadowRun');
  process.exit(1);
});
