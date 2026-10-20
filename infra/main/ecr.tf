# ECR-репозиторій для Docker-образу застосунку.
# IMMUTABLE забороняє перезаписати вже завантажений тег образу.
resource "aws_ecr_repository" "app" {
  name                 = "${var.project}-app"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true # дозволяє terraform destroy навіть якщо в репозиторії є образи
}
