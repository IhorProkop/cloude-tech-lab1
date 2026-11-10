resource "aws_service_discovery_private_dns_namespace" "main" {
  name = "${var.project}.local"
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "redis" {
  name = "redis"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.main.id
    routing_policy = "MULTIVALUE"

    dns_records {
      type = "A"
      ttl  = 10
    }
  }
}

resource "aws_cloudwatch_log_group" "redis" {
  name              = "/ecs/${var.project}-redis"
  retention_in_days = 7
}

resource "aws_ecs_task_definition" "redis" {
  family                   = "${var.project}-redis"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([
    {
      name      = "redis"
      image     = "public.ecr.aws/docker/library/redis:${var.redis_image_tag}"
      essential = true
      command = [
        "redis-server",
        "--save", "",
        "--appendonly", "no",
        "--maxmemory", "256mb",
        "--maxmemory-policy", "allkeys-lru"
      ]

      portMappings = [
        {
          containerPort = 6379
          protocol      = "tcp"
        }
      ]

      healthCheck = {
        command     = ["CMD", "redis-cli", "ping"]
        interval    = 10
        timeout     = 3
        retries     = 3
        startPeriod = 5
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.redis.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "redis"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "redis" {
  name                               = "${var.project}-redis"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.redis.arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  network_configuration {
    subnets          = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_groups  = [aws_security_group.redis.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.redis.arn
  }
}
