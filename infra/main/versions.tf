terraform {
  required_version = ">= 1.16.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  backend "s3" {
    bucket       = "cloude-tech-lab1-tfstate-018724217872"
    key          = "main/terraform.tfstate"
    region       = "eu-central-1"
    use_lockfile = true
  }
}
