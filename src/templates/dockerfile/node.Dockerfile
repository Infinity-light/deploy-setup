FROM node:{{NODE_VERSION}}-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY . .
RUN {{BUILD_CMD}}

FROM node:{{NODE_VERSION}}-alpine AS production

WORKDIR /app

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE {{APP_PORT}}

CMD [{{START_CMD_DOCKER}}]
