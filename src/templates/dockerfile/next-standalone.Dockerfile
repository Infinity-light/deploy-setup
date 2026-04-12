FROM node:{{NODE_VERSION}}-alpine AS builder

WORKDIR /app

{{#IF MIRROR_ALPINE}}
RUN sed -i 's/dl-cdn.alpinelinux.org/{{MIRROR_ALPINE}}/g' /etc/apk/repositories
{{/IF}}
{{#IF MIRROR_NPM}}
RUN echo "registry=https://{{MIRROR_NPM}}" > /root/.npmrc
{{/IF}}

COPY package*.json .npmrc* ./
COPY . .
RUN mkdir -p public
{{#IF NEEDS_BUILD_TOOLS}}
RUN apk add --no-cache python3 make g++
{{/IF}}
RUN npm ci && npm cache clean --force
RUN npm run build

FROM node:{{NODE_VERSION}}-alpine AS runner

WORKDIR /app

{{#IF MIRROR_ALPINE}}
RUN sed -i 's/dl-cdn.alpinelinux.org/{{MIRROR_ALPINE}}/g' /etc/apk/repositories
{{/IF}}

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE {{APP_PORT}}

CMD ["node", "server.js"]
