# Версії Terraform і провайдера AWS.
# State цієї конфігурації — локальний (backend-блоку немає навмисно).
terraform {
  required_version = ">= 1.16.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
