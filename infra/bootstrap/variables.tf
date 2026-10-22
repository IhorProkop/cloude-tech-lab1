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
