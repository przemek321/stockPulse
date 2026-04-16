#!/usr/bin/env python3
"""
audit_memory_vs_code.py

Weryfikuje twierdzenia z userMemories Claude'a przeciwko rzeczywistemu stanowi
kodu w repo StockPulse. Każde twierdzenie to pojedyncza asercja — True/False/WARN.

Uruchomienie (z roota repo):
    python3 scripts/audit_memory_vs_code.py

Sposób użycia:
    1. Przed sprint planning: uruchom skrypt.
    2. Zobacz które assertions są FALSE/WARN.
    3. Update memory — usuń przestarzałe, popraw liczby.

Uzasadnienie: Claude's memory driftuje — sprint po sprincie zmienia się kod,
a memory updates są manualne. Stare assertions zaczynają kłamać.
Code review 16.04.2026 znalazł 3 stale entries w memory. Ten skrypt
ma zapobiec kolejnym.

Autor: Code review Sprint 16 (16.04.2026).
"""

from __future__ import annotations

import re
import sys
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional


# ── Konfiguracja ───────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SRC_DIR = REPO_ROOT / "src"
TEST_DIR = REPO_ROOT / "test"
DOC_DIR = REPO_ROOT / "doc"

# ANSI kolory
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
BLUE = "\033[34m"
GRAY = "\033[90m"
BOLD = "\033[1m"
RESET = "\033[0m"


@dataclass
class AuditResult:
    name: str
    status: str  # PASS, FAIL, WARN, SKIP
    expected: str
    actual: str
    memory_claim: str  # Co dokładnie mówi memory
    fix_hint: Optional[str] = None


results: list[AuditResult] = []


def check(
    name: str,
    memory_claim: str,
    expected: str,
    actual: str,
    passed: bool,
    fix_hint: Optional[str] = None,
    warn: bool = False,
) -> None:
    """Zapisuje wynik asercji."""
    if warn:
        status = "WARN"
    elif passed:
        status = "PASS"
    else:
        status = "FAIL"
    results.append(AuditResult(name, status, expected, actual, memory_claim, fix_hint))


def count_files(pattern: str, base: Path = SRC_DIR) -> int:
    return len(list(base.rglob(pattern)))


def grep_count(pattern: str, files: str = "**/*.ts", base: Path = SRC_DIR) -> int:
    """Liczba wystąpień regex we wszystkich plikach pasujących do glob."""
    count = 0
    rx = re.compile(pattern)
    for path in base.rglob(files):
        try:
            content = path.read_text(encoding="utf-8")
            count += len(rx.findall(content))
        except Exception:
            continue
    return count


def grep_files(pattern: str, files: str = "**/*.ts", base: Path = SRC_DIR) -> list[Path]:
    """Pliki zawierające wzorzec."""
    rx = re.compile(pattern)
    matching = []
    for path in base.rglob(files):
        try:
            content = path.read_text(encoding="utf-8")
            if rx.search(content):
                matching.append(path)
        except Exception:
            continue
    return matching


def read_file(path: Path) -> str:
    return path.read_text(encoding="utf-8")


# ── Asercje ─────────────────────────────────────────────────────

def audit_module_count() -> None:
    """Memory: '18 modułów w src/'."""
    # Liczymy tylko directories wewnątrz src/
    modules = [d for d in SRC_DIR.iterdir() if d.is_dir()]
    count = len(modules)
    expected = 18
    check(
        name="Liczba modułów w src/",
        memory_claim="src/ ma 18 modułów (audyt 16.04)",
        expected=f"{expected}",
        actual=f"{count} ({', '.join(sorted(m.name for m in modules))})",
        passed=(count == expected),
        fix_hint=f"Memory mówi {expected}, znaleziono {count}. Update memory.",
    )


def audit_typeorm_entities() -> None:
    """Memory: '14 TypeORM entities'."""
    entities_dir = SRC_DIR / "entities"
    entity_files = [f for f in entities_dir.glob("*.entity.ts")]
    count = len(entity_files)
    expected = 14
    check(
        name="Liczba TypeORM entities",
        memory_claim="14 TypeORM entities",
        expected=f"{expected}",
        actual=f"{count}",
        passed=(count == expected),
    )


