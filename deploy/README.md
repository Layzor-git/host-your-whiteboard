# Build on a PC, run on a small server

`docker compose up -d --build` builds on the server itself. On a Raspberry Pi 3
that is slow. `deploy.sh` builds on your PC instead and ships the results over
ssh:

- the web app as static files into `~/apps/<name>/www`
- the API as a finished ARM image (`docker save | ssh docker load`)

Run it in Git Bash on Windows, or any shell on Linux/macOS.

## Once on the PC

- Docker with `buildx` (Docker Desktop has it)
- ssh access to the server with a key
- `cp deploy.env.example deploy.env` and fill in `DEPLOY_HOST`

## Once on the server

```bash
ssh pi@raspberrypi.local "mkdir -p apps/whiteboard/www apps/whiteboard/data"
scp deploy/pi/Caddyfile deploy/pi/docker-compose.yml pi@raspberrypi.local:apps/whiteboard/
scp .env.example pi@raspberrypi.local:apps/whiteboard/.env
```

Then edit `.env` on the server (sign-in mode, see [SELF_HOSTING.md](../SELF_HOSTING.md)).
`deploy/pi/docker-compose.yml` publishes the app on `127.0.0.1:8083`; point your
tunnel or proxy there, or change the port.

If you use another `DEPLOY_NAME` than `whiteboard`, change the image name in
the server's `docker-compose.yml` to `<name>-api:latest`.

## Deploy

```bash
./deploy.sh          # web app only (most changes)
./deploy.sh api      # also rebuild and ship the API container
```

The build stamp at the bottom of the settings dialog shows which version runs.
If web app and server stamps differ, only half was deployed.
