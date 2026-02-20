# StockPulse na NVIDIA Jetson Orin NX

## Środowisko

| Element | Wartość |
|---------|---------|
| Platforma | NVIDIA Jetson Orin NX 16GB |
| OS | Ubuntu 20.04 (L4T R35.5.0, JetPack 5.1.3) |
| Architektura | aarch64 |
| CUDA | 11.4.298 |
| GPU | Orin (współdzielone 15.1 GB VRAM z CPU) |
| Docker | 24.0.5 + Compose v2.24.5 |
| NVIDIA Container Toolkit | 1.11.0 |

## Szybki start na Jetsonie

```bash
# 1. Sklonuj repo (lub git pull jeśli już jest)
git clone <repo-url> && cd stockPulse

# 2. Utwórz .env i uzupełnij klucze API
cp .env.example .env
nano .env

# 3. Start (Makefile auto-wykrywa Jetsona po aarch64)
make up

# 4. Seed bazy (tickery healthcare + reguły alertów)
make seed

# 5. Weryfikacja
make status
```

## Komendy (Makefile)

Makefile automatycznie wykrywa środowisko (Jetson vs laptop) i używa odpowiednich plików.

```bash
make up              # Start całego stacku
make down            # Stop stacku
make rebuild         # Rebuild wszystkiego po zmianach
make rebuild-app     # Rebuild tylko backendu NestJS
make rebuild-finbert # Rebuild FinBERT sidecar
make status          # Status kontenerów + health check
make logs            # Logi wszystkich serwisów (follow)
make log S=finbert   # Logi konkretnego serwisu
make seed            # Seed bazy (tickery + reguły)
make backfill        # Backfill sentymentu FinBERTem
make backup          # Backup bazy do backups/
make restore         # Restore z najnowszego backupu
make restore FILE=backups/plik.dump  # Restore z konkretnego pliku
make stats           # Statystyki bazy (ilość rekordów)
make shell-app       # Shell do kontenera app
make shell-db        # Shell psql do bazy
make help            # Lista komend
```

## Pliki per środowisko

```
docker-compose.yml              ← bazowy (wspólny, nie edytuj per-maszynę)
docker-compose.cpu.yml          ← override: laptop bez GPU
docker-compose.jetson.yml       ← override: Jetson (L4T + runtime nvidia)

finbert-sidecar/
  Dockerfile                    ← laptop z NVIDIA GPU (CUDA 12.4, Python 3.11)
  Dockerfile.cpu                ← laptop bez GPU (Python 3.11)
  Dockerfile.jetson             ← Jetson (L4T PyTorch 2.0, CUDA 11.4, Python 3.8)
  requirements.txt              ← laptop (torch==2.5.1)
  requirements-jetson.txt       ← Jetson (bez torch — jest w obrazie L4T)
```

### Co Makefile wybiera automatycznie

| Środowisko | Detekcja | Compose override | FinBERT Dockerfile |
|------------|----------|------------------|--------------------|
| Jetson (aarch64) | `uname -m` = aarch64 | docker-compose.jetson.yml | Dockerfile.jetson |
| Laptop z GPU | nvidia runtime w Docker | brak (bazowy) | Dockerfile |
| Laptop bez GPU | brak nvidia runtime | docker-compose.cpu.yml | Dockerfile.cpu |

## Workflow: Laptop ↔ Jetson

### Schemat

```
Laptop (x86, dev)  ──git push──→  GitHub  ──git pull──→  Jetson (aarch64, prod)
```

### Na laptopie (development)

```bash
# Edytujesz kod w VS Code
make up              # auto: gpu / cpu
make rebuild-app     # po zmianach backendu
make logs            # debug

# Commit i push
git add -A && git commit -m "opis zmian"
git push
```

### Na Jetsonie (produkcja)

```bash
git pull
make rebuild         # auto: jetson
make status          # weryfikacja
```

### Co jest wspólne, co osobne

