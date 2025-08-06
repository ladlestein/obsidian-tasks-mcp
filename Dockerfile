################   builder   ################
FROM node:22.12-alpine AS builder
WORKDIR /app
# Copy all source files, package.json, lockfile, etc., into /app inside the container.
# This ensures npm ci sees the correct dependency list and build can compile all code.
COPY . /app
RUN npm ci
RUN npm run build   # compiles src/** to dist/**

################   runtime   ################
FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini syncthing
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package*.json /app/
RUN npm ci --omit=dev --ignore-scripts   # installs fastify + uuid

ENV NODE_ENV=production \
    PORT=8080

RUN adduser -D -u 10001 appuser && chown -R appuser /app
USER appuser

VOLUME ["/data"]
EXPOSE 8080

# Start Syncthing, then the HTTP proxy (which spawns the MCP CLI)
ENTRYPOINT ["/sbin/tini","--","sh","-c", \
  "syncthing -no-browser -home /data/syncthing & \
   node /app/dist/http-proxy.js" ]
