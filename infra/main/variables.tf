# Вхідні змінні основної конфігурації.
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
