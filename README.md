# Tasks API

REST API для списку задач на Node.js (Express) з базою PostgreSQL. Застосунок зібраний у Docker-образ
і розгорнутий в AWS (ECS Fargate за Application Load Balancer, RDS PostgreSQL). Уся інфраструктура
описана в Terraform, а новий код деплоїться автоматично через GitHub Actions.

## Публічна адреса

- API: http://cloude-tech-lab1-alb-397340860.eu-central-1.elb.amazonaws.com
- Swagger UI: http://cloude-tech-lab1-alb-397340860.eu-central-1.elb.amazonaws.com/docs

Примітка: після захисту лаби ресурси в AWS видаляються, і адреса перестане працювати.

## Архітектура

```
                   Інтернет
                      |
                      | HTTP :80
+---------------------|--------------------------------- VPC 10.0.0.0/16 --+
|                     v                                                    |
|  Публічні підмережі (2 AZ)                                               |
|   +----------------+                +-------------+                      |
|   | ALB            |                | NAT Gateway |----> Інтернет        |
|   +----------------+                +-------------+                      |
|           | :3000                         ^                              |
|           v                               |                              |
|  Приватні підмережі (2 AZ)                |                              |
|   +-------------------------+             |                              |
|   | ECS Fargate, 2 задачі   |-------------+  ECR, Secrets Manager,       |
|   +-------------------------+                CloudWatch                  |
|           | :5432                                                        |
|           v                                                              |
|   +-------------------------+                                            |
|   | RDS PostgreSQL          |                                            |
|   +-------------------------+                                            |
+--------------------------------------------------------------------------+

Поза VPC: ECR (образи), Secrets Manager (секрети), CloudWatch (логи, метрики, алярми) -> SNS -> email
```

Запити з інтернету приходять на ALB у публічних підмережах, і він розподіляє їх між двома ECS-задачами
у приватних підмережах. Задачі й база не мають публічних IP: security groups пропускають трафік лише
ланцюжком ALB -> застосунок -> база. Вихід в інтернет із приватних підмереж (тягнути образ з ECR, читати
секрети, писати логи) іде через один NAT Gateway. Паролі не зберігаються в коді: пароль бази генерує RDS,
JWT-ключ і пароль входу генерує Terraform, і все це лежить у Secrets Manager.

## Структура проєкту

```
.
|-- .env.example                  змінні для локального запуску (скопіювати в .env)
|-- .gitignore                    що не комітиться: node_modules, .env, *.tfvars, state
|-- compose.yaml                  локальний запуск: застосунок + PostgreSQL
|-- README.md                     цей файл
|-- .github/workflows/
|   `-- deploy.yml                CI/CD: збірка образу, push в ECR, деплой в ECS
|-- app/
|   |-- .dockerignore             що не потрапляє в Docker-образ
|   |-- Dockerfile                образ на node:24 (bookworm-slim), процес не від root
|   |-- package.json              залежності: express, pg, jsonwebtoken, swagger-ui-express
|   |-- package-lock.json         зафіксовані версії залежностей
|   `-- src/
|       |-- index.js              точка входу: Express, /, /health, /login, /docs, запуск сервера
|       |-- routes.js             ендпоінти /tasks (GET, POST, DELETE)
|       |-- auth.js               видача JWT (POST /login) і перевірка токена (requireAuth)
|       |-- db.js                 пул з'єднань з PostgreSQL і створення таблиці tasks
|       `-- openapi.json          специфікація OpenAPI для Swagger UI
`-- infra/
    |-- bootstrap/                створюється один раз, state локальний
    |   |-- versions.tf           версії Terraform і провайдера AWS
    |   |-- providers.tf          провайдер AWS і спільні теги
    |   |-- variables.tf          регіон, email для бюджету, ліміт бюджету
    |   |-- state_bucket.tf       S3-бакет для state основної конфігурації
    |   |-- budget.tf             місячний бюджет зі сповіщеннями на email
    |   |-- outputs.tf            ім'я бакета для state
    |   |-- terraform.tfvars.example   приклад terraform.tfvars
    |   `-- .terraform.lock.hcl   зафіксовані версії провайдерів
    `-- main/                     основна інфраструктура, state у S3
        |-- versions.tf           версії Terraform, провайдерів AWS і random, backend S3
        |-- providers.tf          провайдер AWS і спільні теги
        |-- variables.tf          вхідні змінні (регіон, AZ, БД, тег образу, email тощо)
        |-- network.tf            VPC, 2 публічні і 2 приватні підмережі, IGW, NAT, маршрути
        |-- security_groups.tf    SG для ALB, застосунку і бази
        |-- ecr.tf                репозиторій образів (незмінні теги)
        |-- database.tf           RDS PostgreSQL 17 у приватних підмережах
        |-- app_secrets.tf        JWT-ключ і пароль входу в Secrets Manager
        |-- iam.tf                роль виконання ECS і доступ до двох секретів
        |-- alb.tf                ALB, target group з health check /health, listener :80
        |-- ecs.tf                кластер, task definition, сервіс з автовідкатом, логи
        |-- github_oidc.tf        OIDC-провайдер GitHub і роль для деплою
        |-- monitoring.tf         SNS-топік, два алярми і дашборд CloudWatch
        |-- outputs.tf            адреса застосунку і дашборду, ARN-и, пароль входу
        |-- terraform.tfvars.example   приклад terraform.tfvars
        `-- .terraform.lock.hcl   зафіксовані версії провайдерів
