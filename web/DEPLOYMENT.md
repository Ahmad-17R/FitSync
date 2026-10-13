# Deploying FitSync

Two halves of one repo: the Next.js app in `web/` goes to Vercel, the FastAPI
yoga API in `server/` goes to Render.

**Do Render first.** A frontend live against a server that has not been told
its origin fails in a genuinely confusing way: browsers do not send a CORS
preflight for WebSocket handshakes, so live coaching works while
`GET /api/yoga/poses` and `/api/yoga/health` are blocked. The symptom is a
session that connects but never warms up.

---

## 1. Backend — Render

**Already deployed:** https://zenflow-api-mto8.onrender.com
([dashboard](https://dashboard.render.com/web/srv-dacrr83m8hqs73dpa980)) —
free plan, Singapore, auto-deploys on push to `main`.

To recreate it: **New → Blueprint → select this repo.** Render reads
[`render.yaml`](../render.yaml), which mirrors the live service exactly.

By hand:

| Field | Value |
| --- | --- |
| Runtime | Python 3 |
| Build Command | `pip install -r server/requirements.txt` |
| Start Command | `cd server && uvicorn main:app --host 0.0.0.0 --port $PORT` |

### Worth tightening later

The live service has no Root Directory set, so the commands carry the `server/`
prefix themselves. Setting **Root Directory** to `server` in the dashboard lets
you simplify them to `pip install -r requirements.txt` and
`uvicorn main:app --host 0.0.0.0 --port $PORT` — and, more usefully, scopes the
build so a push touching only `web/` stops redeploying the API. That matters
here because a redeploy restarts the process, and yoga session state lives in
memory per WebSocket connection: anyone mid-hold loses it.

Set **Health Check Path** to `/api/yoga/health` at the same time.

### Environment

| Key | Value |
| --- | --- |
| `PYTHON_VERSION` | `3.11` |
| `DEBUG` | `false` |
| `CORS_ORIGINS` | `https://zenflow-coach.vercel.app,https://web-kappa-liard.vercel.app,http://localhost:3000,http://localhost:5173` |
| `CORS_ORIGIN_REGEX` | `https://(zenflow-coach|web)-[a-z0-9]+-[a-z0-9-]+\.vercel\.app` |

**Never put `https://*.vercel.app` in `CORS_ORIGINS`.** FastAPI's
`CORSMiddleware` compares that list as exact strings, so a wildcard entry
matches no origin, ever. It looks like it covers preview deploys and does
nothing. `CORS_ORIGIN_REGEX` is the one that works — see
[`server/config/settings.py`](../server/config/settings.py).

Verify with a real cross-origin request rather than by watching the socket:

```bash
curl -si -H "Origin: https://web-kappa-liard.vercel.app" \
  https://zenflow-api-mto8.onrender.com/api/yoga/health | grep -i access-control
```

You want `access-control-allow-origin` echoing your origin back.

### Optional tuning

```env
YOGA_HOLD_DEBOUNCE_FRAMES=10   # default; ~0.8s of grace at the client's 12fps
```

Counted in **frames**, not seconds. Raise it if holds reset too eagerly on real
footage — and raise it *before* loosening any pose threshold, because jitter and
over-strictness fail identically from the user's side but need opposite fixes.

---

## 2. Frontend — Vercel

**Already deployed:** https://web-kappa-liard.vercel.app

Vercel took the project name from the root directory, so the project is called
`web` and the domain reads `web-kappa-liard.vercel.app`.

### Renaming it

`.vercel.app` subdomains are **globally unique across every Vercel account**,
not just yours. Renaming a project to a name whose subdomain is already taken
succeeds — and silently leaves the old domain in place, because Vercel has
nothing to give you. That is the failure mode to recognise: the rename "worked"
but the URL never changed.

`zenflow-ai.vercel.app` is taken, by an unrelated workflow-management product.
`zenflow-coach.vercel.app` is free and is what the API's allow-list is set up
for. Before renaming to anything else, check the subdomain is actually
available:

```bash
curl -s -o /dev/null -w "%{http_code}
" https://<candidate>.vercel.app
# 404 -> free   ·   200 -> already owned by someone
```

Then *Settings → General → Project Name*, and redeploy. The old domain stays
allow-listed too, so nothing breaks while you switch.

To set it up again from scratch:

1. **New Project** → import this repository.
2. **Root Directory: `web`.** This matters — the repo root is not the app.
3. Framework preset **Next.js** (detected); build command and output are the
   defaults.
4. Environment Variables, for *Production*, *Preview* and *Development*:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_FORM_COACH_URL` | `https://zenflow-api-mto8.onrender.com` |

   Changing this later needs a **redeploy**, not just a save: `NEXT_PUBLIC_*`
   variables are inlined into the client bundle at build time, so an existing
   deployment keeps the old value until it is rebuilt.

5. Deploy.

Or from the CLI:

```bash
cd web
npx vercel link
npx vercel env add NEXT_PUBLIC_FORM_COACH_URL production
# paste: https://zenflow-api-mto8.onrender.com
npx vercel --prod
```

### About that one variable

It is the only URL in the app. The WebSocket base is derived from it in
[`lib/config.ts`](lib/config.ts) (`https://` → `wss://`), so it is not possible
to end up with an HTTPS page opening an insecure `ws://` socket, which browsers
block outright. Set the `https://` URL and the socket follows.

### MediaPipe assets

`npm install` runs [`scripts/copy-mediapipe-assets.mjs`](scripts/copy-mediapipe-assets.mjs),
which copies the WASM runtime out of `node_modules` and downloads the 5.8 MB
pose model into `public/`. Vercel runs install on every build, so this is
automatic — and both paths are gitignored, because they are build output.

Self-hosting is deliberate: it takes a third-party CDN off the critical path of
a live demo. If the download fails at build time (offline, blocked proxy) the
build still succeeds and [`lib/mediapipe.ts`](lib/mediapipe.ts) falls back to
`storage.googleapis.com` at runtime with a console warning. `npm run assets`
fixes it properly.

No COOP/COEP headers are needed: the lite model with the GPU delegate does not
use `SharedArrayBuffer`. If you ever switch to the full or heavy model, add the
headers in `next.config.ts` and re-test every cross-origin asset, because COEP
blocks them all by default.

---

## 3. Verify

```bash
# The API is awake and knows the poses.
curl -s https://zenflow-api-mto8.onrender.com/api/yoga/poses | head -c 200

# CORS lets your origin read it.
curl -si -H "Origin: https://web-kappa-liard.vercel.app" \
  https://zenflow-api-mto8.onrender.com/api/yoga/health | grep -i access-control-allow-origin

# Warm or cold?
curl -w "%{time_total}s\n" -o /dev/null -s \
  https://zenflow-api-mto8.onrender.com/api/yoga/health
```

Then in a browser:

1. **`/`** — the hero skeleton assembles, turns sage, and loops. The network tab
   shows a request to `/api/yoga/health` on load: that is the cold-start
   warm-up, fired while you read.
2. **`/session?preview=1`** — the full live UI against a scripted coach, no
   camera. The fastest way to confirm the deploy renders before you go looking
   for a room with good light.
3. **`/session`** — allow the camera and stand back until your whole body is in
   frame. The skeleton should track you, the ring should fill, and you should
   hear one spoken correction at a time.

---

## 4. Demo day

The API is on Render's free plan, so it spins down after ~15 minutes idle and
the next request waits for a boot.

The app is built around this rather than fighting it: the health ping fires when
the **landing page** mounts, not when a session starts, so the boot overlaps
with someone reading the hero.

- **Send people to `/`, never straight to `/session`.** A deep link to the
  session on a cold API means watching a spinner.
- **`/session?preview=1` is the safety net.** Full UI, scripted coach, no
  network. If the venue wifi is hostile there is still something honest to
  show — and it says "preview" on screen rather than faking live feedback.
- **Ten minutes before presenting**, curl the health endpoint and confirm it
  answers in under a second.
- **If it has to be bulletproof**, either schedule a 10-minute ping
  (cron-job.org) for the demo window, or switch the service to Starter in the
  dashboard and back down afterwards — Render changes plans in place, keeping
  the URL and every environment variable.

---

## 5. Locally

```bash
cd server && python -m uvicorn main:app --port 8000    # terminal 1
cd web && npm run dev                                   # terminal 2
```

with `web/.env.local`:

```env
NEXT_PUBLIC_FORM_COACH_URL=http://localhost:8000
```

`http://localhost:3000` is already in the server's default `CORS_ORIGINS`, so
local development needs no backend configuration at all.

In development the app also cross-checks its pose catalog against
`GET /api/yoga/poses` and logs a console warning if the two have drifted — a
hold target changed on the server, say. That check is silent in production.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Session connects but the gate says "the coach is not responding" | `/api/yoga/health` blocked by CORS | Add your exact origin to `CORS_ORIGINS` — scheme included, no trailing slash |
| First session of the day hangs for a minute | Free-plan cold start | Expected. Land users on `/` so the warm-up runs first |
| Ring resets mid-hold, repeatedly | Pose detection jitter | Raise `YOGA_HOLD_DEBOUNCE_FRAMES` before touching pose thresholds |
| Skeleton drifts off the body | Camera aspect vs viewport | The overlay reproduces `object-fit: cover` from the stream's real dimensions; check `videoWidth`/`videoHeight` are non-zero |
| "Step back so your whole body is in the frame" that will not clear | A required joint is below the visibility floor | Move further back; for Downward Dog and Cobra turn side-on with the phone at floor level |
| No spoken cues | No `speechSynthesis`, or voice is off | The voice button disables itself when unsupported; iOS needs a user gesture first, which the start button provides |
| Hold restarts after a network blip | Server state is per-connection and in memory | Expected. The reconnect chip says so rather than letting the ring reset silently |

## What is not deployed

Nothing is persisted anywhere. The server keeps session state in memory per
WebSocket connection, and the app stores three preferences in `localStorage`
(voice, focus surface, last pose). No database, no account, no analytics —
which is what makes the privacy claim on the landing page true.
