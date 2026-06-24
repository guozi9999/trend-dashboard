# Trend Dashboard

FastAPI trend dashboard for checking A-share market rotation and market temperature.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8765
```

The MySQL database and cache tables are created automatically on startup. Configure the connection in `.env`:

```text
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=trend_user
MYSQL_PASSWORD=your_password_here
MYSQL_DATABASE=trend_dashboard
MYSQL_CHARSET=utf8mb4
```

## Scripts

```bash
python -m py_compile main.py app/db/database.py app/services/*.py
```

## Deploy to Render

Use Render's manual Web Service deployment instead of a `render.yaml` Blueprint.

1. Connect this GitHub repository in Render and create a new **Web Service**.
2. Use these settings:

```text
Runtime: Node
Build Command: corepack enable && pnpm install --no-frozen-lockfile && pnpm build
Start Command: pnpm start
Health Check Path: /api/health
```

`corepack enable` makes Render provide the `pnpm` binary before install. Keep it in the build command if Render reports `pnpm: command not found`.

3. Add these environment variables in Render:

```text
NODE_VERSION=22
HOST=0.0.0.0
SUPABASE_URL=your Supabase project URL
SUPABASE_SERVICE_ROLE_KEY=your Supabase service role key
```

Do not commit real Supabase keys to GitHub. Add them only in Render's environment variable settings.
