FROM node:{{NODE_VERSION}}-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY . .
RUN mkdir -p public
RUN npm ci && npm cache clean --force
RUN npm run build

FROM node:{{NODE_VERSION}}-alpine AS runner

WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE {{APP_PORT}}

CMD ["node", "server.js"]
