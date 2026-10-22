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
  description = "Кількість ECS-задач застосунку"
  type        = number
  default     = 2
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
