# FitSync

Real-time yoga form feedback in the browser. Eight poses, timed holds, one
spoken correction at a time.

The camera and all pose estimation run on the device. Only 33 anonymous joint
coordinates per frame ever leave it — never the image, and nothing is recorded.

- **Landing** `/` — hero, scroll-driven walkthrough, pose library, FAQ
- **Session** `/session` — camera, skeleton overlay, hold ring, voice coach
- **Guides** `/search` — pose-guide retrieval: Boolean, BIM, BM25, BM25F, region search
- **Preview** `/session?preview=1` — the full live UI against a scripted coach,
  no camera needed

Built to the `design_handoff_zenflow_ai/` handoff, against the yoga pipeline in
[`../server/`](../server) ([API guide](../docs/YOGA_API.md)).

---

## Quick start

```bash
npm install          # also vendors the MediaPipe wasm + pose model into public/
npm run dev          # http://localhost:3000
```

Point it at a backend with `.env.local`:

```env
NEXT_PUBLIC_FORM_COACH_URL=http://localhost:8000
```

That is the only URL the app needs — the WebSocket base is derived from it.
See [DEPLOYMENT.md](DEPLOYMENT.md) for production.

| Script | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run test` | Catalog parity + flow engine tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run assets` | Re-vendor the MediaPipe wasm and model |

---

## How a frame flows

```
camera ──► MediaPipe PoseLandmarker (WASM, GPU)  ──► 33 landmarks
                                                        │
                          throttled to 12fps ───────────┤
                                                        ▼
                                    WebSocket  /api/ws/yoga/{clientId}
                                       { landmarks, pose, timestamp }
                                                        │
                        state · hold_seconds · corrections · joint_colors
                                                        ▼
                     skeleton overlay · hold ring · cue line · voice coach
```

The client names the target pose on **every** frame. That is what makes the
yoga pipeline different from the exercise one: there is no classifier, no
warm-up, and feedback starts on frame one. Changing the `pose` field is also
how a guided flow advances — the backend starts a fresh hold whenever the label
changes, so sequencing is entirely client-side.

**12fps is load-bearing, not an optimisation.** The yoga route has no
server-side rate limiting, and the backend's hold debounce is counted in
frames — streaming at 60fps would both flood the socket and shrink the user's
wobble tolerance from ~0.8s to ~0.16s.

---

## Layout

```
app/
  page.tsx              landing
  session/page.tsx      live session (reads ?pose= ?flow= ?sheet= ?preview=)
  globals.css           Organic design tokens, shared keyframes, surfaces
components/
  landing/              Nav Hero HeroSkeleton HeroCenterpiece HowItWorks
                        StickyMock PoseLibrary Faq FooterCta
  session/              LiveSession SkeletonOverlay HoldRing PoseBadge
                        CueLine BreathPacer ControlBar PoseSheet
                        SessionSummary  + states/
  PoseFigure.tsx        the SVG pose illustration, shared everywhere
lib/
  config.ts             the one URL, and the frame rate
  contracts/yoga.ts     the wire format
  data/                 poses · flows · flowEngine · skeletons
  hooks/                useYogaWebSocket useYogaFlow useSpeech useCamera
                        usePoseDetection useChime useBackendWarmup …
  motion/SmoothScroll   Lenis wired to GSAP's ticker
```

---

## Things that will bite you

**Keyframes cannot live in a CSS Module if another module uses them.** The
module compiler rewrites `animation-name: zfBreath` to a hashed local name; if
the keyframes are defined elsewhere, that name resolves to nothing and the
animation silently never runs — no error, no warning. Shared motion is applied
through the zero-specificity `:where(.zf-*)` utilities in `globals.css`, tuned
per element with `--zf-delay` / `--zf-duration` custom properties. Keyframes
used by exactly one module stay in that module.

**The skeleton overlay must reproduce `object-fit: cover`.** Landmarks are
normalised to the camera's source frame, but the video is cropped to fill the
viewport. `SkeletonOverlay` rebuilds that crop from the stream's real
dimensions; skip it and the skeleton drifts off the body on any viewport whose
shape differs from the camera's.

**Joints are HTML, bones are SVG.** The bone layer is stretched non-uniformly
to the frame, and an SVG `<circle>` under that stretch renders as an ellipse.

**The pinned section measures its own sticky element.** `HowItWorks` derives
scroll progress from the sticky's actual travel (`section.height - stickyTop -
stickyHeight`), not the section's height. Using the section's height makes step
3 activate only after the pin has released — the payoff step then plays against
a mock sliding out of frame. The pin itself is CSS `position: sticky`;
ScrollTrigger only reports progress, because its own `pin` inserts a spacer
that breaks the grid.

**`overflow-x: hidden` kills every sticky on the page.** It forces
`overflow-y: auto`, which makes that element the scrollport. `globals.css` uses
`overflow-x: clip`, which does not.

**An empty `joint_colors` means the body was not visible, not that form is
perfect.** It is a framing problem and is surfaced as "step back", never as a
form correction — a correction computed from joints the camera cannot see is
not merely unhelpful, it is wrong.

---

## The pose catalog is a contract

`lib/data/poses.ts` must agree with the backend's
`exercises/yoga_registry.py` on every `id`, `cameraView` and
`holdTargetSeconds`. A label the backend does not know is rejected; a hold
target that disagrees fills the ring to the wrong number.

Two guards:

- `lib/data/__tests__/catalog.test.ts` asserts parity against a table
  duplicated from the backend. Duplicated on purpose — a test that fetched the
  values would pass whenever the backend was down, which is exactly when drift
  goes unnoticed.
- `useCatalogParity` re-checks against the live `/api/yoga/poses` in
  development and warns on drift. Silent in production.

Everything else in the catalog — descriptions, setup steps, spoken cues — is
content the backend does not carry. The `cues` are copied verbatim from the
backend's `corrections` strings, because the detail sheet is headed "What the
coach listens for" and a paraphrase there would promise one thing and speak
another.

---

## Preview mode

`/session?preview=1` runs the whole live UI against a scripted stand-in for the
camera and the coach: framing failure → an active correction → a running hold →
completion, on a loop.

It exists because every state that matters is transient and needs a person, a
room and good light to reproduce. It is not a fallback — nothing switches to it
automatically, and the session labels itself while it runs. A demo that
silently faked its feedback would be worse than one that failed honestly.

---

## Accessibility and motion

- All motion is gated on `prefers-reduced-motion`. The reduced state is the
  *settled* one — skeleton in sage, ring fully swept, no movement — not a
  compressed animation parked on its first frame. The GSAP timelines and the
  CSS check the same query, so they cannot disagree.
- Lenis smooth scrolling is disabled entirely under reduced motion; hijacking
  scroll is exactly what that setting is asking us not to do.
- The hold ring and the skeleton carry `sr-only` text, since their meaning is
  otherwise only colour and geometry.
- The cue line is an `aria-live` region, so it announces the same thing the
  voice coach says.
- FAQ rows are native `<details>` — keyboard- and screen-reader-correct without
  JavaScript, and findable by in-page search.

---

## Known limits

Inherited from the backend, and worth stating plainly:

- **Floor poses are the weak link.** Downward Dog and Cobra need a side view at
  floor height and still detect less reliably than standing poses. The UI
  surfaces `camera_view` prominently for this reason.
- **Nothing persists.** Session state lives in memory per WebSocket connection;
  a backend restart mid-session drops the hold, and the app says so rather than
  letting the ring reset silently. Only three preferences are stored locally.
- **One body only.** Two people in frame is undefined behaviour.
- **No authentication** on the WebSocket.
