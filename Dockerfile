# DoorVoice container: Node 20 + ffmpeg. `docker compose up` builds and serves on :3000.
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
# setup.mjs needs a .env at build time only to create the schema; real values come from env_file at runtime.
RUN touch .env && npx prisma db push --skip-generate && npx next build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx next start -p 3000"]
