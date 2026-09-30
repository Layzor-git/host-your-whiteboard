# Self-hosting guide

Whiteboard runs as two containers:

- **web**: Caddy serving the built app and forwarding `/api` to the API
- **api**: Node.js with SQLite. It never listens on the host; only `web` reaches it

In front of that you need two things: **HTTPS** and **a way to sign people in**. Both come from your reverse proxy or tunnel; the app itself only reads who is signed in.

```
browser ──HTTPS──> your proxy / tunnel ──> web :8080 ──> api :3000 ──> ./data
                   (sign-in happens here)
```

## Requirements

- Docker with the Compose plugin
- A 64-bit system. A Raspberry Pi 3B+ or newer with a 64-bit OS is enough to run it. Building on a Pi 3 takes a while; see [deploy/README.md](deploy/README.md) for building on a PC instead
- HTTPS in front of the app. Without it, browsers disable the service worker (offline mode and installing the app), the camera and the clipboard. `localhost` is the only exception

## Install

```bash
git clone <this repository> whiteboard
cd whiteboard
cp .env.example .env
```

Edit `.env` for one of the sign-in modes below, then:

```bash
docker compose up -d --build
```

Check that it runs:

```bash
curl -s http://127.0.0.1:8080/api/v1/health
```

The web container listens on `127.0.0.1:8080`. Change that with `WHITEBOARD_PORT` and `WHITEBOARD_BIND` in `.env`.

## Sign-in

Every board belongs to an email address. The server learns that address in one of three ways, set with `AUTH_MODE`.

### Option A: Cloudflare Tunnel and Access (`AUTH_MODE=cloudflare`)

No open ports, free for small teams, and Cloudflare handles the login (one-time email codes, Google, GitHub, …). The server verifies the signed token Cloudflare adds to every request, so a forged header does not get anyone in.

**Keep this order.** Create the Access application *before* the DNS route; otherwise the app is public for the time in between.

1. **Tunnel.** Install `cloudflared` and create a tunnel ([Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/)).

2. **Access application.** In Zero Trust: *Access controls → Applications → Add an application → Self-hosted*. Use your hostname, e.g. `whiteboard.example.com`, and add a policy that lists who may sign in. Set the **session duration** to something long (a month), or people will type codes all the time.

3. **Two values into `.env`**:

   | Setting | Where to find it |
   |---|---|
   | `CF_ACCESS_TEAM_DOMAIN` | *Settings → Team domain*, only the part before `.cloudflareaccess.com` |
   | `CF_ACCESS_AUD` | *Applications → your app → Overview → Application Audience (AUD) Tag* |

   Then `docker compose up -d` again.

4. **Ingress rule** in the tunnel config (`/etc/cloudflared/config.yml`):

   ```yaml
   ingress:
     - hostname: whiteboard.example.com
       service: http://localhost:8080
     - service: http_status:404
   ```

   Restart `cloudflared` afterwards. Without the restart it does not know the hostname, and you get a 404 *after* a successful sign-in.

5. **Only now the DNS route:**

   ```bash
   cloudflared tunnel route dns <tunnel-name> whiteboard.example.com
   ```

6. **Check:**

   ```bash
   curl -sI https://whiteboard.example.com | head -1
   ```

   `302` is right: Access redirects to its login page. A `200` means the app is reachable without sign-in; check the Access application immediately.

When you share a board with someone, their address also has to be allowed by the Access policy. The share dialog reminds you of that.

### Option B: your own sign-in proxy (`AUTH_MODE=header`)

For Authelia, Authentik, oauth2-proxy, Pomerium and similar. The proxy signs the user in and passes their email address in a header.

```ini
AUTH_MODE=header
AUTH_HEADER=Remote-Email          # the header your proxy sets
LOGOUT_URL=https://auth.example.com/logout   # optional, shows "Sign out"
```

Common header names: Authelia `Remote-Email`, Authentik `X-authentik-email`, oauth2-proxy `X-Forwarded-Email` (with `--set-xauthrequest` / `--pass-user-headers`).

> [!IMPORTANT]
> In this mode the app trusts the header. It must only be reachable through the proxy, and the proxy must overwrite or remove the header on every request. Keep `WHITEBOARD_BIND=127.0.0.1` (the default) or restrict the port with a firewall.

Example with Caddy and Authelia:

```caddyfile
whiteboard.example.com {
    # Never pass a header the client sent itself
    request_header -Remote-Email

    forward_auth authelia:9091 {
        uri /api/authz/forward-auth
        copy_headers Remote-Email
    }
    reverse_proxy 127.0.0.1:8080
}
```

### Option C: no sign-in (`AUTH_MODE=single`)

Everyone who can open the app is the same user. Sharing is pointless in this mode; everything is simply shared.

```ini
AUTH_MODE=single
SINGLE_USER_EMAIL=me@localhost
```

Only use this where nobody else can reach the app: your own machine, a home network you trust, or a private network like Tailscale. To reach it from other devices, set `WHITEBOARD_BIND=0.0.0.0`. For HTTPS without a public domain, `tailscale serve` or Caddy with its internal certificate authority work well.

## HTTPS with your own reverse proxy

If you don't use Cloudflare Tunnel, any reverse proxy works. It has to pass WebSockets through (live sync runs on `/api/v1/boards/<id>/live`).

**Caddy** does that out of the box and gets certificates automatically:

```caddyfile
whiteboard.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

**nginx:**

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    client_max_body_size 25m;   # images up to 20 MB
}
```

## Updates

```bash
git pull
docker compose up -d --build
```

The database schema migrates itself on start. Installed apps pick up the new version the next time they come back from the background; closing and reopening the app forces it.

## Backup

Everything is in `./data`: `app.db` (SQLite in WAL mode, so also `app.db-wal` and `app.db-shm`) and the `bilder/` folder with uploaded images.

The simplest consistent backup stops the API for a moment:

```bash
docker compose stop api
tar czf whiteboard-$(date +%F).tar.gz data .env
docker compose start api
```

The `.env` contains your Access settings; keep the backup somewhere private.

**Restore:** stop the stack, replace `data/` with the backup (including the `-wal` file if there is one), start again.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `502 Bad Gateway` | The API container is not running. `docker compose ps`, then `docker compose logs api` |
| `401` / "not signed in" | Cloudflare: `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` wrong. Header mode: the proxy doesn't send `AUTH_HEADER`. The API log says which |
| 404 after a successful Cloudflare sign-in | `cloudflared` hasn't loaded the new ingress rule. Restart it |
| Live sync doesn't work, drawings appear only after reload | The proxy doesn't pass WebSockets |
| Uploading large images fails | Proxy body size limit (nginx `client_max_body_size`) |
| `exec format error` | The image was built for another CPU architecture |
| Server doesn't start: "DEV_EMAIL is set in production" | Remove `DEV_EMAIL` from `.env`. For a setup without sign-in use `AUTH_MODE=single` |
| Phone still shows the old version | Close the app completely (swipe it away) and reopen it |
| Changed the port, nothing happens | `docker compose down && docker compose up -d`, not `restart` |
