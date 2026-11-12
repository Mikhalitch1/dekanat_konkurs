# Этап 1. Каркас, БД, безопасность
Цель: рабочий монорепозиторий, Docker Compose, БД, аутентификация и защита данных.
Задачи:
1. Структура apps/web и apps/api, общие скрипты, lint, typecheck, Vitest.
2. docker-compose.yml: api, web, postgres, nginx. .env.example, .gitignore.
3. Миграции по docs/DATA.md и сидер вымышленных данных (2 студента, 1 сотрудник, относительные даты).
4. Вход, выход, сессия в httpOnly cookie, argon2id, rate limit, CSRF, helmet.
5. Middleware авторизации: user из сессии, роли, 404 на чужие ресурсы.
6. Тесты безопасности из docs/SECURITY.md (пп. 1–4, 6).
Приёмка: npm run dev поднимает всё локально; логин двумя студентами работает; тесты зелёные; PROGRESS обновлён; коммит «stage 1».
