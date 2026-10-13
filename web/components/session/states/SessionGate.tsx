'use client';

import Link from 'next/link';
import { useHomeHref, useSignedIn } from '@/lib/hooks/useSignedIn';
import { Camera, Loader, ShieldCheck } from 'lucide-react';
import { PoseFigure } from '@/components/PoseFigure';
import type { CameraError, CameraStatus } from '@/lib/hooks/useCamera';
import type { WarmupState } from '@/lib/hooks/useBackendWarmup';
import styles from './SessionGate.module.css';

interface SessionGateProps {
  cameraStatus: CameraStatus;
  cameraError: CameraError | null;
  modelError: string | null;
  warmup: WarmupState;
  poseId: string;
  onStart: () => void;
}

/**
 * Everything that happens before the camera is live.
 *
 * The handoff does not cover these states, so they are designed here in the
 * same language. Two rules shape the copy: say what happened and what to do
 * about it, and never apologise — an error that says "sorry, something went
 * wrong" has spent the user's attention without giving them a move.
 *
 * The privacy line is here rather than buried in the FAQ because this is the
 * moment someone is deciding whether to grant camera access, and it is the
 * only moment the promise actually matters to them.
 */
export function SessionGate({
  cameraStatus,
  cameraError,
  modelError,
  warmup,
  poseId,
  onStart,
}: SessionGateProps) {
  const homeHref = useHomeHref();
  const signedIn = useSignedIn();
  const requesting = cameraStatus === 'requesting';
  const problem = cameraError?.message ?? modelError;

  return (
    <div className={styles.gate}>
      <div className={styles.panel}>
        <div className={styles.figure}>
          <PoseFigure poseId={poseId} label="" />
        </div>

        <div className={styles.copy}>
          <span className="tag tag-accent-2">Before we start</span>

          <h1 className={styles.title}>
            {problem ? 'The camera didn’t start.' : 'Let FitSync see your pose.'}
          </h1>

          <p className={styles.body}>
            {problem ??
              'Prop your phone or laptop where your whole body fits the frame, about two to three metres back, and turn on the camera.'}
          </p>

          <p className={styles.privacy}>
            <ShieldCheck size={16} strokeWidth={2.75} aria-hidden="true" />
            <span>
              Pose detection runs in your browser. Only anonymous joint
              coordinates are sent for evaluation — the video never leaves your
              device, and no video is ever recorded.
            </span>
          </p>

          <div className={styles.actions}>
            <button
              type="button"
              className={`btn btn-primary ${styles.cta}`}
              onClick={onStart}
              disabled={requesting}
            >
              {requesting ? (
                <>
                  <Loader size={18} strokeWidth={2.75} className="zf-spin" />
                  Waiting for permission
                </>
              ) : (
                <>
                  <Camera size={18} strokeWidth={2.75} />
                  {problem ? 'Try again' : 'Turn on the camera'}
                </>
              )}
            </button>

            <Link href={homeHref} className={`btn btn-secondary ${styles.cta}`}>
              {signedIn ? 'Back to your practice' : 'Back to the poses'}
            </Link>
          </div>

          {/* The backend sleeps on a free tier and takes up to a minute to
              wake. Saying so beats a session that silently fails to connect. */}
          {warmup === 'warming' && (
            <p className={styles.warmup}>
              Waking the coach — this takes up to a minute if it has been idle.
            </p>
          )}
          {warmup === 'unreachable' && (
            <p className={styles.warmupBad}>
              The coach is not responding, so you will not get form feedback yet.
              The camera and the hold timer still work, and it will reconnect on
              its own once the server is back.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
