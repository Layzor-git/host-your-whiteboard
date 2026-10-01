#!/bin/bash
# Build on this PC, ship to a small ARM box (Raspberry Pi) over ssh.
# For building directly on the server use docker-compose.yml instead.
# Setup: deploy/README.md. Run in Git Bash on Windows.
#
#   ./deploy.sh          web app only (the usual case)
#   ./deploy.sh api      also rebuild and ship the API container
#
set -e

# Target lives in deploy.env (not in the repository), template: deploy.env.example
[ -f deploy.env ] && . ./deploy.env
HOST=${DEPLOY_HOST:?DEPLOY_HOST missing, copy deploy.env.example to deploy.env}
ZIEL=${DEPLOY_NAME:-whiteboard}
PLATTFORM=${DEPLOY_PLATFORM:-linux/arm64}

# Deliberately without a leading tilde and without a leading slash.
#
# "FERN=~/apps/$ZIEL" looks right, but is expanded right here, to the
# Windows home directory: the Pi would get
# "mkdir -p /c/Users/.../apps/..." and answer
# "cannot create directory '/c': Permission denied". A path with a
# leading slash has the next problem, because Git Bash rewrites it into
# a Windows path on its way out.
#
# A relative path avoids both: ssh and scp start in the user's home
# directory on the Pi.
FERN=apps/$ZIEL

echo "==> Building web app"
cd web
npm run build
cd ..

echo "==> Uploading web app"
ssh $HOST "mkdir -p $FERN/www && rm -rf $FERN/www/*"
scp -r web/dist/* $HOST:$FERN/www/

if [ "$1" = "api" ]; then
  echo "==> Building API image (arm64, otherwise 'exec format error')"
  # Same build stamp as in the web app, so the two can be compared.
  # All on one line: a backslash line continuation tends to turn into a
  # literal \n when edited on Windows, and docker then sees one argument
  # too many.
  BAUSTAND=$(sed -n 's/^VITE_BAUSTAND=//p' web/.env.production.local)
  docker buildx build --platform $PLATTFORM --build-arg BAUSTAND="$BAUSTAND" -t $ZIEL-api:latest --load server

  echo "==> Transferring image (takes a few minutes the first time)"
  docker save $ZIEL-api:latest | gzip | ssh $HOST "gunzip | docker load"

  echo "==> Recreating containers"
  # down + up, not restart: otherwise changes to ports do not take effect.
  ssh $HOST "cd $FERN && docker compose down && docker compose up -d"

  echo "==> Last log lines"
  ssh $HOST "cd $FERN && docker compose logs --tail 20 api"
fi

echo
echo "Done${DEPLOY_URL:+: $DEPLOY_URL}"
echo
echo "Phones pick up the new version once the app has been in the"
echo "background. To force it: swipe the app away from recent apps."
