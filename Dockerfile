FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV DC_PORT=3000 DC_DB=/data/dreamcoach.db
VOLUME ["/data"]
EXPOSE 3000
CMD ["npm", "start"]
