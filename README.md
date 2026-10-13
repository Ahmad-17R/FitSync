# FitSync

**An AI-powered, real-time yoga instructor using human pose estimation and
posture correction.** Final Year Project.

FitSync watches you through the camera you already have, checks your pose frame
by frame, times your holds, and gives one spoken correction at a time — so you
can close your eyes and stay in the breath. When the coach corrects you, the
pose guide that explains the fix is one tap away.

**No video ever leaves the device.** Pose estimation runs in the browser with
MediaPipe; only 33 anonymous joint coordinates per frame are sent for
evaluation. Nothing is recorded. An account is optional — the whole live
session works signed out.

**Live:** https://web-kappa-liard.vercel.app

```
web/       Next.js 15 app (React 19)        → Vercel   https://web-kappa-liard.vercel.app
server/    FastAPI: yoga coach + retrieval  → Render   https://zenflow-api-mto8.onrender.com
supabase/  Postgres schema notes (accounts, plans, history — row-level security)
tools/     offline voice renderer (Kokoro-82M)
docs/      YOGA_API.md · IR_MODULE.md · IR_RESULTS.md · DETECTION_ROADMAP.md
```

The deployment URLs and the Render/Supabase project names predate the rename
and are kept as they are — they identify live infrastructure, not the product.

The API sleeps after ~15 minutes idle, so open `/` first — the landing page
pings it on mount and the wake-up happens while you read. `/session?preview=1`
needs neither the API nor a camera.

## What it does

| Feature | Where |
| --- | --- |
| Real-time pose detection (33 landmarks, 12fps, on-device) | `web/lib/hooks/usePoseDetection.ts` |
| Posture & form evaluation for 8 poses, per-joint colours | `server/exercises/yoga_poses.py` |
| Stable feedback: per-joint Schmitt triggers, frame-count hysteresis, hold debounce | `server/pipeline/framing.py`, `hold_timer.py` |
| Hold tracking and guided flows | `server/pipeline/hold_timer.py`, `web/lib/hooks/useYogaFlow.ts` |
| Voice coaching (pre-rendered clips, speech-synthesis fallback) | `web/lib/hooks/useVoice.ts` |
| Personalised plans from goals, experience and time | `web/lib/plans/generate.ts` |
| Accounts, history, streaks, progress charts | `web/lib/sessions/`, `web/app/progress/` |
| **Pose-guide retrieval** — Boolean, BIM, BM25, BM25F, structured region search | `server/ir/`, `web/app/search/` |

What the proposal still asks for — a trained pose classifier on a custom
dataset, recorded-video evaluation, performance scores, and the installable
mobile build — is planned in [`docs/DETECTION_ROADMAP.md`](docs/DETECTION_ROADMAP.md).

## How it fits together

```
Browser
├── getUserMedia ─────────────────────────────────────────┐
├── MediaPipe PoseLandmarker (WASM, GPU)                   │
│     └── 33 landmarks {x, y, z, visibility} @ 12fps       │
│                                                          ▼
├── WebSocket ───────────────────────► /api/ws/yoga/{client_id}
│     { landmarks, pose, timestamp }        │  BaseYogaPose.evaluate()
│                                           │  HoldTimer.update()
│     ◄─────────────────────────────────────┘
│     state · hold_progress · corrections · joint_colors
│       → skeleton overlay, hold ring, spoken cue, chime
│
└── /search ─────────────────────────► /api/search?q=…&model=…
      a typed goal, or a correction           │  tokenize → stem → index
      from the session summary                │  Boolean | BIM | BM25 | BM25F | regions
      ◄───────────────────────────────────────┘
      ranked guides + snippet + per-term score breakdown
```

The client names the pose on every frame, so the server never has to guess what
you are doing: feedback starts on frame one. Sequencing is the client's job
too — the server answers one question per frame and remembers nothing between
connections.

## Quick start

Two terminals.

```bash
# API
cd server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn main:app --port 8000

# App
cd web
npm install
npm run dev          # http://localhost:3000
```

`web/.env.local`:

```env
NEXT_PUBLIC_FORM_COACH_URL=http://localhost:8000
```

`http://localhost:3000` is already an allowed origin, so local development
needs no server configuration. Supabase variables are optional — without them
the app runs guest-only.

**`/session?preview=1`** runs the entire live UI against a scripted coach with
no camera and no backend. **`/search`** is the retrieval module.

