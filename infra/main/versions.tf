# Версії Terraform і провайдера AWS.
# State зберігається в S3-бакеті, створеному в infra/bootstrap.
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
    use_lockfile = true # блокування state через lock-файл у самому S3, без DynamoDB
  }
}
