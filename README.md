# Mockoon Live Studio

A self-hosted web editor for Mockoon environment files. It saves changes atomically, keeps local version history, and can push most configuration changes to a running Mockoon CLI through its Admin API without a restart.

## Start

Requires Node.js 20+ and Mockoon CLI 9.6+ for live environment updates.

```powershell
$env:MOCKOON_DATA_FILE = 'D:\path\to\mockoon.json'
$env:MOCKOON_ADMIN_URL = 'http://127.0.0.1:3000'
$env:MOCKOON_ADMIN_TOKEN = 'your-admin-token'
npm start
```

Open `http://127.0.0.1:4173`.

You can also configure the Admin URL and token from **Environment settings**. The token stays in server memory and is never written to disk.

## Run Mockoon CLI

```powershell
mockoon-cli start --data D:\path\to\mockoon.json --watch
```

Use `--watch` as a fallback when live Admin API push is unavailable. Mockoon CLI's Admin API is enabled by default.

## Docker Compose (recommended)

The included Compose stack starts both services:

- `studio`: this browser editor on `http://127.0.0.1:4173`
- `mockoon`: the official Mockoon CLI image on `http://127.0.0.1:3000`

Copy the example settings and start the stack:

```powershell
Copy-Item .env.example .env
docker compose up -d --build --wait
```

The default setup uses `data/sample-environment.json`. To use your own config, edit `.env`:

```dotenv
MOCKOON_CONFIG_DIR=D:/mocks/store-api
MOCKOON_CONFIG_FILE=mockoon.json
MOCKOON_ADMIN_API_TOKEN=replace-with-a-long-random-token
```

`MOCKOON_CONFIG_DIR` must be the directory containing the JSON file, not the JSON file itself. Both containers mount this directory at `/data`: Studio needs write access while Mockoon CLI only receives a read-only mount. Mounting the containing directory also allows Studio's atomic save operation to replace the JSON file safely.

Useful commands:

```powershell
# View status and health
docker compose ps

# Follow both services
docker compose logs -f

# Stop the stack without deleting version history
docker compose down

# Stop and remove the Studio history volume
docker compose down -v
```

Studio saves the mapped JSON file first, then sends it to the Mockoon Admin API. `MOCKOON_AUTO_PUSH=true` is enabled in Compose, so route and response changes take effect without restarting Mockoon CLI. Port, hostname, and TLS changes still require a container restart because Mockoon cannot apply those settings at runtime:

```powershell
docker compose restart mockoon
```

Both published ports bind to `127.0.0.1` by default. If you change either bind address to `0.0.0.0`, place Studio behind authentication and TLS and replace the default Admin API token first.

## Build or run only the Studio image

```powershell
docker build -t mockoon-live-studio .
docker run --rm -p 4173:4173 `
  -e MOCKOON_DATA_FILE=/data/mockoon.json `
  -e MOCKOON_ADMIN_URL=http://host.docker.internal:3000 `
  -e MOCKOON_ADMIN_TOKEN=your-admin-token `
  -v D:/mocks/store-api:/data `
  mockoon-live-studio
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOCKOON_DATA_FILE` | `data/sample-environment.json` | Environment JSON to edit |
| `MOCKOON_ADMIN_URL` | `http://127.0.0.1:3000` | Running mock base URL |
| `MOCKOON_ADMIN_TOKEN` | empty | Admin API bearer token |
| `MOCKOON_AUTO_PUSH` | `false` | Push after every save |
| `STUDIO_HOST` | `127.0.0.1` | Studio bind address |
| `STUDIO_PORT` | `4173` | Studio port |
| `STUDIO_HISTORY_DIR` | `.history` | Directory containing automatic snapshots |

## Safety

- The server binds to localhost by default.
- Saves use a temporary file plus atomic rename.
- The previous file is copied to `.history/` before each save.
- Unknown Mockoon properties are preserved, and the Raw JSON editor is available for advanced features.
- If exposing the Studio beyond localhost, place it behind authentication and TLS.
