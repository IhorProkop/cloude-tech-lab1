# Образ застосунку: Node.js LTS (зафіксована версія) на Debian bookworm-slim.
FROM node:24.22.0-bookworm-slim

WORKDIR /app

# Спершу лише файли залежностей — цей шар кешується, поки вони не змінились
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

# Запускаємо процес не від root
USER node

EXPOSE 3000
CMD ["node", "src/index.js"]
