FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY node_modules ./node_modules
COPY dist ./dist
COPY src/db/migrations ./dist/db/migrations
COPY src/web ./dist/web
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && node dist/server.js"]
