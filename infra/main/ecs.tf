# ECS Fargate: кластер, опис задачі (контейнер застосунку) і сервіс,
# що тримає потрібну кількість задач за ALB у приватних підмережах.
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.project}"
  retention_in_days = 7
}

resource "aws_ecs_cluster" "main" {
  name = "${var.project}-cluster"
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${var.project}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  # Значення змінних оточення в ECS мають бути рядками, тому числа в лапках
  container_definitions = jsonencode([
    {
      name      = "app"
      image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 3000
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "PORT", value = "3000" },
        { name = "DB_HOST", value = aws_db_instance.main.address },
        { name = "DB_PORT", value = "5432" },
        { name = "DB_NAME", value = var.db_name },
        { name = "DB_USER", value = var.db_username },
        { name = "DB_SSL", value = "true" },
        { name = "AUTH_USER", value = var.auth_user }
      ]

      secrets = [
        {
          name = "DB_PASSWORD"
          # Суфікс :password:: бере з JSON-секрету RDS лише значення ключа password
          valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::"
        },
        {
          name      = "JWT_SECRET"
          valueFrom = "${aws_secretsmanager_secret.app.arn}:JWT_SECRET::"
        },
        {
          name      = "AUTH_PASSWORD"
          valueFrom = "${aws_secretsmanager_secret.app.arn}:AUTH_PASSWORD::"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "app"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "app" {
  name                              = "${var.project}-app"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.app.arn
  desired_count                     = var.desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60

  network_configuration {
    subnets          = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false # вихід в інтернет через NAT
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }

  # Якщо нові задачі не стають здоровими, деплой зупиняється і відкочується на попередню ревізію
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Нові ревізії task definition реєструє і деплоїть CI, тож Terraform їх не відкочує
  lifecycle {
    ignore_changes = [task_definition]
  }

  # Target group має бути прив'язана до ALB через listener до створення сервісу
  depends_on = [aws_lb_listener.http]
}
