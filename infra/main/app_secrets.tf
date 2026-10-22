resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "random_password" "auth_password" {
  length  = 20
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name = "${var.project}-app-secrets"

  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    JWT_SECRET    = random_password.jwt_secret.result
    AUTH_PASSWORD = random_password.auth_password.result
  })
}
