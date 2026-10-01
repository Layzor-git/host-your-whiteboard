# Web app: build in the first stage, then serve only the result with Caddy.
# The build context is the repository root (see docker-compose.yml), because
# the translation check also reads the server's error codes.

FROM node:24-alpine AS bau
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
COPY server/src/fehler.js /app/server/src/fehler.js
RUN npm run build

FROM caddy:2-alpine
COPY web/Caddyfile /etc/caddy/Caddyfile
COPY --from=bau /app/web/dist /srv
