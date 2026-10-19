# Вхідні змінні bootstrap-конфігурації.
# alert_email задається в terraform.tfvars (див. terraform.tfvars.example).
variable "region" {
  description = "AWS-регіон"
  type        = string
  default     = "eu-central-1"
}

variable "alert_email" {
  description = "Email для сповіщень бюджету"
  type        = string
}

variable "budget_limit_usd" {
  description = "Місячний ліміт бюджету в USD"
  type        = number
  default     = 10
}
