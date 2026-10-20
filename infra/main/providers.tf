# Провайдер AWS: регіон і теги, що автоматично додаються до всіх ресурсів.
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}
