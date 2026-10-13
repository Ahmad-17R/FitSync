import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import {
  getCorrectionTrends,
  getPersonalBests,
  getRecentSessions,
} from '@/lib/sessions/queries';
import { YOGA_POSES } from '@/lib/data/poses';
import { PoseFigure } from '@/components/PoseFigure';
import { AppNav } from '@/components/layout/AppNav';
import { CorrectionTrend } from '@/components/progress/CorrectionTrend';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Progress — FitSync',
  description: 'Whether your form is settling, session by session.',
};

function formatHeld(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (minutes === 0) return `${remainder}s`;
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

export default async function ProgressPage() {
  const user = await getUser();
  if (!user) redirect('/sign-in?next=/progress');

  const [sessions, trends, bests] = await Promise.all([
    getRecentSessions(30),
    getCorrectionTrends(4),
    getPersonalBests(),
  ]);

  const totalHeld = sessions.reduce((sum, s) => sum + Number(s.total_held_seconds), 0);
  const posesWithBests = YOGA_POSES.filter((pose) => bests[pose.id] > 0);

  if (sessions.length === 0) {
    return (
      <>
        <AppNav />
        <main className={`container ${styles.page}`}>
          <h1 className={styles.title}>Nothing to show yet.</h1>
          <p className={styles.lede}>
            Once you have finished a session, this is where you will see whether
            your form is settling — which corrections keep coming up, and
            whether they are coming up less often than they used to.
          </p>
          <Link href="/session" className="btn btn-primary">
            Practise now
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className={`container ${styles.page}`}>
        <h1 className={styles.title}>Your progress</h1>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{sessions.length}</span>
            <span className={styles.statLabel}>sessions</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{formatHeld(totalHeld)}</span>
            <span className={styles.statLabel}>held in total</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{posesWithBests.length}</span>
            <span className={styles.statLabel}>poses practised</span>
          </div>
        </div>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>What the coach keeps saying</h2>
          <p className={styles.sectionLede}>
            Counted once per time a cue took over, not once per frame — so a
            four means four wobbles, not four seconds of one.
          </p>

          {trends.length > 0 ? (
            <>
              <div className={styles.trends}>
                {trends.map((trend) => (
                  <CorrectionTrend key={`${trend.poseId}-${trend.correction}`} trend={trend} />
                ))}
              </div>

              {/* The same numbers, reachable without reading a chart. */}
              <details className={styles.tableToggle}>
                <summary>See these as a table</summary>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Correction</th>
                      <th scope="col">Pose</th>
                      <th scope="col">Times</th>
                      <th scope="col">Latest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trends.map((trend) => (
                      <tr key={`${trend.poseId}-${trend.correction}-row`}>
                        <td>{trend.correction}</td>
                        <td>{trend.poseId.replace(/_/g, ' ')}</td>
                        <td>{trend.total}</td>
                        <td>{trend.points.at(-1)?.count ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <p className={styles.sectionLede}>
              Nothing flagged so far. Either your form is clean or there is not
              enough practice behind it yet — another session or two will tell.
            </p>
          )}
        </section>

        {posesWithBests.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Longest holds</h2>
            <ul className={styles.bests}>
              {posesWithBests.map((pose) => (
                <li key={pose.id} className={styles.best}>
                  <span className={styles.bestFigure}>
                    <PoseFigure poseId={pose.id} ground={false} />
                  </span>
                  <span className={styles.bestName}>{pose.short}</span>
                  <span className={styles.bestValue}>
                    {Math.round(bests[pose.id])}s
                  </span>
                  <span className={styles.bestTarget}>of {pose.holdTargetSeconds}s</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
