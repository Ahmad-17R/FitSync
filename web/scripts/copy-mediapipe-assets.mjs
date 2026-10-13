/**
 * Vendors the MediaPipe runtime into public/ so the app has no third-party CDN
 * on its critical path.
 *
 *   public/mediapipe/wasm/  <- node_modules/@mediapipe/tasks-vision/wasm
 *   public/models/pose_landmarker_lite.task  <- downloaded once, then cached
 *
 * Runs on postinstall. It must never fail the install: a developer offline, or
 * behind a proxy that blocks storage.googleapis.com, still gets a working tree.
 * If the model can't be fetched, lib/mediapipe.ts falls back to the canonical
 * remote URL at runtime, so the app degrades to CDN-loading rather than
 * breaking.
 */

import { access, cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const WASM_SRC = join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const WASM_DEST = join(ROOT, 'public', 'mediapipe', 'wasm');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/' +
  'pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const MODEL_DEST = join(ROOT, 'public', 'models', 'pose_landmarker_lite.task');

// The lite float16 model is ~5 MB. Anything much smaller is a truncated
// download or an error page, and would fail confusingly inside the WASM loader.
const MIN_MODEL_BYTES = 1_000_000;

const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.warn(`  ! ${msg}`);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function copyWasm() {
  if (!(await exists(WASM_SRC))) {
    warn('@mediapipe/tasks-vision not installed yet — skipping wasm copy.');
    return;
  }
  await rm(WASM_DEST, { recursive: true, force: true });
  await mkdir(dirname(WASM_DEST), { recursive: true });
  await cp(WASM_SRC, WASM_DEST, { recursive: true });
  ok('MediaPipe wasm -> public/mediapipe/wasm');
}

async function fetchModel() {
  if (await exists(MODEL_DEST)) {
    const { size } = await stat(MODEL_DEST);
    if (size >= MIN_MODEL_BYTES) {
      ok(`pose landmarker model already present (${(size / 1e6).toFixed(1)} MB)`);
      return;
    }
    await rm(MODEL_DEST, { force: true });
  }

  await mkdir(dirname(MODEL_DEST), { recursive: true });

  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < MIN_MODEL_BYTES) {
      throw new Error(`response was only ${buf.byteLength} bytes`);
    }
    await writeFile(MODEL_DEST, buf);
    ok(`pose landmarker model -> public/models (${(buf.byteLength / 1e6).toFixed(1)} MB)`);
  } catch (err) {
    warn(`could not download the pose model (${err.message}).`);
    warn('The app will load it from storage.googleapis.com at runtime instead.');
    warn('Re-run `npm run assets` once you have network access to self-host it.');
  }
}

console.log('fitsync: vendoring MediaPipe assets');
await copyWasm();
await fetchModel();