def audit_logged_decorator() -> None:
    """Memory: 'faktyczna liczba @Logged = 15 metod w 10 services'."""
    decorated = grep_count(r"@Logged\s*\(", base=SRC_DIR)
    expected = 15
    check(
        name="Liczba metod z @Logged() (Sprint 16)",
        memory_claim="15 metod z @Logged w 10 services",
        expected=f"{expected}",
        actual=f"{decorated}",
        passed=(decorated == expected),
        fix_hint=(
            f"Memory twierdzi {expected}, kod ma {decorated}. "
            "Audyt z 16.04 powiedział '15 metod (nie 13)'. Sprawdź."
        ),
    )


def audit_active_rules() -> None:
    """Memory: '8 aktywnych reguł alertów'."""
    universe = DOC_DIR / "stockpulse-healthcare-universe.json"
    if not universe.exists():
        check(
            name="Liczba aktywnych reguł alertów",
            memory_claim="8 aktywnych reguł",
            expected="JSON istnieje",
            actual="plik nie znaleziony",
            passed=False,
            warn=True,
        )
        return

    data = json.loads(universe.read_text(encoding="utf-8"))
    rules = data.get("alert_rules", {}).get("rules", [])
    active = [r for r in rules if r.get("is_active", True) is not False]
    expected = 8
    check(
        name="Liczba aktywnych reguł alertów",
        memory_claim="8 aktywnych reguł (w tym Form 4 Insider BUY)",
        expected=f"{expected}",
        actual=f"{len(active)} ({', '.join(r['name'] for r in active)})",
        passed=(len(active) == expected),
    )

    # Check: czy Form 4 Insider BUY jest aktywna (Sprint 15)
    form4_buy = next((r for r in rules if r["name"] == "Form 4 Insider BUY"), None)
    if form4_buy is None:
        check(
            name="Form 4 Insider BUY rule exists",
            memory_claim="Sprint 15 dodał 'Form 4 Insider BUY'",
            expected="reguła istnieje w seed JSON",
            actual="nie znaleziono",
            passed=False,
            fix_hint="Form4Pipeline oczekuje tej reguły — bez niej wszystkie BUY są skipowane",
        )
    else:
        check(
            name="Form 4 Insider BUY rule active",
            memory_claim="Sprint 15 'Form 4 Insider BUY' jest aktywna",
            expected="is_active: true (lub pominięte)",
            actual=f"is_active: {form4_buy.get('is_active', True)}",
            passed=(form4_buy.get("is_active", True) is not False),
        )


def audit_tickers_count() -> None:
    """Memory: '51 tickerów (37 healthcare + 14 semi)'."""
    healthcare_path = DOC_DIR / "stockpulse-healthcare-universe.json"
    semi_path = DOC_DIR / "stockpulse-semi-supply-chain.json"

    def count_tickers_in_json(path: Path) -> int:
        if not path.exists():
            return -1
        data = json.loads(path.read_text(encoding="utf-8"))
        tickers = data.get("tickers", {})
        total = 0
        for group in tickers.values():
            total += len(group.get("companies", []))
        return total

    hc = count_tickers_in_json(healthcare_path)
    semi = count_tickers_in_json(semi_path)
    expected_hc, expected_semi = 37, 14

    check(
        name="Healthcare tickery",
        memory_claim="37 healthcare tickers",
        expected=f"{expected_hc}",
        actual=f"{hc}",
        passed=(hc == expected_hc),
    )
    check(
        name="Semi supply chain tickery",
        memory_claim="14 semi tickers (observation mode)",
        expected=f"{expected_semi}",
        actual=f"{semi}",
        passed=(semi == expected_semi),
    )


