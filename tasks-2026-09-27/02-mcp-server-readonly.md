# 02 — MCP server read-only (osobny kontener) — **PO 01.11**

## Decyzja (28.09): osobny kontener + rola Postgresa read-only
Uzasadnienie: MCP jest interfejsem dla agentów zewnętrznych (Claude Code/Desktop) — błąd, wyciek pamięci lub
prompt injection z treści filingu nie może dotknąć procesu z sygnałami. Rola `stockpulse_ro` z `GRANT SELECT`
na wszystkich tabelach + `INSERT/UPDATE` **tylko** na `agent_findings` (dla ewentualnego `ack_finding`, domyślnie
wyłączony). Koszt: drugi obraz Node na Jetsonie (~80 MB RAM); zasoby są (2/15 GB).

## Scope (4 pliki + compose + SQL)
- `mcp/` (nowy katalog, osobny `package.json`, bez NestJS — czysty Node 20 + `@modelcontextprotocol/sdk@1.30.1` + `pg@8.x` + `zod@3.25.x`):
  `mcp/src/server.ts` (stdio transport), `mcp/src/tools/*.ts` (po jednym pliku na tool), `mcp/src/edgar-cache.ts`
- `docker-compose.yml`: serwis `mcp` (`stdin_open: true`, `tty: false`, `depends_on: postgres`, `POSTGRES_USER=stockpulse_ro`,
  volume `mcp-edgar-cache:/cache`), `docker-compose.jetson.yml` analogicznie
- `scripts/sql/mcp-readonly-role.sql` — `CREATE ROLE stockpulse_ro LOGIN PASSWORD '<z .env MCP_DB_PASSWORD>'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO stockpulse_ro; GRANT INSERT, UPDATE (status) ON agent_findings TO stockpulse_ro;` — wykonanie ręczne (zgoda usera: prod DB)
- Transport: **stdio** (`docker exec -i stockpulse-mcp node dist/server.js` jako command w konfiguracji klienta MCP). Streamable HTTP tylko jeśli `docker exec -i` okaże się niestabilne z Claude Desktop — zanotować.

## Tools (nazwy encji/kolumn z kodu; kształty odpowiedzi = JSON, paginacja `limit/offset`, max 100 wierszy)
| tool | wejście | źródło | uwagi |
|---|---|---|---|
| `list_alerts` | `from, to, ticker?, ruleName?, delivered?, limit=50, offset=0` | `alerts` + `sec_filings.gptAnalysis` (join po `symbol` i `filingDate ∈ [sentAt−3d, sentAt]`) | zwraca `message` w całości (to jest tekst Telegrama — zapisany); `gptAnalysis` może być null |
| `get_raw_filing` | `accessionNumber` LUB `alertId` | **EDGAR na żądanie** (`sec_filings.documentUrl` → `index.json` → plik `.xml`/`.htm`); cache dysk `/cache` 200 MB LRU, TTL 30 d; `User-Agent` z `SEC_USER_AGENT`; ≥200 ms między requestami | `truncated: true` powyżej 512 KB; dla `alertId` bez accession (alerts nie ma tej kolumny) → dopasowanie po `symbol`+`sentAt` do `sec_filings`, zwrot listy kandydatów jeśli >1 |
| `get_ticker_profile` | `ticker` | `tickers` + `TickerProfileService` (odczyt przez SQL na `alerts`/`price outcome`, NIE przez DI, bo MCP jest poza NestJS) | benchmark: stałe `{xbi: true, ibb: true}` — brak mapowania SIC (fakt), zwracać jawnie `benchmarkMapping: null` |
| `get_price_outcomes` | `alertId` | `alerts` sloty `priceAtAlert, price1h, price4h, price1d, price3d, price7d, xbi*, ibb*` | + policzone `gap1h`, `raw7d`, `alphaXbi7d` wg definicji z KALENDARZA (te same wzory co `scripts/sql/csuite-gate.cte.sql`) |
| `list_agent_findings` | `alertId?, severity?, status?, checkId?, limit, offset` | `agent_findings` | |
| `ack_finding` | — | — | **nie implementować** w tym tasku (brief: domyślnie nie) |

## Inwarianty
- Kontener `mcp` nie ma `TELEGRAM_*`, `ANTHROPIC_*`, `FINNHUB_*` w env (osobny `env_file: .env.mcp` z 3 zmiennymi: PG, `SEC_USER_AGENT`, `MCP_DB_PASSWORD`).
- Rola `stockpulse_ro` nie może `INSERT` do niczego poza `agent_findings` — test: `INSERT INTO alerts` → `permission denied`.
- Żaden tool nie wykonuje `UPDATE/DELETE`.

## Weryfikacja
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | docker exec -i stockpulse-mcp node dist/server.js   # 5 tools
# list_alerts od 2026-09-20: zawiera 2511 DMRA z message zaczynającym się od '🔴 *StockPulse Alert*'
# get_raw_filing accessionNumber=0001193125-26-403355 → XML z ownershipDocument, cache hit przy 2. wywołaniu (log)
docker exec stockpulse-postgres psql -U stockpulse_ro -d stockpulse -c "INSERT INTO alerts(symbol) VALUES('X')"  # permission denied
```
Claude Code: `claude mcp add stockpulse -- docker exec -i stockpulse-mcp node dist/server.js` → `list_alerts` działa.

## Exit criteria
- [ ] 5 tools, JSON, paginacja, `truncated` flag; rola RO zweryfikowana negatywnie
- [ ] cache EDGAR: hit/miss w logu, limit 200 MB egzekwowany
- [ ] kontener `mcp` restart nie dotyka `app` (osobny `restart: unless-stopped`)
