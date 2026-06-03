# Trend Dashboard

Nuxt + SQLite dividend dashboard for checking A-share dividend history, current dividend yield, China government bond yields, and yield spread.

## Setup

```bash
pnpm install
pnpm dev
```

The SQLite database cache is created automatically at `data/trend-dashboard.sqlite`.

## Scripts

```bash
pnpm test
pnpm lint
pnpm build
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
