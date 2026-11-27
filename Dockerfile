FROM node:20-alpine AS base
WORKDIR /app
COPY package.json ./
RUN npm install

FROM base AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM base AS gates
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY docs ./docs
COPY scripts ./scripts
COPY AGENTS.md CLAUDE.md GEMINI.md project-state.json ./
CMD ["sh", "-c", "node --import tsx src/db/migrate.ts && node --import tsx src/db/seed.ts && npm run typecheck && node scripts/verify-artifacts.mjs && npm test"]

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY src/db/migrations ./dist/db/migrations
COPY src/web ./dist/web
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && node dist/server.js"]
