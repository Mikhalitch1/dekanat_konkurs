#!/usr/bin/env bash
# Запуск «Цифрового деканата» локально одной командой: ./start.sh
# Нужен только Docker (Desktop или Engine с Compose v2). macOS, Linux, Windows через WSL или Git Bash.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
command -v docker >/dev/null 2>&1 || { echo "Не найден Docker. Установите Docker Desktop: https://www.docker.com/products/docker-desktop/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker не запущен. Откройте Docker Desktop и повторите ./start.sh"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Нужен Docker Compose v2 (команда 'docker compose')."; exit 1; }

rnd() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1" || true; }

# 1. Секреты: создаются один раз, лежат только в локальном файле .env (в git не попадает).
if [ ! -f .env ]; then
  say "Создаю .env со случайными секретами…"
  umask 077
  db="$(rnd 40)"
  cat > .env <<EOF
POSTGRES_PASSWORD=${db}
DATABASE_URL=postgres://dekanat:${db}@localhost:54329/dekanat
APP_ORIGIN=https://localhost:${HTTPS_PORT:-8443}
DEMO_PASSWORD_STUDENT_ARTEM=$(rnd 24)
DEMO_PASSWORD_STUDENT_LINA=$(rnd 24)
DEMO_PASSWORD_STAFF=$(rnd 24)
PII_KEY=$(head -c 32 /dev/urandom | base64)
EOF
fi
grep -q '^PII_KEY=' .env || echo "PII_KEY=$(head -c 32 /dev/urandom | base64)" >> .env
chmod 600 .env

# 2. Локальный самоподписанный сертификат для https://localhost.
mkdir -p .local/tls
if [ ! -f .local/tls/localhost.crt ]; then
  say "Создаю локальный сертификат…"
  SUBJ=(-subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1)
  if command -v openssl >/dev/null 2>&1; then
    openssl req -x509 -newkey rsa:2048 -nodes -keyout .local/tls/localhost.key -out .local/tls/localhost.crt -days 30 "${SUBJ[@]}" 2>/dev/null
  else
    docker run --rm -v "$PWD/.local/tls:/out" alpine:3.20 sh -c 'apk add --no-cache openssl >/dev/null && openssl req -x509 -newkey rsa:2048 -nodes -keyout /out/localhost.key -out /out/localhost.crt -days 30 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 2>/dev/null && chmod 644 /out/*'
  fi
  chmod 644 .local/tls/localhost.crt .local/tls/localhost.key 2>/dev/null || true
fi

# 3. Сборка и запуск (первый раз 3–6 минут).
say "Собираю и запускаю контейнеры…"
docker compose up --build -d

say "Жду, пока API станет готов…"
for _ in $(seq 1 90); do
  [ "$(docker compose ps api --format '{{.Health}}' 2>/dev/null)" = "healthy" ] && break
  sleep 2
done
if [ "$(docker compose ps api --format '{{.Health}}' 2>/dev/null)" != "healthy" ]; then
  echo "API не запустился. Логи: docker compose logs api"; exit 1
fi

get() { grep "^$1=" .env | cut -d= -f2-; }
PORT="${HTTPS_PORT:-8443}"
echo
say "Готово. Откройте: https://localhost:${PORT}"
echo "Браузер предупредит о сертификате (он самоподписанный, это нормально): «Дополнительно» → «Продолжить»."
echo
echo "Тестовые аккаунты (данные вымышлены):"
echo "  студент    student-artem   $(get DEMO_PASSWORD_STUDENT_ARTEM)"
echo "  студентка  student-lina    $(get DEMO_PASSWORD_STUDENT_LINA)"
echo "  сотрудник  staff-maria     $(get DEMO_PASSWORD_STAFF)"
echo
echo "Остановить: docker compose down      Остановить и стереть данные: docker compose down -v"
