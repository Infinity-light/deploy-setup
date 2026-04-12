FROM node:{{NODE_VERSION}}-alpine AS builder

WORKDIR /app

{{#IF MIRROR_ALPINE}}
RUN sed -i 's/dl-cdn.alpinelinux.org/{{MIRROR_ALPINE}}/g' /etc/apk/repositories
{{/IF}}
{{#IF MIRROR_NPM}}
RUN echo "registry=https://{{MIRROR_NPM}}" > /root/.npmrc
{{/IF}}

COPY package*.json .npmrc* ./
{{#IF NEEDS_BUILD_TOOLS}}
RUN apk add --no-cache python3 make g++
{{/IF}}
RUN npm ci && npm cache clean --force

COPY . .
RUN {{BUILD_CMD}}

FROM node:{{NODE_VERSION}}-alpine AS production

WORKDIR /app

{{#IF MIRROR_ALPINE}}
RUN sed -i 's/dl-cdn.alpinelinux.org/{{MIRROR_ALPINE}}/g' /etc/apk/repositories
{{/IF}}
{{#IF MIRROR_NPM}}
RUN echo "registry=https://{{MIRROR_NPM}}" > /root/.npmrc
{{/IF}}

COPY --from=builder /app/package*.json ./
{{#IF NEEDS_BUILD_TOOLS}}
RUN apk add --no-cache python3 make g++
{{/IF}}
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE {{APP_PORT}}

CMD [{{START_CMD_DOCKER}}]
