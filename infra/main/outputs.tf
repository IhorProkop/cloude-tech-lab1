# Вихідні значення: знадобляться для наступних етапів (ECS, ALB, RDS) і для docker push.
output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = [aws_subnet.public_a.id, aws_subnet.public_b.id]
}

output "private_subnet_ids" {
  value = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}
