# Cloudflare Tunnel — WebGames + n8n

Your `tunnel` service runs **cloudflared** with a token. Routing is **not** defined in `docker-compose.yml`; you configure hostnames in the **Cloudflare Zero Trust dashboard**. The tunnel container only needs to reach services on the Docker network by **service name** (`n8n`, `webgames`, etc.).

## Prerequisites

1. A domain on Cloudflare (DNS managed by Cloudflare).
2. A tunnel already created (you have `CLOUDFLARE_TUNNEL_TOKEN` in `.env`).
3. `webgames` service running: `docker compose up -d webgames` (after merging the addon).

## 1. Add WebGames to Docker Compose

Copy the `webgames` service from [`docker-compose.addon.yml`](docker-compose.addon.yml) into your main compose file, or run:

```bash
docker compose -f /path/to/your/docker-compose.yml -f deploy/docker-compose.addon.yml up -d --build webgames
```

Set in `.env` (same file as n8n):

```env
GAMES_DOMAIN_NAME=games.yourdomain.com
CLIENT_ORIGIN=https://games.yourdomain.com
```

`CLIENT_ORIGIN` must match the **exact** URL players use in the browser (scheme + host, no trailing path).

Rebuild when the app changes:

```bash
docker compose build webgames && docker compose up -d webgames
```

## 2. Configure the tunnel in Cloudflare

1. Open [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Connectors** → **Cloudflare Tunnels**.
2. Select the tunnel that matches your `CLOUDFLARE_TUNNEL_TOKEN`.
3. Go to **Public Hostname** (or **Published applications** → your tunnel → **Add a public hostname**).

### n8n (likely already configured)

| Field | Value |
|--------|--------|
| Subdomain | e.g. `n8n` (or whatever `${DOMAIN_NAME}` uses) |
| Domain | `yourdomain.com` |
| Path | *(leave empty)* |
| Type | HTTP |
| URL | `n8n:5678` |

Service hostname is the **Docker Compose service name**, not `localhost`.

### WebGames (new)

| Field | Value |
|--------|--------|
| Subdomain | e.g. `games` → `games.yourdomain.com` |
| Domain | `yourdomain.com` |
| Path | *(leave empty)* |
| Type | HTTP |
| URL | `webgames:3000` |

Important for Socket.IO and WebRTC:

- Use **one hostname** for the whole app (`games.yourdomain.com`). The UI and WebSocket are served from the same `webgames` container.
- In Cloudflare, for this hostname enable **WebSockets** (often on by default for HTTP tunnels).
- SSL/TLS mode for the zone: **Full** or **Full (strict)** is fine; the tunnel terminates HTTPS at the edge.

## 3. DNS

Adding a public hostname in the tunnel UI usually creates a CNAME automatically. If not, add:

- `games` → CNAME → `<tunnel-id>.cfargotunnel.com` (proxied / orange cloud).

## 4. Verify

1. `docker compose ps` — `webgames` healthy.
2. On the host (optional): `docker compose exec tunnel wget -qO- http://webgames:3000/health` → `{"ok":true}`.
3. Browser: `https://games.yourdomain.com` — home page loads.
4. Create a Quizz Poker room — no Socket.IO errors in the browser console.
5. Camera: for peers across networks, set `VITE_ICE_SERVERS` at **build** time if needed (TURN); LAN-only often works with STUN only.

## 5. Multiple services on one tunnel

Typical layout:

```text
Internet → Cloudflare edge (HTTPS)
              ↓
         cloudflared (tunnel container)
              ↓ Docker network
    n8n:5678          webgames:3000          obsidian-sync:5984
```

Each **public hostname** is one row in the tunnel config pointing at `service:port`.

Do **not** point WebGames at `localhost:3000` from inside the tunnel container — use `webgames:3000`.

## 6. Troubleshooting

| Symptom | Check |
|---------|--------|
| 502 / tunnel error | `webgames` running? Healthcheck passing? URL `webgames:3000` in dashboard? |
| Page loads, rooms fail | `CLIENT_ORIGIN` must equal browser URL; rebuild if you changed domain |
| CORS errors | Same as above — `https://` and hostname must match |
| n8n broke after edit | n8n hostname must still target `n8n:5678`, not `localhost` |

## Optional: separate API subdomain

Only if you split client and server later:

- `games.yourdomain.com` → static CDN
- `api.games.yourdomain.com` → `webgames:3000`

Then build with `VITE_SERVER_URL=https://api.games.yourdomain.com` and set `CLIENT_ORIGIN=https://games.yourdomain.com` on the server (CORS). The default single-host setup is simpler.