def audit_bullmq_queues() -> None:
    """Memory: '8 BullMQ queues'."""
    queue_names_file = SRC_DIR / "queues" / "queue-names.const.ts"
    if not queue_names_file.exists():
        check(
            name="BullMQ queues count",
            memory_claim="8 BullMQ queues",
            expected="plik istnieje",
            actual="brak",
            passed=False,
            warn=True,
        )
        return

    content = read_file(queue_names_file)
    # Queue names: patrz na string literals w export const lub enum
    names = re.findall(r"['\"]([a-z][a-z0-9_-]+)['\"]", content)
    # Filter: tylko queue-like names
    queue_names = set(n for n in names if not n.startswith("--"))
    expected = 8
    check(
        name="BullMQ queues count",
        memory_claim="8 BullMQ queues",
        expected=f"~{expected}",
        actual=f"{len(queue_names)} (names: {', '.join(sorted(queue_names))})",
        passed=(abs(len(queue_names) - expected) <= 1),  # ±1 tolerance
        warn=(len(queue_names) != expected),
    )


def audit_rest_endpoints() -> None:
    """Memory: '28 REST endpoints'."""
    # Policz @Get/@Post/@Put/@Delete/@Patch decorators
    decorators = (
        grep_count(r"@Get\s*\(", base=SRC_DIR)
        + grep_count(r"@Post\s*\(", base=SRC_DIR)
        + grep_count(r"@Put\s*\(", base=SRC_DIR)
        + grep_count(r"@Delete\s*\(", base=SRC_DIR)
        + grep_count(r"@Patch\s*\(", base=SRC_DIR)
    )
    expected = 28
    check(
        name="REST endpoints count",
        memory_claim="28 REST endpoints",
        expected=f"{expected}",
        actual=f"{decorators}",
        passed=(abs(decorators - expected) <= 2),
        warn=(decorators != expected),
    )


def audit_correlation_windows() -> None:
    """Memory: 'INSIDER_PLUS_OPTIONS 120h/5d (kod Sprint 16)'."""
    correlation_service = SRC_DIR / "correlation" / "correlation.service.ts"
    if not correlation_service.exists():
        return
    content = read_file(correlation_service)

    # Szukamy WINDOW_120H
    has_120h = "WINDOW_120H" in content and "120 * 3600_000" in content
    # Szukamy WINDOW_14D (insider cluster = 7d, ale Redis TTL = 14d)
    has_14d = "WINDOW_14D" in content

    check(
        name="INSIDER_PLUS_OPTIONS window = 120h",
        memory_claim="INSIDER_PLUS_OPTIONS = 120h (Sprint 16 zmiana)",
        expected="WINDOW_120H = 120 * 3600_000",
        actual="znaleziono" if has_120h else "brak WINDOW_120H",
        passed=has_120h,
    )
    check(
        name="Insider signals Redis TTL = 14d",
        memory_claim="insider signals TTL 14d",
        expected="WINDOW_14D exists",
        actual="znaleziono" if has_14d else "brak",
        passed=has_14d,
    )


def audit_options_flow_cron() -> None:
    """Memory: 'Options Flow CRON 20:30 UTC (Sprint 16 zmienił z 22:15)'.

    UWAGA: Memory mówi 20:30 UTC. CLAUDE.md w repo mówi 22:15 (stale).
    Sprawdzamy kod.
    """
    scheduler = SRC_DIR / "collectors" / "options-flow" / "options-flow.scheduler.ts"
    if not scheduler.exists():
        check(
            name="Options Flow CRON time",
            memory_claim="Options Flow CRON 20:30 UTC (nie 22:15)",
            expected="plik istnieje",
            actual="brak",
            passed=False,
            warn=True,
        )
        return

    content = read_file(scheduler)
    # @Cron('... min hour ...')
    cron_match = re.search(r"@Cron\s*\(\s*['\"]([^'\"]+)['\"]", content)
    actual_cron = cron_match.group(1) if cron_match else "nie znaleziono"

    # Expected: 20:30 UTC czyli '30 20 * * 1-5' lub podobny
    has_20_30 = bool(re.match(r"^30\s+20\s", actual_cron))
    has_22_15 = bool(re.match(r"^15\s+22\s", actual_cron))

    status_note = ""
    if has_20_30:
        status_note = "20:30 UTC — zgadza się z memory"
        passed = True
    elif has_22_15:
        status_note = "22:15 UTC — zgadza się z CLAUDE.md (memory stale!)"
        passed = False
    else:
        status_note = f"inny CRON: {actual_cron}"
        passed = False

    check(
        name="Options Flow CRON time",
        memory_claim="20:30 UTC (Sprint 16 zmiana, CLAUDE.md stale)",
        expected="@Cron('30 20 * * 1-5')",
        actual=f"{actual_cron} — {status_note}",
        passed=passed,
        fix_hint="Jeśli FAIL: update memory lub update kod — memory/kod muszą się zgadzać",
    )


