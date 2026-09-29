import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentFinding, Alert, InsiderTrade, SecFiling } from '../entities';
import { AgentOrchestratorService } from './agent-orchestrator.service';
import { AuditorAgent } from './auditor/auditor.agent';

/**
 * Moduł agentów (tasks-2026-09-27/05): orkiestrator + audytor w shadow-mode.
 * Read-only na alerts/sec_filings/insider_trades, zapis wyłącznie do agent_findings.
 * ScheduleModule.forRoot() jest globalny (system-log.module.ts) — @Cron działa bez importu tutaj.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Alert, SecFiling, InsiderTrade, AgentFinding])],
  providers: [AuditorAgent, AgentOrchestratorService],
  exports: [AgentOrchestratorService],
})
export class AgentsModule implements OnModuleInit {
  private readonly logger = new Logger(AgentsModule.name);

  constructor(private readonly orchestrator: AgentOrchestratorService) {}

  /** Log startowy = dowód załadowania modułu i stanu flagi (weryfikacja po rebuildzie). */
  onModuleInit(): void {
    this.logger.log(`AgentsModule: ${this.orchestrator.describe()}`);
  }
}
