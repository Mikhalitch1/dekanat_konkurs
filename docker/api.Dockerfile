FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NODE_EXTRA_CA_CERTS=/app/docker/certs/russian-trusted-ca.pem
USER node
CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && npm run start:api"]
