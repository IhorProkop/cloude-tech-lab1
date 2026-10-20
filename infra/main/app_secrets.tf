# Секрети застосунку: ключ підпису JWT і пароль входу генерує Terraform
# і зберігає одним JSON-секретом у Secrets Manager; ECS передає їх у контейнер як змінні.
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

  # Видаляти одразу, без періоду відновлення (типово 7–30 днів): інакше після destroy
  # секрет з тим самим ім'ям не вдасться створити знову до кінця цього періоду
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    JWT_SECRET    = random_password.jwt_secret.result
    AUTH_PASSWORD = random_password.auth_password.result
  })
}
