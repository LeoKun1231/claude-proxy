# 构建前端静态资源
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 运行 Web 服务 + 代理服务
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV WEB_PORT=5056
ENV PROXY_PORT=5055
ENV AUTO_START_PROXY=true
ENV DATA_DIR=/app/data
ENV REWRITE_LOCALHOST_FOR_DOCKER=true
ENV DOCKER_HOST_ALIAS=host.docker.internal

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY server ./server

RUN mkdir -p /app/data

EXPOSE 5056 5055

CMD ["node", "server/index.js"]