def audit_base_collector_not_swallowing() -> None:
    """Memory (stale): 'BaseCollectorService try/catch swallow exceptions — P0'.

    Kod review 16.04: FALSE POSITIVE — rethrow jest (linia 84).
    """
    base_collector = SRC_DIR / "collectors" / "shared" / "base-collector.service.ts"
    if not base_collector.exists():
        return
    content = read_file(base_collector)

    # Szukamy rethrow w runCollectionCycle catch block
    has_rethrow = "throw error" in content and "runCollectionCycle" in content

    check(
        name="BaseCollectorService rethrow errors",
        memory_claim="[STALE] 'BaseCollectorService swallow exceptions — P0'",
        expected="throw error w catch (rethrow do BullMQ retry)",
        actual="rethrow znaleziono" if has_rethrow else "brak rethrow",
        passed=has_rethrow,
        fix_hint=(
            "Memory ma stale entry mówiący o tym jako P0 bug. "
            "Jeśli PASS: usuń z memory."
        ),
    )


def audit_alert_sent_granular() -> None:
    """Memory (stale): 'ALERT_SENT kłamie w 3 scenariuszach'.

    Kod review 16.04: FALSE POSITIVE — granularne action statuses są (linie 590-595).
    """
    alert_evaluator = SRC_DIR / "alerts" / "alert-evaluator.service.ts"
    if not alert_evaluator.exists():
        return
    content = read_file(alert_evaluator)

    # Szukamy granularnych statusów
    has_granular = all(
        status in content
        for status in [
            "ALERT_DB_ONLY_OBSERVATION",
            "ALERT_DB_ONLY_SILENT_RULE",
            "ALERT_DB_ONLY_DAILY_LIMIT",
            "ALERT_SENT_TELEGRAM",
            "ALERT_TELEGRAM_FAILED",
        ]
    )

    check(
        name="AlertEvaluator granular action statuses",
        memory_claim="[STALE] 'ALERT_SENT kłamie w 3 scenariuszach observation/sent/failed'",
        expected="5 granularnych statusów (ALERT_DB_ONLY_*, ALERT_SENT_TELEGRAM, ALERT_TELEGRAM_FAILED)",
        actual="wszystkie 5 znaleziono" if has_granular else "niektóre brakują",
        passed=has_granular,
        fix_hint="Memory ma stale entry. Jeśli PASS: usuń z memory.",
    )


def audit_form8k_timeout() -> None:
    """Memory (częściowo stale): 'fetch() bez timeout'.

    Form8kPipeline MA timeouty. SEC EDGAR collector NIE MA.
    Sprawdzamy oba.
    """
    form8k = SRC_DIR / "sec-filings" / "pipelines" / "form8k.pipeline.ts"
    if form8k.exists():
        content = read_file(form8k)
        has_timeout = "AbortSignal.timeout" in content
        check(
            name="Form8kPipeline fetch timeout",
            memory_claim="[STALE] 'fetch() bez timeout w SEC/Telegram/PDUFA/Finnhub'",
            expected="AbortSignal.timeout używane",
            actual="tak" if has_timeout else "NIE",
            passed=has_timeout,
            fix_hint="Jeśli PASS: update memory (Form8kPipeline ma timeout)",
        )

    sec_edgar = SRC_DIR / "collectors" / "sec-edgar" / "sec-edgar.service.ts"
    if sec_edgar.exists():
        content = read_file(sec_edgar)
        has_timeout = "AbortSignal.timeout" in content
        check(
            name="SEC EDGAR collector fetch timeout",
            memory_claim="Memory mówi ogólnie 'fetch bez timeout'",
            expected="AbortSignal.timeout używane",
            actual="tak" if has_timeout else "NIE — FLAG #28",
            passed=has_timeout,
            fix_hint=(
                "SEC EDGAR collector NIE MA timeout — potwierdza FLAG #28 z review. "
                "Dodaj signal: AbortSignal.timeout(15000)"
            ),
        )


