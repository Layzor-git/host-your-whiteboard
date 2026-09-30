# Web-App: im ersten Schritt bauen, dann nur das Ergebnis mit Caddy ausliefern.
# Gebaut wird vom Wurzelverzeichnis aus (siehe docker-compose.yml), weil die
# Pruefung der Uebersetzungen die Fehlercodes des Servers mitliest.

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
