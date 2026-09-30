# API-Image. Gebaut von docker-compose.yml (direkt auf dem Server, passt
# automatisch zu dessen CPU) oder von deploy.sh (auf dem PC fuer den Pi):
#   docker buildx build --platform linux/arm64 -t whiteboard-api:latest .
# Dort ohne --platform entstuende ein x86-Image, das auf dem Pi mit
# "exec format error" abbricht.

FROM node:24-alpine

WORKDIR /app

# Erst die Abhaengigkeiten, das bleibt im Cache, solange package.json gleich bleibt.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src

# Welcher Stand steckt im Image? Kommt aus deploy.sh und steht spaeter in
# der App. Ohne das sieht man nicht, ob nur die Web-App ausgerollt wurde
# und der Server noch der alte ist.
ARG BAUSTAND=unknown
ENV BAUSTAND=$BAUSTAND

ENV NODE_ENV=production
ENV DATEN_VERZEICHNIS=/data
EXPOSE 3000

# Damit ein Absturz nicht als Zombie haengen bleibt.
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