def audit_daily_limit_in_pipelines() -> None:
    """Memory: 'daily limit 5/day omija Form4/8k/Correlation pipelines'.

    Audyt FLAG #10: prawda, żadna z tych 3 ścieżek nie ma checku.
    """
    form4 = SRC_DIR / "sec-filings" / "pipelines" / "form4.pipeline.ts"
    form8k = SRC_DIR / "sec-filings" / "pipelines" / "form8k.pipeline.ts"
    correlation = SRC_DIR / "correlation" / "correlation.service.ts"

    for path, name in [
        (form4, "Form4Pipeline"),
        (form8k, "Form8kPipeline"),
        (correlation, "CorrelationService"),
    ]:
        if not path.exists():
            continue
        content = read_file(path)
        # Szukamy referencji do MAX_TELEGRAM_ALERTS_PER_SYMBOL_PER_DAY lub podobnego daily limit
        has_daily_limit = any(
            kw in content
            for kw in [
                "MAX_TELEGRAM_ALERTS_PER_SYMBOL_PER_DAY",
                "MAX_DAILY_ALERTS",
                "dailyLimitHit",
                "todayAlerts >=",
            ]
        )
        check(
            name=f"{name} daily limit check",
            memory_claim="Memory: 'daily limit 5/day omija Form4/8k/Correlation'",
            expected="brak daily limit checku (FLAG #10 potwierdza)",
            actual="brak" if not has_daily_limit else "znaleziono (memory nieaktualne)",
            # Test PASSES gdy brak daily limit — potwierdza że FLAG #10 to bug
            passed=(not has_daily_limit),
            warn=not has_daily_limit,
            fix_hint="FLAG #10 P0: wydzielić AlertDeliveryGate z shared daily limit",
        )


def audit_redis_password() -> None:
    """Memory: 'REDIS_PASSWORD nieużywany w 3 providerach'.

    Faktycznie: jest używany we wszystkich 3 (| undefined).
    """
    providers = [
        SRC_DIR / "correlation" / "redis.provider.ts",
        SRC_DIR / "sec-filings" / "sec-filings.module.ts",
        SRC_DIR / "queues" / "queues.module.ts",
    ]

    uses_password = 0
    for p in providers:
        if p.exists() and "REDIS_PASSWORD" in read_file(p):
            uses_password += 1

    check(
        name="Redis providers reference REDIS_PASSWORD env",
        memory_claim="[STALE?] 'REDIS_PASSWORD nieużywany w 3 providerach'",
        expected="3/3 providerów referuje REDIS_PASSWORD",
        actual=f"{uses_password}/3",
        passed=(uses_password == 3),
        fix_hint=(
            "Memory to P0 bug ale kod używa (`config.get('REDIS_PASSWORD') || undefined`). "
            "To nie jest bug, tylko fallback na no-password Redis. Usuń z memory."
        ),
    )


def audit_correlation_redis_multi_exec() -> None:
    """FLAG #3: CorrelationService.storeSignal używa pojedynczych Redis ops zamiast MULTI/EXEC.

    Ten skrypt flaguje gdy brak atomic operations.
    """
    path = SRC_DIR / "correlation" / "correlation.service.ts"
    if not path.exists():
        return
    content = read_file(path)

    has_multi = "redis.multi" in content or "MULTI" in content
    has_zadd = "zadd" in content

    check(
        name="CorrelationService uses atomic Redis MULTI/EXEC",
        memory_claim="Memory nie wspomina, ale FLAG #3 z review",
        expected="redis.multi().zadd().zremrangebyscore().exec() — atomic",
        actual="brak MULTI — pojedyncze ops (FLAG #3 P1)" if (has_zadd and not has_multi) else "OK",
        passed=(has_multi or not has_zadd),
        warn=(has_zadd and not has_multi),
        fix_hint="Użyj redis.multi() dla zadd+zremrangebyscore+expire — race condition",
    )


