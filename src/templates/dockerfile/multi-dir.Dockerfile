FROM node:{{NODE_VERSION}}-alpine AS builder

WORKDIR /app

{{#IF MIRROR_ALPINE}}
RUN sed -i 's/dl-cdn.alpinelinux.org/{{MIRROR_ALPINE}}/g' /etc/apk/repositories
{{/IF}}
{{#IF MIRROR_NPM}}
RUN echo "registry=https://{{MIRROR_NPM}}" > /root/.npmrc
{{/IF}}

# Copy all package.json files
COPY package*.json ./
COPY {{SERVER_DIR}}/package*.json ./{{SERVER_DIR}}/
COPY {{CLIENT_DIR}}/package*.json ./{{CLIENT_DIR}}/

{{#IF NEEDS_BUILD_TOOLS}}
RUN apk add --no-cache python3 make g++
{{/IF}}
RUN npm install

COPY . .
RUN {{BUILD_CMD}}

# Production stage
FROM node:{{NODE_VERSION}}-alpine AS production

WORKDIR /app

{{#IF MIRROR_ALPINE}}
RUN sed -i 's/dl-cdn.alpinelinux.org/{{MIRROR_ALPINE}}/g' /etc/apk/repositories
{{/IF}}
{{#IF MIRROR_NPM}}
RUN echo "registry=https://{{MIRROR_NPM}}" > /root/.npmrc
{{/IF}}

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/{{SERVER_DIR}}/package*.json ./{{SERVER_DIR}}/
{{#IF NEEDS_BUILD_TOOLS}}
RUN apk add --no-cache python3 make g++
{{/IF}}
RUN npm install --workspace={{SERVER_DIR}} --omit=dev && npm cache clean --force

COPY --from=builder /app/{{SERVER_DIR}}/dist ./{{SERVER_DIR}}/dist
COPY --from=builder /app/{{CLIENT_DIR}}/dist ./{{CLIENT_DIR}}/dist

EXPOSE {{APP_PORT}}

CMD [{{START_CMD_DOCKER}}]