## Pose-guide retrieval (Information Retrieval module)

Given a posture mistake the live coach detected, or a goal a user typed, find
the pose guide that answers it. The corpus is 30 guides
([`server/ir/data/yoga_corpus.json`](server/ir/data/yoga_corpus.json)), each
split into fields: name, tags, overview, steps, benefits, cautions, mistakes.

| Model | File | In one line |
| --- | --- | --- |
| Boolean | `ir/boolean.py` | AND / OR / NOT over posting lists — yes or no, no ranking |
| Binary Independence Model | `ir/ranking.py` | rare query words count more; presence only, optional pseudo-relevance feedback |
| BM25 | `ir/ranking.py` | rarity × saturating term frequency × length normalisation |
| BM25F | `ir/ranking.py` | BM25 with field weights (a word in the name beats one in a caution) |
| Non-overlapped lists | `ir/structured.py` | `cautions CONTAINING knee` — returns the matching region itself |
| Overlapped lists | `ir/structured.py` | `knee ... ankle` — spans that may overlap each other |

On five judged queries BM25/BM25F reach MAP 0.904 and MRR 1.0, against 0.616 /
0.535 for BIM. Every correction the coach can give retrieves its own pose's
guide first. Full write-up, comparison and worked examples:
[`docs/IR_MODULE.md`](docs/IR_MODULE.md).

```bash
cd server && python -m ir.evaluate      # the comparison table
```

## The voice

The coach's script is a **closed set** — every pose introduction, hold cue,
transition and correction is fixed before the app ships, around sixty
utterances in total. They are rendered once, offline, with
[Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)
(Apache 2.0) and committed as ~2MB of AAC: no model download, no API key, no
per-play cost, and the voice is identical every time.

```bash
cd tools/voice
npm install            # onnxruntime — deliberately not a devDependency of web/
npm run render         # writes web/public/voice/*.m4a + manifest.json
```

[`web/lib/hooks/useVoice.ts`](web/lib/hooks/useVoice.ts) falls back to the Web
Speech API when a clip is missing, and a vitest case asserts every correction
the server can emit has a clip.

## Two kinds of joint

`required_joints` are the joints without which a pose cannot be judged at all.
`preferred_joints` are checked when visible and skipped when not. Tree Pose
used to require both ankles — and the entire point of the pose is to tuck one
foot behind the standing leg.

Visibility is debounced twice over in
[`server/pipeline/framing.py`](server/pipeline/framing.py): a Schmitt trigger
per joint, and a run of consecutive bad frames before anything is said. A body
leaving the picture ("step back") is distinguished from one that is in shot but
unreadable ("face the camera"), and the cue is spoken once per episode.

## The eight poses

| Pose | Sanskrit | Camera | Hold |
| --- | --- | --- | --- |
| Mountain | Tadasana | front | 15s |
| Tree | Vrksasana | front | 20s |
| Warrior I | Virabhadrasana I | front | 20s |
| Warrior II | Virabhadrasana II | front | 25s |
| Chair | Utkatasana | front | 20s |
| Triangle | Trikonasana | front | 20s |
| Downward Dog | Adho Mukha Svanasana | **side** | 20s |
| Cobra | Bhujangasana | **side** | 15s |

The catalog in [`web/lib/data/poses.ts`](web/lib/data/poses.ts) must agree with
[`server/exercises/yoga_registry.py`](server/exercises/yoga_registry.py);
`web/lib/data/__tests__/catalog.test.ts` asserts it.

## Testing

```bash
cd server && pytest -q              # pose detection, framing, hold timing, WebSocket, retrieval
cd server && pytest -q tests/test_ir.py   # retrieval only
cd web && npm test                  # catalog and voice-script parity with the server
cd web && npm run build             # type-checks as it builds
```

## Origins

The server began as the yoga half of
[shahmir2004/exercise-form-correction](https://github.com/shahmir2004/exercise-form-correction),
extracted so the app deploys on its own; the exercise pipeline and its ~117 MB
of dependencies are deliberately absent. `server/tests/test_slim_server.py`
fails if any of it comes back.

Deployment: [`web/DEPLOYMENT.md`](web/DEPLOYMENT.md) ·
Protocol: [`docs/YOGA_API.md`](docs/YOGA_API.md) ·
Retrieval: [`docs/IR_MODULE.md`](docs/IR_MODULE.md)