def audit_nyse_holidays() -> None:
    """FLAG #26: market-hours.util.ts nie ma listy NYSE holidays."""
    path = SRC_DIR / "common" / "utils" / "market-hours.util.ts"
    if not path.exists():
        return
    content = read_file(path)

    has_holidays = any(
        kw in content
        for kw in [
            "NYSE_HOLIDAYS",
            "holidays",
            "isHoliday",
            "Thanksgiving",
            "Juneteenth",
            "Independence Day",
        ]
    )
    check(
        name="NYSE holidays handled",
        memory_claim="Memory nie wspomina — FLAG #26 z review",
        expected="lista NYSE holidays w market-hours.util.ts",
        actual="nie zaimplementowane (FLAG #26 P0 — bias 58h/rok)" if not has_holidays else "OK",
        passed=has_holidays,
        warn=not has_holidays,
        fix_hint="Dodaj statyczną tablicę NYSE holidays 2024-2027",
    )


def audit_options_baseline_contamination() -> None:
    """FLAG #21: updateRollingAverage nie ma outlier protection."""
    path = SRC_DIR / "collectors" / "options-flow" / "unusual-activity-detector.ts"
    if not path.exists():
        return
    content = read_file(path)

    # Czy jest winsorization lub skip on spike?
    has_winsorize = "winsorize" in content.lower() or "outlier" in content.lower()
    has_spike_skip = "isUnusual" in content and "updateRollingAverage" in content

    check(
        name="Options baseline spike contamination protection",
        memory_claim="Memory nie wspomina — FLAG #21 z review (P0)",
        expected="winsorization albo skip update on isUnusual",
        actual="brak — FLAG #21 aktywny" if not has_winsorize else "OK",
        passed=has_winsorize,
        warn=not has_winsorize,
        fix_hint=(
            "KRYTYCZNE: pojedynczy spike zawyża baseline → ukrywa kolejne. "
            "Może tłumaczyć hit rate 52.5% options flow."
        ),
    )


def audit_price_outcome_backfill() -> None:
    """FLAG #25: backfillOldAlerts zapisuje current price jako priceAtAlert."""
    path = SRC_DIR / "price-outcome" / "price-outcome.service.ts"
    if not path.exists():
        return
    content = read_file(path)

    has_backfill = "backfillOldAlerts" in content
    # Czy używa getQuote (current) czy /candle (historical)?
    uses_current_quote = re.search(
        r"backfillOldAlerts[\s\S]{0,500}getQuote", content
    ) is not None
    uses_candle = re.search(r"backfillOldAlerts[\s\S]{0,500}candle", content) is not None

    if has_backfill and uses_current_quote and not uses_candle:
        check(
            name="PriceOutcome backfill — data contamination",
            memory_claim="Memory nie wspomina — FLAG #25 P0",
            expected="candle endpoint (historical) lub brak backfill",
            actual="używa getQuote (current price) — KORUMPUJE DANE",
            passed=False,
            fix_hint=(
                "DISABLE backfillOldAlerts ALBO zamień getQuote → candle endpoint. "
                "Audit istniejące dane: SELECT COUNT(*) FROM alerts "
                "WHERE ABS(price1d - priceAtAlert) < 0.01 AND price1d IS NOT NULL"
            ),
        )
    else:
        check(
            name="PriceOutcome backfill safe",
            memory_claim="FLAG #25",
            expected="historical price lub brak backfill",
            actual="OK",
            passed=True,
        )


