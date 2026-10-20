# Tasks API

Простий REST API для списку задач на Node.js (Express) і PostgreSQL, запакований у Docker-контейнер.

## Ендпоінти

| Метод  | Шлях         | Опис                                   | Токен | Відповіді          |
|--------|--------------|----------------------------------------|-------|--------------------|
| GET    | `/`          | Назва і версія API                     |       | 200                |
| GET    | `/health`    | Стан застосунку і БД                   |       | 200, 503           |
| POST   | `/login`     | Отримати JWT `{"username","password"}` |       | 200, 401           |
| GET    | `/tasks`     | Список усіх задач                      |       | 200                |
| GET    | `/tasks/:id` | Одна задача                            |       | 200, 400, 404      |
| POST   | `/tasks`     | Створити задачу `{"title"}`            | так   | 201, 400, 401      |
| DELETE | `/tasks/:id` | Видалити задачу                        | так   | 204, 400, 401, 404 |
| GET    | `/docs`      | Документація (Swagger UI)              |       | 200                |

## Автентифікація

`POST /tasks` і `DELETE /tasks/:id` потребують JWT-токена (HS256, дійсний 1 годину), без нього — `401`.
Логін і пароль задаються змінними `AUTH_USER` / `AUTH_PASSWORD`, ключ підпису — `JWT_SECRET`
(локально — у `.env`; в AWS пароль і ключ генерує Terraform і зберігає в Secrets Manager,
пароль можна подивитися через `terraform output -raw auth_password`).

```bash
# 1. Отримати токен: відповідь {"token":"..."}
curl -X POST http://localhost:3000/login -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"change_me"}'

# 2. Передати його в заголовку Authorization
TOKEN=<значення token з відповіді>
curl -X POST http://localhost:3000/tasks -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"title":"Купити молоко"}'
curl -X DELETE http://localhost:3000/tasks/1 -H "Authorization: Bearer $TOKEN"
```

У Swagger UI (`/docs`) токен вводиться через кнопку **Authorize**.

## Локальний запуск

Потрібен Docker з Docker Compose.

```bash
cp .env.example .env        # за потреби змініть значення
docker compose up -d --build
curl http://localhost:3000/health
```

Приклад:

```bash
curl http://localhost:3000/tasks
```

Зупинка: `docker compose down` (дані зберігаються у volume `db-data`; `docker compose down -v` видаляє і їх).

## Публічна адреса

_Буде додано пізніше._

## Інфраструктура

_Буде додано пізніше._
