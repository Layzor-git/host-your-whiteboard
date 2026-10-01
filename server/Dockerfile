# API image. Built by docker-compose.yml (directly on the server, matches
# its CPU automatically) or by deploy.sh (on the PC, for the Pi):
#   docker buildx build --platform linux/arm64 -t whiteboard-api:latest .
# Without --platform that would produce an x86 image, which fails on the
# Pi with "exec format error".

FROM node:24-alpine

WORKDIR /app

# Dependencies first; this layer stays cached as long as package.json is unchanged.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src

# Which build is in the image? Comes from deploy.sh and is shown in the
# app. Without it you cannot tell whether only the web app was rolled out
# and the server is still the old one.
ARG BAUSTAND=unknown
ENV BAUSTAND=$BAUSTAND

ENV NODE_ENV=production
ENV DATEN_VERZEICHNIS=/data
EXPOSE 3000

# So a crashed process does not linger as a zombie.
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
