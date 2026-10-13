'use client';

import { useEffect } from 'react';
import { config } from '@/lib/config';
import { YOGA_POSES } from '@/lib/data/poses';
import type { YogaPoseCatalog } from '@/lib/contracts/yoga';

/**
 * Development-only guard: warns when the local catalog has drifted from the
 * backend's.
 *
 * The local catalog carries content the backend does not (descriptions, setup
 * steps, spoken cues), so it cannot simply be replaced by the fetched one. But
 * the backend stays the authority on labels, camera views and hold targets —
 * a mismatch there means a pose silently never detects, or a ring that fills
 * to the wrong number. The static test in lib/data/__tests__ catches drift at
 * build time; this catches a backend that changed after the app shipped.
 *
 * Silent in production: it is a developer signal, not a user-facing failure.
 */
export function useCatalogParity(): void {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`${config.api.baseUrl}${config.api.endpoints.yogaPoses}`);
        if (!res.ok || cancelled) return;
        const { poses } = (await res.json()) as YogaPoseCatalog;
        if (cancelled) return;

        const remote = new Map(poses.map((p) => [p.label, p]));
        const problems: string[] = [];

        for (const local of YOGA_POSES) {
          const match = remote.get(local.id);
          if (!match) {
            problems.push(`"${local.id}" is not in the backend catalog`);
            continue;
          }
          if (match.target_hold_seconds !== local.holdTargetSeconds) {
            problems.push(
              `"${local.id}" hold target: local ${local.holdTargetSeconds}s vs backend ${match.target_hold_seconds}s`
            );
          }
          if (match.camera_view !== local.cameraView) {
            problems.push(
              `"${local.id}" camera view: local ${local.cameraView} vs backend ${match.camera_view}`
            );
          }
        }

        for (const label of remote.keys()) {
          if (!YOGA_POSES.some((p) => p.id === label)) {
            problems.push(`backend offers "${label}" but the app does not list it`);
          }
        }

        if (problems.length) {
          console.warn(
            '[FitSync] Pose catalog drift against the backend:\n  ' + problems.join('\n  ')
          );
        }
      } catch {
        // Backend unreachable in dev is normal; the warm-up hook reports it.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