| Element | Współdzielone (git) | Osobne per maszyna |
|---------|--------------------|--------------------|
| src/, frontend/src/ | tak | — |
| finbert-sidecar/app/ | tak | — |
| Dockerfiles (wszystkie) | tak | — |
| docker-compose*.yml | tak | — |
| Makefile | tak | — |
| `.env` | **nie** (gitignored) | tak — różne klucze API |
| volumes (dane, model cache) | **nie** | tak — lokalne dane |

## Transfer bazy między maszynami

### Backup (źródłowa maszyna)

```bash
make backup
# → zapisuje do backups/stockpulse_YYYYMMDD_HHMMSS.dump
```

### Transfer

```bash
scp backups/stockpulse_*.dump n1copl@<jetson-ip>:~/stockPulse/backups/
```

### Restore (docelowa maszyna)

```bash
make restore
# → automatycznie bierze najnowszy plik z backups/

# Lub konkretny plik:
make restore FILE=backups/stockpulse_20260220_2128.dump
```

## Różnice techniczne Jetson vs Laptop

### FinBERT sidecar

| Parametr | Laptop (GPU) | Laptop (CPU) | Jetson Orin NX |
|----------|-------------|-------------|----------------|
| Obraz bazowy | nvidia/cuda:12.4.1 | python:3.11-slim | L4T PyTorch r35.2.1 |
| Python | 3.11 | 3.11 | 3.8 |
| PyTorch | 2.5.1 | 2.5.1 (CPU) | 2.0.0 (wbudowany) |
| CUDA | 12.4 | brak | 11.4 |
| Batch size | 16 | 8 | 8 |
| Obraz Docker | ~5 GB | ~1.5 GB | ~7 GB |

### Kompatybilność kodu Python 3.8

Pliki `finbert-sidecar/app/main.py` i `model.py` mają `from __future__ import annotations` na górze — to zapewnia kompatybilność składni `dict[str, float]` / `list[str]` z Pythonem 3.8 na Jetsonie. Pakiet `eval_type_backport` w requirements-jetson.txt obsługuje Pydantic v2 na Pythonie 3.8.

**Zasada**: nie usuwaj `from __future__ import annotations` z plików FinBERT.

## Kontenery na Jetsonie (5 serwisów)

| Kontener | Obraz | Port | RAM (~) |
|----------|-------|------|---------|
| stockpulse-postgres | timescale/timescaledb:latest-pg16 | 5432 | ~200 MB |
| stockpulse-redis | redis:7-alpine | 6379 | ~50 MB |
| stockpulse-app | stockpulse-app (node:20-alpine) | 3000 | ~200 MB |
| stockpulse-frontend | stockpulse-frontend (node:20-alpine) | 3001 | ~150 MB |
| stockpulse-finbert | stockpulse-finbert (L4T PyTorch) | 8000 | ~2-3 GB |

**pgAdmin wyłączony** na Jetsonie (oszczędność RAM). Dostęp do bazy: `make shell-db`.

Żeby go włączyć: `docker compose -f docker-compose.yml -f docker-compose.jetson.yml --profile pgadmin up -d pgadmin`

## Rozwiązywanie problemów

### Docker permission denied

```bash
sudo usermod -aG docker $USER
sudo reboot  # lub: newgrp docker
```

### FinBERT nie startuje / crash

```bash
make log S=finbert   # sprawdź logi
# Częste przyczyny:
# - Brak pamięci GPU → zmniejsz BATCH_SIZE w .env
# - Brak internetu → model nie może się pobrać z HuggingFace
```

### App się restartuje w pętli

```bash
make log S=app
# Częste przyczyny:
# - Postgres nie gotowy → poczekaj na healthcheck
# - Błąd w kodzie TypeScript → sprawdź logi kompilacji
```

### Jak sprawdzić GPU w Dockerze

```bash
docker run --rm --runtime nvidia nvcr.io/nvidia/l4t-base:r35.4.1 nvidia-smi
```
