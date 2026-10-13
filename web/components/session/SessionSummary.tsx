'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import type { SessionSummary as Summary } from '@/lib/hooks/useYogaFlow';
import styles from './SessionSummary.module.css';

import type { SaveState } from '@/lib/hooks/useSessionSave';
import { useHomeHref, useSignedIn } from '@/lib/hooks/useSignedIn';
import { PoseFigure } from '@/components/PoseFigure';
import {
  jointColorsToFlags,
  landmarksToSkeleton,
} from '@/lib/data/landmarksToSkeleton';

interface SessionSummaryProps {
  summary: Summary;
  onFlowAgain: () => void;
  saveState?: SaveState;
}

/**
 * What became of this session's record.
 *
 * The guest case is the interesting one: nothing is lost, it is held locally
 * and claimed on sign-in, so this is an offer rather than a warning. Saying
 * "not saved" would be both alarming and untrue.
 */
function SaveNote({ state }: { state: SaveState }) {
  if (state.status === 'idle' || state.status === 'saving') return null;

  if (state.status === 'guest') {
    return (
      <p className={styles.saveNote}>
        Held on this device.{' '}
        <Link href="/sign-in?next=/home" className={styles.saveLink}>
          Sign in to keep it
        </Link>{' '}
        and watch your form settle over time.
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <p className={styles.saveNote} role="alert">
        We couldn’t save this to your account, so it’s on this device for now.
        It’ll go up next time you finish a session.
      </p>
    );
  }

  return <p className={styles.saveNote}>Saved to your practice.</p>;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The headline figure, in the unit that actually describes the session. A
 * single 25-second hold rounded to "1 minute" overstates what happened, and
 * the summary is the one screen that should not flatter.
 */
function describeDuration(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  if (rounded <= 0) return 'Ready when you are.';
  if (rounded < 60) return `A steady ${rounded} seconds.`;
  const minutes = Math.round(rounded / 60);
  return minutes === 1 ? 'A steady minute.' : `A steady ${minutes} minutes.`;
}

/**
 * What the session added up to, and what to work on next.
 *
 * The "to fix next" list is the point of the screen: it is the only place the
 * corrections stop being transient. Each row is a real count of how many times
 * that cue came up, so it reflects the session rather than flattering it.
 */
export function SessionSummary({ summary, onFlowAgain, saveState }: SessionSummaryProps) {
  /*
   * A signed-in user has somewhere to go back to. Sending them to the
   * marketing page after they have just practised drops them behind a "Sign
   * in" link, with their streak and history one more click away.
   */
  const homeHref = useHomeHref();
  const signedIn = useSignedIn();
  const { totalHeldSeconds, posesToTarget, totalPoses, best, toFixNext } = summary;
  const held = formatDuration(totalHeldSeconds);

  return (
    <div className={styles.backdrop}>
      <motion.div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Session complete"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      >
        <span className="tag tag-accent-2">Session complete</span>

        <h3 className={styles.title}>{describeDuration(totalHeldSeconds)}</h3>

        <p className={styles.lede}>
          {posesToTarget === totalPoses
            ? 'You held every pose to target. Here’s what the coach would work on next time.'
            : `You held ${posesToTarget} of ${totalPoses} poses to target. Here’s what the coach would work on next time.`}
        </p>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{held}</span>
            <span className={`mono ${styles.statLabel}`}>Total hold</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>
              {posesToTarget} / {totalPoses}
            </span>
            <span className={`mono ${styles.statLabel}`}>Poses to target</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{best ? `${best.heldSeconds}s` : '—'}</span>
            <span className={`mono ${styles.statLabel}`}>
              {best ? `Best · ${best.displayName}` : 'Best hold'}
            </span>
          </div>
        </div>

        {toFixNext.length > 0 ? (
          <>
            <h6 className={styles.fixHeading}>To fix next</h6>
            <ul className={styles.fixList}>
              {toFixNext.map((item) => {
                /*
                 * The frame this fault was worst on, replayed as the same
                 * figure the live overlay draws. Thirty-three coordinates,
                 * never an image — which is how the app can show someone what
                 * their knee was doing without recording them.
                 */
                const snapshot = summary.snapshots.find(
                  (s) => s.poseId === item.poseId && s.correction === item.correction
                );
                const replay = snapshot ? landmarksToSkeleton(snapshot.landmarks) : null;

                return (
                  <li key={`${item.poseId}-${item.correction}`} className={styles.fixRow}>
                    {replay && (
                      <span className={styles.fixFigure} aria-hidden="true">
                        <PoseFigure
                          skeleton={replay.skeleton}
                          viewBox={replay.viewBox}
                          flags={jointColorsToFlags(snapshot!.jointColors)}
                          ground={false}
                        />
                      </span>
                    )}
                    <span className={styles.fixText}>
                      <span className={styles.fixCorrection}>{item.correction}</span>
                      <span className={styles.fixPose}>
                        {item.poseName} ·{' '}
                        {/* The correction itself is the query: retrieval finds
                            the guide that explains it (server/ir). */}
                        <Link
                          href={`/search?${new URLSearchParams({
                            q: `${item.poseName} ${item.correction}`,
                            model: 'bm25f',
                            from: 'coach',
                          })}`}
                          className={styles.fixGuide}
                        >
                          Read the guide
                        </Link>
                      </span>
                    </span>
                    <span className="tag tag-accent">{item.count}×</span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className={styles.clean}>
            No repeated corrections this session. Your form held steady throughout.
          </p>
        )}

        {saveState && <SaveNote state={saveState} />}

        <div className={styles.actions}>
          <Link href={homeHref} className="btn btn-secondary">
            {signedIn ? 'Back to your practice' : 'Back to landing'}
          </Link>
          <button type="button" className="btn btn-primary" onClick={onFlowAgain}>
            Flow again
          </button>
        </div>
      </motion.div>
    </div>
  );
}
