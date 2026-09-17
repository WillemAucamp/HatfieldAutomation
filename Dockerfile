# syntax=docker/dockerfile:1
# Host for n8n → HTTP → ingest + Melrose/Seriti load (unchanged Playwright path).
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV HEADLESS=true
ENV AUTO_LOAD=false
ENV TRIGGER_PORT=8788
ENV NODE_ENV=production

EXPOSE 8788

CMD ["npx", "tsx", "src/trigger/server.ts"]
