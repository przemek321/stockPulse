import { SummarySchedulerService } from '../../src/alerts/summary-scheduler.service';

/**
 * Testy jednostkowe dla SummarySchedulerService (TASK-07, 23.04.2026).
 *
 * Weryfikuje:
 *   - sendSummary() dodaje breakdown nonDeliveryReason gdy suppressed > 0
 *   - Polskie etykiety REASON_LABELS mapują wszystkie dispatcher suppression values
 *   - Brak breakdown gdy wszystkie alerty dostarczone (totalDelivered === totalAlerts)
 *   - totalAlerts=0 → "Brak alertów" bez breakdown
 */

function makeQb(result: any[]) {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(result),
  };
}

function buildScheduler(opts: {
  alertsByRule: any[];
  reasons: any[];
  trades: any[];
  telegramSendResult?: boolean;
}) {
  const alertRepo = {
    createQueryBuilder: jest
      .fn()
      .mockImplementationOnce(() => makeQb(opts.alertsByRule))
      .mockImplementationOnce(() => makeQb(opts.reasons)),
  };
  const tradeRepo = {
    createQueryBuilder: jest.fn().mockImplementation(() => makeQb(opts.trades)),
  };
  const telegram = {
    isConfigured: jest.fn().mockReturnValue(true),
    sendMarkdown: jest.fn().mockResolvedValue(opts.telegramSendResult ?? true),
  };
  const formatter = {
    formatPdufaSummarySection: jest.fn().mockReturnValue(''),
  };
  const pdufaBio = {
    getAllUpcoming: jest.fn().mockResolvedValue([]),
  };
  const scheduler = new SummarySchedulerService(
    alertRepo as any,
    tradeRepo as any,
    telegram as any,
    formatter as any,
    pdufaBio as any,
  );
  return { scheduler, telegram };
}

describe('SummarySchedulerService.sendSummary — breakdown nonDeliveryReason', () => {
  it('scenario C: 5 alertów, 1 delivered, reasons observation×3+sell_no_edge×1 → breakdown w wiadomości', async () => {
    const { scheduler, telegram } = buildScheduler({
      alertsByRule: [
        { rule: 'Correlated Signal', count: '3', delivered: '1' },
        { rule: 'Form 4 Insider Signal', count: '2', delivered: '0' },
      ],
      reasons: [
        { reason: 'observation', count: '3' },
        { reason: 'sell_no_edge', count: '1' },
      ],
      trades: [],
    });

    await scheduler.sendSummary();

    expect(telegram.sendMarkdown).toHaveBeenCalledTimes(1);
    const msg = (telegram.sendMarkdown as jest.Mock).mock.calls[0][0] as string;

    expect(msg).toContain('Łącznie: 5');
    expect(msg).toContain('dostarczono: 1');
    // Breakdown sekcja
    expect(msg).toContain('Niedostarczone');
    // 5 - 1 = 4 suppressed (escaped dla MarkdownV2: \(4\))
    expect(msg).toMatch(/Niedostarczone.*4/);
    // Polskie etykiety z escapingiem (parens/dots escaped)
    expect(msg).toContain('Obserwacja');
    expect(msg).toMatch(/Obserwacja.*3/);
    expect(msg).toContain('SELL');
    expect(msg).toContain('zero edge');
  });

  it('wszystkie delivered (suppressed=0) → brak sekcji Niedostarczone', async () => {
    const { scheduler, telegram } = buildScheduler({
      alertsByRule: [
        { rule: 'Correlated Signal', count: '2', delivered: '2' },
      ],
      reasons: [],
      trades: [],
    });

    await scheduler.sendSummary();

    const msg = (telegram.sendMarkdown as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain('Łącznie: 2');
    expect(msg).toContain('dostarczono: 2');
    expect(msg).not.toContain('Niedostarczone');
  });

  it('totalAlerts=0 → "Brak alertów", bez breakdown nawet jeśli reasons niepuste', async () => {
    const { scheduler, telegram } = buildScheduler({
      alertsByRule: [],
      reasons: [{ reason: 'observation', count: '0' }],
      trades: [],
    });

    await scheduler.sendSummary();

    const msg = (telegram.sendMarkdown as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain('Brak alertów w tym okresie');
    expect(msg).not.toContain('Niedostarczone');
    expect(msg).not.toContain('Łącznie:');
  });

  it('nieznany reason key → fallback na surową wartość (nie crashuje)', async () => {
    const { scheduler, telegram } = buildScheduler({
      alertsByRule: [{ rule: 'Test', count: '1', delivered: '0' }],
      reasons: [{ reason: 'future_unknown_reason', count: '1' }],
      trades: [],
    });

    await scheduler.sendSummary();

    const msg = (telegram.sendMarkdown as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain('future');
    expect(msg).toContain('Niedostarczone');
  });

  it('wszystkie znane suppressed reasons mapują się na PL etykiety', async () => {
    const { scheduler, telegram } = buildScheduler({
      alertsByRule: [{ rule: 'R', count: '14', delivered: '0' }],
      reasons: [
        { reason: 'observation', count: '1' },
        { reason: 'sell_no_edge', count: '1' },
        { reason: 'csuite_sell_no_edge', count: '1' },
        { reason: 'cluster_sell_no_edge', count: '1' },
        { reason: 'silent_rule', count: '1' },
        { reason: 'daily_limit', count: '1' },
        { reason: 'telegram_failed', count: '1' },
        { reason: 'dispatcher_unavailable', count: '1' },
        { reason: 'gpt_missing_data', count: '1' },
        { reason: 'direction_conflict', count: '1' },
        // S19-FIX-12: consensus gap reasons
        { reason: 'consensus_miss', count: '1' },
        { reason: 'consensus_in_line', count: '1' },
        { reason: 'consensus_mixed', count: '1' },
        { reason: 'consensus_gap', count: '1' },
      ],
      trades: [],
    });

    await scheduler.sendSummary();

    const msg = (telegram.sendMarkdown as jest.Mock).mock.calls[0][0] as string;
    // Myślniki/parens escape'owane w MarkdownV2 (\-, \(, \)) — match bez escapów
    const plain = msg.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1');
    expect(plain).toContain('Obserwacja');
    expect(plain).toContain('SELL (zero edge)');
    expect(plain).toContain('C-suite SELL (zero edge)');
    expect(plain).toContain('Cluster SELL (zero edge)');
    expect(plain).toContain('Silent rule');
    expect(plain).toContain('Dzienny limit');
    expect(plain).toContain('Telegram failed');
    expect(plain).toContain('Dispatcher niedostępny');
    expect(plain).toContain('GPT brak danych');
    expect(plain).toContain('Konflikt kierunków');
    // S19-FIX-12 PL labels
    expect(plain).toContain('Miss vs konsensus');
    expect(plain).toContain('in-line z konsensusem');
    expect(plain).toContain('Mieszany sygnał');
    expect(plain).toContain('Niezgodność z konsensusem');
  });
});
