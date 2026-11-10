# Tasks API

Лабораторна робота 1 з хмарних технологій. Це простий REST API для списку задач на Node.js (Express)
з базою PostgreSQL. Застосунок зібраний у Docker-образ і працює в AWS на ECS Fargate за балансувальником,
інфраструктура описана в Terraform, а деплой нової версії робить GitHub Actions.

## Адреса

- API: http://cloude-tech-lab1-alb-397340860.eu-central-1.elb.amazonaws.com
- Swagger UI: http://cloude-tech-lab1-alb-397340860.eu-central-1.elb.amazonaws.com/docs

## Структура проєкту

```
.
  .env.example
  compose.yaml
  .github/workflows/deploy.yml   збірка образу і деплой в ECS
  app/                           код застосунку і Dockerfile
    Dockerfile
    package.json
    src/
      index.js
      routes.js
      authors.js
      cache.js
      auth.js
      db.js
      openapi.json
  infra/
    bootstrap/                   S3-бакет для state і бюджет, створюється один раз
    main/                        мережа, ALB, ECS, автомасштабування, Redis, RDS, ECR, секрети і моніторинг
  loadtest/                      сценарій k6, run.ps1 і результати прогонів
  docs/                          звіти лабораторної роботи 2 і знімки графіків
```

## Локальний запуск

```bash
cp .env.example .env
docker compose up -d --build
curl http://localhost:3000/health
docker compose down
```

## Розгортання в AWS

Потрібні Terraform, AWS CLI і GitHub CLI. У terraform.tfvars треба вписати свою пошту для сповіщень.

```bash
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply

cd ../main
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply

gh workflow run deploy.yml
terraform output app_url
```

Після першого apply ECR порожній, тому workflow треба один раз запустити вручну, далі він іде сам при push у main.

## Токен для POST і DELETE

POST /tasks і DELETE /tasks/:id працюють лише з JWT-токеном. Пароль для входу в AWS можна подивитися
в infra/main, локально логін і пароль беруться з .env.

```bash
terraform output -raw auth_password
curl -X POST http://localhost:3000/login -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<пароль>"}'

TOKEN=<токен з відповіді>
curl -X POST http://localhost:3000/tasks -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"title":"Купити молоко"}'
curl -X DELETE http://localhost:3000/tasks/1 -H "Authorization: Bearer $TOKEN"
```

У Swagger UI токен вводиться через кнопку Authorize.

## Лабораторна робота 2

Автомасштабування, моніторинг, сповіщення і кешування. Стан після лабораторної роботи 1 позначено тегом `lab1`.

- [docs/AUTOSCALING.md](docs/AUTOSCALING.md) - політика масштабування за CPU (1-4 задачі, ціль 60%), cooldown, знімки
  панелі під час навантаження;
- [docs/LOADTEST.md](docs/LOADTEST.md) - сценарій k6 і результати двох прогонів;
- [docs/ALERTS.md](docs/ALERTS.md) - alarm «CPU > 70% протягом 2 хв» з листами на email, час реакції;
- [docs/CACHE.md](docs/CACHE.md) - cache-aside для `GET /tasks` на Redis, порівняння без кешу і з кешем;
- [loadtest/](loadtest/README.md) - сценарій навантаження, запуск однією командою:

```powershell
.\loadtest\run.ps1 -Vus 300 -RunName my-run
```

Нове в застосунку: `GET /tasks` повертає останні 50 задач і заголовок `X-Cache`, `GET /authors/:username` -
кількість задач автора і час останньої, коректне завершення за SIGTERM. Кеш вмикається змінною Terraform
`cache_enabled` (за замовчуванням `false`).
