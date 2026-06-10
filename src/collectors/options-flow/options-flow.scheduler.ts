import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../queues/queue-names.const';

/**
 * Scheduler dla kolektora options flow (Polygon.io EOD).
 *
 * WYŁĄCZONY 10.06.2026 (Pakiet 1, plan §P4 — doc/PLAN-EDGE-IMPROVEMENTS-2026-06-09.md).
 * Dowody z forward-oceny 09.06:
 *  - cykl palił DOKŁADNIE 6h dziennie (codzienny abort na budżecie S19-FIX-04),
 *  - 22/48 aktywnych tickerów miało 0 wierszy options_flow w 30d (UNH od 07.05,
 *    LLY od 19.03, AMGN/BIIB/REGN/VRTX brak),
 *  - noga korelacyjna redundantna: wszystkie 3 post-fixowe correlated winnery (HIMS)
 *    opierały się o nogę Form4 BUY, która i tak dała standalone alert tego samego dnia,
 *  - scoring miał bias 73% positive; Unusual Options Activity: 0 alertów ever.
 *
 * Warunek z planu SPEŁNIONY przed wyłączeniem (zweryfikowano 10.06 na żywym kluczu):
 * Polygon free tier zwraca dzienne agregaty WSTECZ także dla wygasłych kontraktów
 * (test: O:CVS260320C00075000, 34 bary luty-marzec) → spike detection jest w pełni
 * rekonstruowalny retroaktywnie, przerwa w zbieraniu nie blokuje przyszłego
 * backtestu opcji.
 *
 * ODWRACALNE: kod, dane (options_flow + baseline), API i frontend zostają.
 * Re-enable = przywrócenie bloku queue.add z git history (commit z tym wyłączeniem).
 * Wzorzec cleanup-only ze Sprint 11 (StockTwits/Finnhub) — zero pustych jobów BullMQ.
 */
@Injectable()
export class OptionsFlowScheduler implements OnModuleInit {
  private readonly logger = new Logger(OptionsFlowScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.OPTIONS_FLOW)
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Usuń stare repeatable joby (po wyłączeniu: cleanup-only, nic nie planujemy)
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    // Health-check 10.06.2026 wieczór: removeRepeatableByKey usuwa KONFIG repeatu,
    // ale NIE już-zmaterializowane delayed instancje jobów — jedna z nich odpaliła
    // pełny cykl po reboocie (05:04 UTC, 30 kontraktów), kolejne czekały w Redis.
    // drain(true) czyści też delayed — kolejka faktycznie martwa.
    await this.queue.drain(true);

    this.logger.warn(
      'Options Flow collector WYŁĄCZONY (10.06.2026, plan P4 — 6h zombie cycle/dzień, ' +
        '22/48 tickerów bez danych, noga korelacyjna redundantna; retencja Polygon zweryfikowana)',
    );
  }
}
