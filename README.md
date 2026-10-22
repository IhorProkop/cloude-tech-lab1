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
      auth.js
      db.js
      openapi.json
  infra/
    bootstrap/                   S3-бакет для state і бюджет, створюється один раз
    main/                        мережа, ALB, ECS, RDS, ECR, секрети і моніторинг
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
