FROM node:20-bookworm-slim

# better-sqlite3 — нативный модуль, для сборки нужны компиляторы
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

# код бэкенда и статика фронта
COPY back/ ./back/
COPY front/ ./back/public/

ENV PORT=7703
EXPOSE 7703

CMD ["node", "back/server.js"]
