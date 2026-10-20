# Security groups: ланцюжок доступу інтернет -> ALB -> застосунок -> база.
# Кожен рівень приймає трафік лише від попереднього.
# description у SG AWS приймає лише ASCII, тому він англійською.
resource "aws_security_group" "alb" {
  name        = "${var.project}-alb-sg"
  description = "ALB: HTTP from the internet"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1" # усі протоколи
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project}-alb-sg"
  }
}

resource "aws_security_group" "app" {
  name        = "${var.project}-app-sg"
  description = "App (ECS tasks): port 3000 from ALB only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "App port from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Вихід потрібен для ECR, Secrets Manager, CloudWatch (через NAT) і для бази
  egress {
    description = "All outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project}-app-sg"
  }
}

resource "aws_security_group" "db" {
  name        = "${var.project}-db-sg"
  description = "RDS PostgreSQL: port 5432 from app only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from app"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  # Egress-правил немає: SG stateful, тож відповіді на вхідні з'єднання пропускаються автоматично.
  # Terraform при створенні SG прибирає дефолтне правило AWS "allow all egress".

  tags = {
    Name = "${var.project}-db-sg"
  }
}