```

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

### Автентифікація

`POST /tasks` і `DELETE /tasks/:id` потребують JWT-токена (HS256, дійсний 1 годину), без нього
відповідь `401`. Логін і пароль задаються змінними `AUTH_USER` / `AUTH_PASSWORD`, ключ підпису `JWT_SECRET`.
Локально вони беруться з `.env`. В AWS пароль і ключ генерує Terraform і зберігає в Secrets Manager,
пароль можна подивитися командою `terraform output -raw auth_password` в `infra/main`.

```bash
# 1. Отримати токен: відповідь {"token":"..."}
curl -X POST http://localhost:3000/login -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<пароль>"}'

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

Зупинка: `docker compose down` (дані бази лишаються у volume `db-data`; `docker compose down -v` видаляє і їх).

## Розгортання з нуля

Потрібні Terraform >= 1.16 і AWS CLI з доступом до акаунта. Якщо акаунт або репозиторій інші,
спершу оновіть ім'я бакета в `infra/main/versions.tf`, `AWS_ROLE_ARN` у `deploy.yml`
і `github_repo` в `infra/main/variables.tf`.

1. **Bootstrap** (S3-бакет для state і бюджет):
   ```bash
   cd infra/bootstrap
   cp terraform.tfvars.example terraform.tfvars   # вписати свій alert_email
   terraform init
   terraform apply
   ```
2. **Основна інфраструктура:**
   ```bash
   cd infra/main
   cp terraform.tfvars.example terraform.tfvars   # вписати свій alert_email
   terraform init
   terraform apply
   ```
3. **Перший образ:** ECR після створення порожній, тому в GitHub треба відкрити Actions -> Deploy to ECS ->
   Run workflow. Workflow збере образ, запушить його і задеплоїть в ECS.
4. **Підписка на алярми:** AWS надішле на `alert_email` лист від SNS, підписку треба підтвердити за посиланням.

Адреса застосунку: `terraform output app_url`. Пароль для `/login` (користувач `admin`):
`terraform output -raw auth_password`.

## CI/CD

Workflow `.github/workflows/deploy.yml` запускається при push у `main`, якщо змінилось щось в `app/`
або сам workflow, а також вручну (Run workflow). Кроки:

1. Checkout коду.
2. Вхід в AWS через OIDC: GitHub видає короткоживучий токен, AWS обмінює його на тимчасові креденшели
   ролі `github-actions`. Ключі доступу ніде не зберігаються. Роль може взяти лише workflow з гілки `main`
   цього репозиторію, а права в неї лише на push в ECR і оновлення ECS-сервісу.
3. Логін в ECR.
4. Збірка образу і push з тегом, що дорівнює хешу коміту (`github.sha`). Теги в ECR незмінні, тож кожен
   образ однозначно відповідає коміту.
5. Завантаження поточної task definition і заміна в ній образу на новий.
6. Реєстрація нової ревізії task definition і оновлення сервісу з очікуванням, поки він стане стабільним.

Відкат: у сервісі увімкнений deployment circuit breaker. Якщо нові задачі не проходять health check,
ECS сам повертає попередню ревізію. Вручну відкотитись можна, вказавши сервісу попередню ревізію
task definition (образ попереднього коміту лишається в ECR).

## Моніторинг

- **Дашборд CloudWatch** (`terraform output dashboard_url`): кількість запитів, помилки 5xx, затримка
  (середня і p95), CPU і пам'ять ECS-сервісу.
- **Алярм `alb-5xx`:** хоча б одна відповідь 5xx від застосунку за хвилину.
- **Алярм `unhealthy-targets`:** хоча б одна задача не проходить health check дві хвилини поспіль.
- Обидва алярми надсилають лист через SNS на `alert_email`, коли спрацьовують і коли повертаються в норму.
- Логи контейнерів пишуться в CloudWatch Logs (група `/ecs/cloude-tech-lab1`, зберігаються 7 днів).

## Видалення

Спершу основна інфраструктура, бо її state лежить у бакеті з bootstrap:

```bash
cd infra/main && terraform destroy
cd ../bootstrap && terraform destroy
```

## Відповідність завданням лаби

| Завдання                                        | Де реалізовано |
|-------------------------------------------------|----------------|
| 1. Застосунок у контейнері (2 б.)               | `app/Dockerfile`, `app/src/*`, `compose.yaml`, `.env.example` |
| 2. Розгортання в хмарі через Terraform (3 б.)   | `infra/bootstrap/*` (state у S3, бюджет), `infra/main/*`: `ecr.tf`, `database.tf`, `ecs.tf`, `iam.tf` |
| 3. Мережева ізоляція (2 б.)                     | `infra/main/network.tf` (публічні і приватні підмережі, NAT), `security_groups.tf`, `ecs.tf` і `database.tf` (без публічних IP) |
| 4. Load balancer (1 б.)                         | `infra/main/alb.tf`, блок `load_balancer` в `ecs.tf` |
| 5. Continuous deployment з GitHub (2 б.)        | `.github/workflows/deploy.yml`, `infra/main/github_oidc.tf` |
| 6. Бонус: Безпека доступу - JWT (2 б.)          | `app/src/auth.js`, `routes.js`, `index.js` (`/login`), `infra/main/app_secrets.tf`, `ecs.tf`, `iam.tf` |
| 7. Бонус: Моніторинг (2 б.)                     | `infra/main/monitoring.tf`, лог-група в `ecs.tf` |
| 8. Бонус: Документація API (1 б.)               | `app/src/openapi.json`, `index.js` (`/docs`) |