def audit_form4_multi_owner() -> None:
    """FLAG #30: form4-parser.ts bierze pierwszego reportingOwner dla wszystkich transakcji."""
    path = SRC_DIR / "collectors" / "sec-edgar" / "form4-parser.ts"
    if not path.exists():
        return
    content = read_file(path)

    # Czy parser mapuje transakcje do konkretnego ownera?
    # Szukamy: rptOwnerCik w extractInsiderName przekazywane per transaction
    # Obecnie: const firstOwner = ...[0]; ... applied to all txns
    takes_first_owner = "owners[0]" in content or "Array.isArray(owners) ? owners[0]" in content
    maps_per_txn = "rptOwnerCik" in content and "transaction" in content.lower()

    if takes_first_owner and not maps_per_txn:
        check(
            name="Form4 parser handles multi-reportingOwner",
            memory_claim="Memory nie wspomina — FLAG #30 P0 (⭐ najważniejszy)",
            expected="mapowanie transakcja → właściwy owner przez rptOwnerCik",
            actual="bierze pierwszego ownera dla wszystkich transakcji — skażone dane",
            passed=False,
            fix_hint=(
                "Backtest V2 (d=0.725) mógł być częściowo skrzywiony. "
                "Po fix: re-run backtest i porównaj."
            ),
        )
    else:
        check(
            name="Form4 parser handles multi-reportingOwner",
            memory_claim="FLAG #30",
            expected="mapowanie per transaction",
            actual="OK",
            passed=True,
        )


def audit_dead_code_sentiment() -> None:
    """FLAG #1: dead code w AlertEvaluator (checkSentimentCrash itp.)."""
    path = SRC_DIR / "alerts" / "alert-evaluator.service.ts"
    if not path.exists():
        return
    content = read_file(path)

    dead_methods = [
        "checkSentimentCrash",
        "checkSignalOverride",
        "checkHighConviction",
        "checkStrongFinbert",
        "checkUrgentSignal",
    ]
    found = [m for m in dead_methods if m in content]

    # Sprawdź czy onSentimentScored ma early return (wszystkie below = dead)
    has_early_return = re.search(
        r"onSentimentScored[\s\S]{0,2000}SKIP:\s*Sprint 11",
        content,
    )

    if found and has_early_return:
        check(
            name="Dead code: sentiment check methods",
            memory_claim="Memory mówi 'Sprint 11 usunął sentiment' — nie do końca",
            expected="metody usunięte lub early return not present",
            actual=f"{len(found)} metod to dead code (onSentimentScored robi early return)",
            passed=False,
            warn=True,
            fix_hint="Usuń 5 metod + related formattery (~250 linii dead code)",
        )


def audit_dead_code_correlation() -> None:
    """FLAG #2: dead code w CorrelationService (3 pattern detectors)."""
    path = SRC_DIR / "correlation" / "correlation.service.ts"
    if not path.exists():
        return
    content = read_file(path)

    # Dead detectors
    dead_detectors = [
        "detectFilingConfirmsNews",
        "detectMultiSourceConvergence",
        "detectEscalatingSignal",
    ]
    defined_but_not_called = []
    for det in dead_detectors:
        # Defined: `private detectFoo(`
        defined = f"private {det}(" in content
        # Called: `this.detectFoo(` — jeśli nie, to dead
        called = content.count(f"this.{det}(") > 0
        if defined and not called:
            defined_but_not_called.append(det)

    if defined_but_not_called:
        check(
            name="Dead code: pattern detectors",
            memory_claim="FLAG #2",
            expected="usunięte",
            actual=f"{len(defined_but_not_called)} detektorów: {', '.join(defined_but_not_called)}",
            passed=False,
            warn=True,
            fix_hint="Usuń ~150 linii dead code",
        )


def audit_backtest_uses_ticker_profile() -> None:
    """FLAG #12: backtest nie testuje TickerProfileService."""
    backtest_dir = REPO_ROOT / "scripts" / "backtest"
    if not backtest_dir.exists():
        return

    has_profile = False
    for f in backtest_dir.rglob("*.py"):
        content = f.read_text(encoding="utf-8", errors="ignore")
        if any(kw in content for kw in ["TickerProfile", "ticker_profile", "signalProfile"]):
            has_profile = True
            break

    check(
        name="Backtest uses TickerProfile calibration",
        memory_claim="Memory: 'Point-in-time audit clean' — ale backtest ≠ production",
        expected="backtest testuje prod pipeline z TickerProfile",
        actual="backtest NIE używa TickerProfile — raw GPT + rules tylko" if not has_profile else "OK",
        passed=has_profile,
        warn=not has_profile,
        fix_hint=(
            "FLAG #12: live Sharpe może być niższy niż backtest sugeruje. "
            "Sprint 16: dodaj A/B with/without TickerProfile."
        ),
    )


