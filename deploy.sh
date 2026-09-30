#!/bin/bash
# Build on this PC, ship to a small ARM box (Raspberry Pi) over ssh.
# For building directly on the server use docker-compose.yml instead.
# Setup: deploy/README.md. Run in Git Bash on Windows.
#
#   ./deploy.sh          nur die Web-App (der Normalfall)
#   ./deploy.sh api      zusaetzlich den API-Container neu bauen und uebertragen
#
set -e

# Ziel steht in deploy.env (nicht im Repository), Vorlage: deploy.env.example
[ -f deploy.env ] && . ./deploy.env
HOST=${DEPLOY_HOST:?DEPLOY_HOST missing, copy deploy.env.example to deploy.env}
ZIEL=${DEPLOY_NAME:-whiteboard}
PLATTFORM=${DEPLOY_PLATFORM:-linux/arm64}

# Bewusst ohne fuehrende Tilde und ohne fuehrenden Schraegstrich.
#
# "FERN=~/apps/$ZIEL" sieht richtig aus, wird aber schon hier aufgeloest,
# und zwar zum Windows-Heimatverzeichnis: Der Pi bekaeme
# "mkdir -p /c/Users/.../apps/..." und antwortet
# "cannot create directory '/c': Permission denied". Ein Pfad mit
# fuehrendem Schraegstrich haette das naechste Problem, weil Git Bash ihn
# auf dem Weg nach draussen in einen Windows-Pfad umschreibt.
#
# Relativ geht beides nicht schief: ssh und scp starten im
# Heimatverzeichnis des Nutzers auf dem Pi.
FERN=apps/$ZIEL

echo "==> Web-App bauen"
cd web
npm run build
cd ..

echo "==> Web-App hochladen"
ssh $HOST "mkdir -p $FERN/www && rm -rf $FERN/www/*"
scp -r web/dist/* $HOST:$FERN/www/

if [ "$1" = "api" ]; then
  echo "==> API-Image bauen (arm64, ohne das gibt es 'exec format error')"
  # Derselbe Stempel wie in der Web-App, damit man beide vergleichen kann.
  # Alles auf einer Zeile: Ein Zeilenumbruch mit Rueckstrich wird beim
  # Bearbeiten unter Windows gern zu einem literalen \n, und docker sieht
  # dann ein Argument zu viel.
  BAUSTAND=$(sed -n 's/^VITE_BAUSTAND=//p' web/.env.production.local)
  docker buildx build --platform $PLATTFORM --build-arg BAUSTAND="$BAUSTAND" -t $ZIEL-api:latest --load server

  echo "==> Image uebertragen (dauert beim ersten Mal ein paar Minuten)"
  docker save $ZIEL-api:latest | gzip | ssh $HOST "gunzip | docker load"

  echo "==> Container neu erstellen"
  # down + up, nicht restart: Sonst greifen Aenderungen an Ports nicht.
  ssh $HOST "cd $FERN && docker compose down && docker compose up -d"

  echo "==> Protokoll der letzten Zeilen"
  ssh $HOST "cd $FERN && docker compose logs --tail 20 api"
fi

echo
echo "Fertig${DEPLOY_URL:+: $DEPLOY_URL}"
echo
echo "Am Handy kommt die neue Fassung an, sobald die App einmal im"
echo "Hintergrund war. Erzwingen: aus den letzten Apps wischen."
