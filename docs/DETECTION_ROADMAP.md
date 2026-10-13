# Detection roadmap — phases 3 and 4

Phases 1 and 2 shipped: framing hysteresis and the pre-rendered voice. This is
the plan for the two that remain, both aimed at the same complaint — *"some
sort of intelligence in detection is needed."*

They are independent. Phase 3 is engineering with predictable outcomes and no
new dependencies. Phase 4 is a small piece of research and is the part worth
defending in a viva.

---

## The actual problem

Every threshold in [`yoga_poses.py`](../server/exercises/yoga_poses.py) reads a
**2D projection of a 3D body**. `WarriorIIPose.MIN_ARM_SPAN = 0.45` is the
horizontal distance between two wrists *in the image*. Stand square to the
camera and it measures arm span. Turn thirty degrees and the same correct pose
measures about 0.39, and the coach says the arms are not wide enough.

That is the mechanism behind most of what reads as stupidity:

| Symptom | Cause |
| --- | --- |
| "Extend both arms" while the arms are extended | Foreshortening — the arm span is measured in the image plane |
| Warrior I and II confused for each other | Both are a lunge; the arms tell them apart and the arms are the least reliable measurement |
| Triangle only works from one side of the room | `MIN_LATERAL_TILT` measures apparent tilt, which depends on the camera's angle to the plane of the pose |
| Floor poses barely work | Side view, heavy self-occlusion, and the same projection problem at floor level |

None of these is fixed by tuning a number. They are all fixed by measuring the
body in three dimensions instead of two.

---

## Phase 3 — measure the body properly

### 3a. Use the 3D landmarks that are already being thrown away

MediaPipe returns two sets of coordinates per frame. The app reads one of them.

```ts
// web/lib/mediapipe.ts — extractLandmarks
const landmarks = (result as DetectionResult | null)?.landmarks;   // ← 2D, normalised to the image
// result.worldLandmarks is right there and never touched
```

`worldLandmarks` are **metric 3D coordinates in metres, with the midpoint of the
hips as the origin** ([Google's Pose Landmarker
docs](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)).
An angle computed from them does not change when the person turns, moves closer,
or is filmed from a different height. This is the single highest-value change in
this document and it costs no model, no download, and no accuracy trade.

**What changes**

1. `extractLandmarks` returns both sets.
2. `YogaFrame` gains an optional `world_landmarks` field
   ([`lib/contracts/yoga.ts`](../web/lib/contracts/yoga.ts)). Optional, so an
   older client and a newer server keep working in both directions.
3. `landmarks_to_dict` gains a world variant; `BaseYogaPose.evaluate` receives
   both.
4. Angle checks move to world coordinates. Position checks **stay in 2D** —
   this is the part to get right rather than convert everything reflexively:

| Check | Space | Why |
| --- | --- | --- |
| Knee, elbow, hip angles | world | A joint angle is a property of the body |
| Arm span, arm level | world | Currently the worst offenders |
| Torso tilt from vertical | world | Gravity is a world direction, not an image direction |
| "Hips higher than shoulders" (Down Dog) | world | Same |
| "Is the body out of frame" | image | It is a question *about* the image |
| Shoulders level (Mountain) | image | This one genuinely asks how the person looks to the camera |

**Effort:** a day. **Risk:** every threshold needs retuning against real
footage, because degrees-in-world and degrees-in-image are not the same number.
Do it pose by pose with the existing synthetic fixtures extended to carry `z`.

### 3b. Upgrade the pose model

[`lib/config.ts`](../web/lib/config.ts) pins `pose_landmarker_lite`. `lite` is
~3MB and the fastest; `full` is the balanced variant; `heavy` is ~30MB.
Published latencies put lite around 35ms and full around 55ms per frame on a
mid CPU.

FitSync runs at **12fps on a stationary body** — an 83ms budget per frame. The
headroom is there, and limb-landmark stability is exactly what the lite model
is worst at and exactly what this app depends on.

Change `modelPath`/`remoteModelUrl` in `config.ts`, update
`scripts/copy-mediapipe-assets.mjs`, and measure on the oldest phone available
before committing. Keep lite selectable by env var as the escape hatch.

**Effort:** an hour, plus device testing.

### 3c. Smooth the landmarks

