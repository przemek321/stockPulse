# ═══════════════════════════════════════════════════════
# StockPulse — Makefile
#
# Automatycznie wykrywa środowisko (Jetson vs laptop)
# i używa odpowiedniego docker-compose override.
#
# Użycie:
#   make up        — start całego stacku
#   make down      — stop
#   make rebuild   — rebuild po zmianach kodu
#   make logs      — logi wszystkich serwisów
#   make status    — status kontenerów + health check
#   make seed      — seed bazy (tickery + reguły)
#   make backup    — backup bazy do pliku
#   make restore   — restore bazy z pliku
# ═══════════════════════════════════════════════════════

# Autodetekcja środowiska po architekturze CPU
ARCH := $(shell uname -m)

ifeq ($(ARCH),aarch64)
  # Jetson Orin NX / Xavier — L4T + CUDA 11.4
  COMPOSE_FILES := -f docker-compose.yml -f docker-compose.jetson.yml
  ENV_NAME := jetson
else
  # Laptop/desktop x86_64 — bazowy compose (brak FinBERT = brak GPU overridów)
  COMPOSE_FILES := -f docker-compose.yml
  ifeq ($(shell docker info --format '{{.Runtimes.nvidia}}' 2>/dev/null),)
    ENV_NAME := cpu
  else
    ENV_NAME := gpu
  endif
endif

DC := docker compose $(COMPOSE_FILES)

.PHONY: up down rebuild logs status seed backup restore health shell-app shell-db

## Start całego stacku
up:
	@echo "▶ Środowisko: $(ENV_NAME) ($(ARCH))"
	$(DC) up -d

## Stop stacku
down:
	$(DC) down

## Rebuild po zmianach kodu (app + frontend)
rebuild:
	@echo "▶ Rebuild: $(ENV_NAME)"
	$(DC) up -d --build

## Rebuild tylko backendu (szybki)
rebuild-app:
	$(DC) up -d --build app

## Logi (wszystkie serwisy, follow)
logs:
	$(DC) logs -f --tail 50

## Logi konkretnego serwisu (usage: make log S=app)
log:
	$(DC) logs -f --tail 50 $(S)

## Status kontenerów + health check
status:
	@echo "▶ Środowisko: $(ENV_NAME) ($(ARCH))"
	@echo ""
	@docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
	@echo ""
	@echo "▶ Health check:"
	@docker exec stockpulse-app node -e "\
		const http = require('http'); \
		http.get('http://localhost:3000/api/health', res => { \
			let d = ''; \
			res.on('data', c => d+=c); \
			res.on('end', () => { \
				const h = JSON.parse(d); \
				console.log('  API:', h.status); \
				console.log('  Telegram:', h.telegram?.configured ? 'OK' : 'brak'); \
			}); \
		});" 2>/dev/null || echo "  API: nie działa"

## Seed bazy danych (tickery + reguły alertów)
seed:
	docker exec stockpulse-app npm run seed

## Backup bazy do pliku
backup:
	@mkdir -p backups
	docker exec stockpulse-postgres pg_dump -U stockpulse -Fc stockpulse > backups/stockpulse_$(shell date +%Y%m%d_%H%M%S).dump
	@echo "▶ Backup zapisany w backups/"
	@ls -lh backups/*.dump | tail -1

## Restore bazy z najnowszego backupu (lub FILE=ścieżka)
restore:
	$(eval FILE ?= $(shell ls -t backups/*.dump 2>/dev/null | head -1))
	@test -n "$(FILE)" || (echo "Brak pliku backupu. Użyj: make restore FILE=backups/plik.dump" && exit 1)
	@echo "▶ Restore z: $(FILE)"
	docker cp $(FILE) stockpulse-postgres:/tmp/restore.dump
	docker exec stockpulse-postgres pg_restore -U stockpulse -d stockpulse --clean --if-exists /tmp/restore.dump || true
	@echo "▶ Restore zakończony"

## Shell do kontenera app (debug)
shell-app:
	docker exec -it stockpulse-app sh

## Shell do bazy (psql)
shell-db:
	docker exec -it stockpulse-postgres psql -U stockpulse -d stockpulse

## Statystyki bazy
stats:
	@docker exec stockpulse-postgres psql -U stockpulse -d stockpulse -c "\
		SELECT 'tickers' as tabela, COUNT(*) FROM tickers \
		UNION ALL SELECT 'raw_mentions', COUNT(*) FROM raw_mentions \
		UNION ALL SELECT 'news_articles', COUNT(*) FROM news_articles \
		UNION ALL SELECT 'sec_filings', COUNT(*) FROM sec_filings \
		UNION ALL SELECT 'alerts', COUNT(*) FROM alerts \
		ORDER BY 1;"

## Wyświetl dostępne komendy
help:
	@echo "StockPulse — środowisko: $(ENV_NAME) ($(ARCH))"
	@echo ""
	@echo "  make up             Start stacku"
	@echo "  make down           Stop stacku"
	@echo "  make rebuild        Rebuild wszystkiego"
	@echo "  make rebuild-app    Rebuild tylko backendu"
	@echo "  make status         Status + health check"
	@echo "  make logs           Logi (follow)"
	@echo "  make log S=app      Logi konkretnego serwisu"
	@echo "  make seed           Seed bazy danych"
	@echo "  make backup         Backup bazy"
	@echo "  make restore        Restore bazy"
	@echo "  make stats          Statystyki bazy"
	@echo "  make shell-app      Shell do app"
	@echo "  make shell-db       Shell psql"
