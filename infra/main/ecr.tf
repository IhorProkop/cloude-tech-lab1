resource "aws_ecr_repository" "app" {
  name                 = "${var.project}-app"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
}