Raw per-frame keypoints jitter by a few pixels even on a body that is not
moving, and jitter is what makes a threshold crossing fire and unfire. The
standard answer is a
[One Euro filter](https://mohamedalirashad.github.io/FreeFaceMoCap/2021-12-25-filters-for-stability/)
per landmark: an adaptive low-pass that filters hard at low speed — a static
hold — and relaxes during fast motion so transitions do not lag.

There is also a ready-made alternative already written and tested in this
project's parent repo: `form-checking-backend/backend/pipeline/kalman.py`, a
33-landmark constant-velocity tracker that scales measurement noise by
visibility. FitSync's slim server dropped it along with the rest of the
exercise pipeline.

Prefer One Euro **client-side**: it filters before the data crosses the wire,
so the skeleton overlay is smoothed too, and it keeps the server stateless.

**Effort:** half a day. Two parameters to tune (`minCutoff`, `beta`).

---

## Phase 4 — a learned score, on top of the rules

### What this is not

It is **not** replacing the rule-based checks with a model. The rules are the
product: they produce *"straighten and press through your back leg"*, which is
a coaching instruction. A classifier produces *"warrior_ii, 0.87"*, which is
not. Nobody can act on a probability.

It is also **not** fine-tuning BlazePose. That model is trained on a scale of
data no FYP can match, MediaPipe Tasks cannot load a custom export, and the
landmark quality is not the bottleneck — the interpretation of the landmarks is.

### What it is

A small classifier over the landmarks, used for two things the rules cannot do.

**1. A continuous score instead of a binary verdict.** Today `is_in_pose` is
`not violations` — a cliff. The user is out of the pose, then suddenly in it,
with nothing in between. A learned score gives *"eighty percent of the way into
Warrior II"*, which drives a progress arc, a warmer tone as it climbs, and a
much better answer to "am I nearly there?"

**2. A gate on the corrections.** Today, a person standing still gets told to
bend their front knee, because the rules assume the target pose is being
attempted. Gating on the classifier means: no correction fires until the model
agrees this is an attempt at Warrior II at all. That alone removes the single
most incoherent thing the coach currently does.

### The recipe

**Features — a view-invariant embedding.** Not raw coordinates, which encode
position and scale.

1. Take the 12 key joints from `worldLandmarks` (shoulders, elbows, wrists,
   hips, knees, ankles).
2. Compute all 66 pairwise distances.
3. Divide by torso length (shoulder-midpoint to hip-midpoint) so the embedding
   is scale-free, and therefore body-size- and distance-free.

The result is invariant to translation, scale and — because it comes from world
coordinates — camera angle. This is the same design as the k-NN safety net
described for the parent project's exercise classifier, so there is precedent
in the codebase's own lineage.

**Model.** Start with k-NN (k=5, cosine). It needs no training loop, it is
inspectable — you can show which reference frames a prediction came from, which
is worth a lot in a viva — and 66 features over a few thousand samples is
instant. If it underperforms, a 2-layer MLP (66 → 64 → 9) is under 100KB.

**Classes.** The 8 supported poses **plus a ninth "none of these"** class. This
is not optional. Without a reject class the model must assign every frame to
some pose, and a person standing still becomes whichever pose is nearest —
which is precisely the failure being fixed.

**Data.**

| Source | Size | Licence | Use |
| --- | --- | --- | --- |
| [Yoga-82](https://sites.google.com/view/yoga-82/home) | 21,009 train / 7,469 test, 82 classes | **Non-commercial research and education only** — must be declared | Training. Map its classes onto the 8; everything unmapped becomes "none" |
| [Isometric pose benchmark](https://arxiv.org/pdf/2506.11774) | static holds with feedback labels | check before use | Second opinion |
| Self-recorded | ~200 frames/pose | yours | **Validation. Non-negotiable — see below** |

**The risk to name up front.** Yoga-82 is web-scraped photographs: expert
practitioners, good lighting, deliberate and often artistic camera angles.
FitSync's input is a webcam in a bedroom, pointed at a beginner. That is a real
domain gap, and a model reporting 96% on Yoga-82's test split can still be
mediocre on the actual input.

So: **train on Yoga-82, report on your own recordings.** A held-out set from the
same distribution as the training data measures the dataset, not the product.
Recording 200 frames per pose on the machine the demo runs on is an afternoon
and it is the number that means something. Report both, and be explicit about
which is which — that contrast is a better viva answer than either figure alone.

**Where it runs.** Server-side, in Python, next to the existing rules.
`YogaManager.process_frame` already has the landmarks; the classifier is numpy
plus a small `.npz` of reference embeddings. No browser bundle cost, no second
copy of the model, and the training pipeline stays offline. The cost is that it
rides the Render free tier's cold start — acceptable, because the session
already waits on that socket.

**Effort:** two to three days including data collection. Depends on 3a for the
world coordinates.

---

## Order

```
3a world landmarks ──► 3b model upgrade ──► 4 learned score
        └──────────► 3c smoothing (independent)
```

3a first and alone: it is the prerequisite for phase 4's features, and it is
the change most likely to fix complaints on its own. Do not start 4 before 3a —
an embedding built from 2D coordinates is not view-invariant, and the whole
argument for the classifier rests on that property.

## Verification

- Every threshold changed in 3a needs a fixture with real `z` values; the
  synthetic skeletons in `tests/test_yoga_poses.py` currently set `z: 0.0`
  throughout, which makes them useless for world-coordinate checks
- Record one clip per pose from three camera angles. A correct pose must score
  as correct from all three — that is the acceptance test for 3a, and no unit
  test substitutes for it
- Phase 4 ships behind a flag, off by default, until the reject class is
  measured on self-recorded footage
- `cd server && pytest -q` and `cd web && npm test` stay green throughout
