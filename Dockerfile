FROM oven/bun:1.2-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src/ src/
COPY tsconfig.json ./
COPY config.example.yaml config.yaml

# Credentials DB will be mounted at runtime
RUN mkdir -p /root/.ampcode-connector

ENV HOST=0.0.0.0

EXPOSE 7860

CMD ["bun", "run", "src/index.ts"]
