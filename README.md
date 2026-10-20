# Tasks API

Простий REST API для списку задач на Node.js (Express) і PostgreSQL, запакований у Docker-контейнер.

## Ендпоінти

| Метод  | Шлях         | Опис                         | Відповіді     |
|--------|--------------|------------------------------|---------------|
| GET    | `/`          | Назва і версія API           | 200           |
| GET    | `/health`    | Стан застосунку і БД         | 200, 503      |
| GET    | `/tasks`     | Список усіх задач            | 200           |
| GET    | `/tasks/:id` | Одна задача                  | 200, 400, 404 |
| POST   | `/tasks`     | Створити задачу `{"title"}`  | 201, 400      |
| DELETE | `/tasks/:id` | Видалити задачу              | 204, 400, 404 |
| GET    | `/docs`      | Документація (Swagger UI)    | 200           |

## Локальний запуск

Потрібен Docker з Docker Compose.

```bash
cp .env.example .env        # за потреби змініть значення
docker compose up -d --build
curl http://localhost:3000/health
```

Приклад:

```bash
curl -X POST http://localhost:3000/tasks -H "Content-Type: application/json" -d '{"title":"Купити молоко"}'
curl http://localhost:3000/tasks
```

Зупинка: `docker compose down` (дані зберігаються у volume `db-data`; `docker compose down -v` видаляє і їх).

## Публічна адреса

_Буде додано пізніше._

## Інфраструктура

_Буде додано пізніше._
