variable "region" {
  description = "AWS-регіон"
  type        = string
  default     = "eu-central-1"
}

variable "project" {
  description = "Назва проєкту, використовується в іменах ресурсів"
  type        = string
  default     = "cloude-tech-lab1"
}

variable "az_a" {
  description = "Перша зона доступності"
  type        = string
  default     = "eu-central-1a"
}

variable "az_b" {
  description = "Друга зона доступності"
  type        = string
  default     = "eu-central-1b"
}

variable "db_name" {
  description = "Назва бази даних у RDS"
  type        = string
  default     = "tasks"
}

variable "db_username" {
  description = "Ім'я головного користувача RDS (пароль генерує AWS)"
  type        = string
  default     = "tasks_admin"
}

variable "auth_user" {
  description = "Логін для POST /login (пароль генерує Terraform)"
  type        = string
  default     = "admin"
}

variable "image_tag" {
  description = "Тег Docker-образу застосунку в ECR (SHA коміту)"
  type        = string
  default     = "d23d0d8ed2e75b49793671f951d55d0d29a8a6e8"
}

variable "desired_count" {
  description = "Початкова кількість ECS-задач застосунку (далі нею керує автомасштабування)"
  type        = number
  default     = 1
}

variable "autoscaling_min_capacity" {
  description = "Мінімальна кількість задач застосунку"
  type        = number
  default     = 1
}

variable "autoscaling_max_capacity" {
  description = "Максимальна кількість задач застосунку"
  type        = number
  default     = 4

  validation {
    condition     = var.autoscaling_max_capacity <= 4
    error_message = "За умовою лабораторної максимум не більше 4 задач."
  }
}

variable "autoscaling_cpu_target" {
  description = "Цільове середнє завантаження CPU сервісу, %"
  type        = number
  default     = 60
}

variable "autoscaling_scale_out_cooldown" {
  description = "Період стабілізації після додавання задач, с"
  type        = number
  default     = 60
}

variable "autoscaling_scale_in_cooldown" {
  description = "Період стабілізації після вилучення задач, с"
  type        = number
  default     = 300
}

variable "schedule_timezone" {
  description = "Часовий пояс для розкладу мінімальної кількості задач (IANA)"
  type        = string
  default     = "Europe/Kyiv"
}

variable "schedule_day_cron" {
  description = "Коли починається денний режим: cron Application Auto Scaling у schedule_timezone"
  type        = string
  default     = "cron(0 8 * * ? *)"
}

variable "schedule_night_cron" {
  description = "Коли починається нічний режим: cron Application Auto Scaling у schedule_timezone"
  type        = string
  default     = "cron(0 22 * * ? *)"
}

variable "schedule_day_min_capacity" {
  description = "Мінімальна кількість задач застосунку вдень"
  type        = number
  default     = 2

  validation {
    condition     = var.schedule_day_min_capacity >= 1 && var.schedule_day_min_capacity <= var.autoscaling_max_capacity
    error_message = "Денний мінімум має бути від 1 до autoscaling_max_capacity."
  }
}

variable "schedule_night_min_capacity" {
  description = "Мінімальна кількість задач застосунку вночі"
  type        = number
  default     = 1

  validation {
    condition     = var.schedule_night_min_capacity >= 1 && var.schedule_night_min_capacity <= var.autoscaling_max_capacity
    error_message = "Нічний мінімум має бути від 1 до autoscaling_max_capacity: ECS за ALB не запускає задачу на запит, без задачі ALB відповідає 503."
  }
}

variable "redis_image_tag" {
  description = "Тег образу Redis з public.ecr.aws/docker/library/redis"
  type        = string
  default     = "8.10.3-alpine"
}

variable "cache_enabled" {
  description = "Чи використовує застосунок Redis-кеш для GET /tasks і GET /authors/:username"
  type        = bool
  default     = false
}

variable "author_cache_ttl_seconds" {
  description = "TTL кешу GET /authors/:username у Redis, с (без інвалідації на POST/DELETE)"
  type        = number
  default     = 5

  validation {
    condition     = var.author_cache_ttl_seconds >= 1 && floor(var.author_cache_ttl_seconds) == var.author_cache_ttl_seconds
    error_message = "TTL має бути цілим числом секунд, не менше 1."
  }
}

variable "github_repo" {
  description = "GitHub-репозиторій (owner@id/name@id), якому дозволено деплой через OIDC"
  type        = string
  default     = "IhorProkop@174109475/cloude-tech-lab1@1425948594"
}

variable "alert_email" {
  description = "Email для сповіщень CloudWatch-алярмів (через SNS)"
  type        = string
}
