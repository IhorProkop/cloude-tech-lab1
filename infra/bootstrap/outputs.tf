# Вихідні значення: ім'я бакета знадобиться для backend-блоку основної конфігурації.
output "state_bucket_name" {
  value = aws_s3_bucket.tfstate.bucket
}