# ── Runner ─────────────────────────────────────────────────────

def run_all_audits() -> None:
    print(f"{BOLD}{BLUE}━━━ StockPulse Memory vs Code Audit ━━━{RESET}")
    print(f"{GRAY}Repo: {REPO_ROOT}{RESET}\n")

    audits: list[Callable[[], None]] = [
        # Counts (structure)
        audit_module_count,
        audit_typeorm_entities,
        audit_logged_decorator,
        audit_active_rules,
        audit_tickers_count,
        audit_bullmq_queues,
        audit_rest_endpoints,
        # Sprint 16 changes
        audit_correlation_windows,
        audit_options_flow_cron,
        # Stale memory entries (should PASS = code OK, memory lies)
        audit_base_collector_not_swallowing,
        audit_alert_sent_granular,
        audit_form8k_timeout,
        audit_redis_password,
        # Active bugs from code review
        audit_daily_limit_in_pipelines,
        audit_correlation_redis_multi_exec,
        audit_nyse_holidays,
        audit_options_baseline_contamination,
        audit_price_outcome_backfill,
        audit_form4_multi_owner,
        # Code hygiene
        audit_dead_code_sentiment,
        audit_dead_code_correlation,
        # Strategic
        audit_backtest_uses_ticker_profile,
    ]

    for fn in audits:
        try:
            fn()
        except Exception as e:
            results.append(
                AuditResult(
                    name=fn.__name__,
                    status="SKIP",
                    expected="audit runs",
                    actual=f"exception: {e}",
                    memory_claim="(audit failed)",
                )
            )


def print_results() -> None:
    passed = [r for r in results if r.status == "PASS"]
    failed = [r for r in results if r.status == "FAIL"]
    warned = [r for r in results if r.status == "WARN"]
    skipped = [r for r in results if r.status == "SKIP"]

    # Per-check output
    for r in results:
        icon = {
            "PASS": f"{GREEN}✓{RESET}",
            "FAIL": f"{RED}✗{RESET}",
            "WARN": f"{YELLOW}⚠{RESET}",
            "SKIP": f"{GRAY}-{RESET}",
        }[r.status]
        name_colored = (
            f"{BOLD}{r.name}{RESET}"
            if r.status in ("FAIL", "WARN")
            else r.name
        )
        print(f"{icon} {name_colored}")
        print(f"  {GRAY}memory:{RESET}   {r.memory_claim}")
        print(f"  {GRAY}expected:{RESET} {r.expected}")
        print(f"  {GRAY}actual:{RESET}   {r.actual}")
        if r.fix_hint and r.status in ("FAIL", "WARN"):
            print(f"  {YELLOW}fix:{RESET}      {r.fix_hint}")
        print()

    # Summary
    print(f"{BOLD}━━━ Summary ━━━{RESET}")
    total = len(results)
    print(f"  {GREEN}PASS{RESET}: {len(passed)}/{total}")
    print(f"  {RED}FAIL{RESET}: {len(failed)}/{total}")
    print(f"  {YELLOW}WARN{RESET}: {len(warned)}/{total}")
    if skipped:
        print(f"  {GRAY}SKIP{RESET}: {len(skipped)}/{total}")

    if failed or warned:
        print()
        print(f"{BOLD}{YELLOW}Action items:{RESET}")
        for r in failed + warned:
            print(f"  - [{r.status}] {r.name}")


def main() -> int:
    run_all_audits()
    print_results()

    # Exit code: non-zero if any FAIL (nie WARN)
    return 1 if any(r.status == "FAIL" for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
