# Application Load Balancer у публічних підмережах: приймає HTTP на порту 80
# і розподіляє запити між ECS-задачами в приватних підмережах.
resource "aws_lb" "main" {
  name               = "${var.project}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]

  tags = {
    Name = "${var.project}-alb"
  }
}

# target_type "ip", бо задачі Fargate в режимі awsvpc мають власні IP, а не EC2-інстанси
resource "aws_lb_target_group" "app" {
  name        = "${var.project}-app-tg"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 10 # секунд; менше за дефолтні 300, щоб деплой був швидшим

  tags = {
    Name = "${var.project}-app-tg"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
