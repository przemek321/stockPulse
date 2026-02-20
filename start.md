# Start (z rebuild po zmianach kodu)
docker compose up -d --build

# Stop (kontenery zatrzymane, dane zachowane)
docker compose down

# Restart jednego kontenera
docker compose restart app

# Logi na żywo (Ctrl+C żeby wyjść)
docker compose logs -f app

# Status
docker compose ps