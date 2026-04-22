/**
 * Typy eventów w systemie StockPulse.
 * Używane przez EventEmitter2 do komunikacji między modułami.
 */
export enum EventType {
  /** Nowa wzmianka z Reddit/StockTwits */
  NEW_MENTION = 'mention.new',
  /** Nowy artykuł z Finnhub */
  NEW_ARTICLE = 'article.new',
  /** Nowy filing z SEC EDGAR */
  NEW_FILING = 'filing.new',
  /** Nowa transakcja insider (Form 4) */
  NEW_INSIDER_TRADE = 'insider-trade.new',
  /** Wykryto anomalię (volume spike, options unusual activity) */
  ANOMALY_DETECTED = 'anomaly.detected',
  /** Wyzwolono alert */
  ALERT_TRIGGERED = 'alert.triggered',
  /** Nowy event PDUFA (data decyzji FDA) z pdufa.bio */
  NEW_PDUFA_EVENT = 'pdufa-event.new',
  /** Analiza GPT filingu SEC zakończona */
  SEC_FILING_ANALYZED = 'sec-filing.analyzed',
  /** Wykryty wzorzec korelacji między źródłami */
  CORRELATION_DETECTED = 'correlation.detected',
  /** Wykryta nietypowa aktywność opcyjna (volume spike) */
  NEW_OPTIONS_FLOW = 'options-flow.new',
}
