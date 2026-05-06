/**
 * S19-FIX-12 (06.05.2026): wspólne mapowanie `nonDeliveryReason` → PL label
 * dla PriorityChip (App.tsx) i SignalTimeline. Wcześniej mapowanie było
 * zduplikowane w 2 miejscach z drift'em (SignalTimeline nie miał gpt_missing_data
 * i direction_conflict). Centralizujemy żeby nowe consensus_* reasons trafiły
 * do obu miejsc bez modify-twice.
 *
 * Wartości synchroniczne z `summary-scheduler.service.ts:REASON_LABELS` (backend
 * Telegram raporty 8h) — frontend i Telegram używają tej samej terminologii PL.
 */
export function nonDeliveryLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  switch (reason) {
    case 'observation':
      return 'obserwacja';
    case 'csuite_sell_no_edge':
      return 'C-suite SELL (zero edge)';
    case 'cluster_sell_no_edge':
      return 'cluster SELL (zero edge)';
    case 'sell_no_edge':
      return 'SELL (zero edge)';
    case 'silent_hour':
      return 'cicha godzina';
    case 'silent_rule':
      return 'silent rule';
    case 'daily_limit':
      return 'daily limit';
    case 'telegram_failed':
      return 'Telegram błąd';
    case 'dispatcher_unavailable':
      return 'dispatcher offline';
    case 'gpt_missing_data':
      return 'GPT brak danych';
    case 'direction_conflict':
      return 'konflikt kierunków';
    // S19-FIX-12: consensus gap reasons (PODD-class)
    case 'consensus_miss':
      return 'miss vs konsensus';
    case 'consensus_in_line':
      return 'in-line z konsensusem';
    case 'consensus_mixed':
      return 'mieszany sygnał (single-metric beat)';
    case 'consensus_gap':
      return 'niezgodność z konsensusem';
    default:
      return reason;
  }
}

/**
 * Skrócona wersja dla SignalTimeline (mniej miejsca w komórce).
 * Używana w widgecie z bardzo wąskim PRIORITY field.
 */
export function nonDeliveryLabelShort(reason: string | null | undefined): string | null {
  if (!reason) return null;
  switch (reason) {
    case 'observation':
      return 'obserwacja';
    case 'csuite_sell_no_edge':
      return 'C-suite SELL';
    case 'cluster_sell_no_edge':
      return 'cluster SELL';
    case 'sell_no_edge':
      return 'SELL zero edge';
    case 'gpt_missing_data':
      return 'brak danych';
    case 'direction_conflict':
      return 'konflikt kier.';
    case 'consensus_miss':
      return 'miss vs konsensus';
    case 'consensus_in_line':
      return 'in-line';
    case 'consensus_mixed':
      return 'mixed beat';
    case 'consensus_gap':
      return 'gap konsensus';
    default:
      return reason;
  }
}
