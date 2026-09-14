# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx playwright install chromium

ENV HEADLESS=true
ENV PRODUCT_PORT=8787
ENV NODE_ENV=production

EXPOSE 8787

CMD ["npx", "tsx", "src/product/server.ts"]
