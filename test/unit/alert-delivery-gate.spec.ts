import { AlertDeliveryGate } from '../../src/alerts/alert-delivery-gate.service';

/**
 * Testy jednostkowe dla AlertDeliveryGate (TASK-07, 23.04.2026).
 *
 * Weryfikuje:
 *   - canDeliverToTelegram() zwraca allowed=true gdy count < MAX (5)
 *   - canDeliverToTelegram() zwraca allowed=false gdy count >= MAX
 *   - Query filtruje po (symbol, delivered=true, sentAt >= todayStart UTC)
 *   - Bypass-logic żyje w AlertDispatcherService (nie w gate'cie) —
 *     test dispatcher-level bypass już pokryty w alert-dispatcher.spec.ts
 */

describe('AlertDeliveryGate.canDeliverToTelegram', () => {
  function buildGate(countResolved: number) {
    const alertRepo = {
      count: jest.fn().mockResolvedValue(countResolved),
    };
    const gate = new AlertDeliveryGate(alertRepo as any);
    return { gate, alertRepo };
  }

  it('count < 5 → allowed=true', async () => {
    const { gate, alertRepo } = buildGate(4);
    const result = await gate.canDeliverToTelegram('AAPL');

    expect(result.allowed).toBe(true);
    expect(result.count).toBe(4);
    expect(result.limit).toBe(5);
    expect(alertRepo.count).toHaveBeenCalledTimes(1);
  });

  it('count === 5 (limit) → allowed=false', async () => {
    const { gate } = buildGate(5);
    const result = await gate.canDeliverToTelegram('AAPL');

    expect(result.allowed).toBe(false);
    expect(result.count).toBe(5);
    expect(result.limit).toBe(5);
  });

  it('count > 5 (over limit, legacy bypassDailyLimit entries) → allowed=false', async () => {
    const { gate } = buildGate(7);
    const result = await gate.canDeliverToTelegram('AAPL');

    expect(result.allowed).toBe(false);
    expect(result.count).toBe(7);
  });

  it('count === 0 (fresh ticker) → allowed=true', async () => {
    const { gate } = buildGate(0);
    const result = await gate.canDeliverToTelegram('AAPL');

    expect(result.allowed).toBe(true);
    expect(result.count).toBe(0);
  });

  it('query filtruje po symbol, delivered=true, sentAt >= todayStart UTC', async () => {
    const { gate, alertRepo } = buildGate(2);
    await gate.canDeliverToTelegram('MSFT');

    const callArg = (alertRepo.count as jest.Mock).mock.calls[0][0];
    expect(callArg.where.symbol).toBe('MSFT');
    expect(callArg.where.delivered).toBe(true);
    // sentAt używa TypeORM MoreThanOrEqual — _value to todayStart Date w UTC
    expect(callArg.where.sentAt).toBeDefined();
    // setUTCHours(0,0,0,0) → ISO format kończy się '00:00:00.000Z'
    const sentAtValue = callArg.where.sentAt._value as Date;
    expect(sentAtValue.getUTCHours()).toBe(0);
    expect(sentAtValue.getUTCMinutes()).toBe(0);
    expect(sentAtValue.getUTCSeconds()).toBe(0);
    expect(sentAtValue.getUTCMilliseconds()).toBe(0);
  });

  it('MAX_TELEGRAM_ALERTS_PER_SYMBOL_PER_DAY jest exposed jako static = 5', () => {
    expect(AlertDeliveryGate.MAX_TELEGRAM_ALERTS_PER_SYMBOL_PER_DAY).toBe(5);
  });
});
