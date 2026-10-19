# Build stage: full Node image so better-sqlite3 can compile if no prebuilt binary matches.
FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

# Runtime stage: slim image with only production dependencies, the built client and the server.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Database location. On Railway, attach a Volume mounted at /data so the database persists
# across deploys; without one the app still runs and reseeds the demo data on each deploy.
ENV DC_DB=/data/dreamcoach.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
# The server listens on $PORT when the platform sets it (Railway does), else 3000.
EXPOSE 3000
CMD ["npm", "start"]
