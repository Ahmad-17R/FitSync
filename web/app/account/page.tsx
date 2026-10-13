import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { getActivePlan, getProfile, getRecentSessions } from '@/lib/sessions/queries';
import { EXPERIENCE_LABELS, GOAL_LABELS } from '@/lib/plans/types';
import { AppNav } from '@/components/layout/AppNav';
import { DeleteData } from '@/components/account/DeleteData';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Account — FitSync',
};

export default async function AccountPage() {
  const user = await getUser();
  if (!user) redirect('/sign-in?next=/account');

  const [profile, plan, sessions] = await Promise.all([
    getProfile(),
    getActivePlan(),
    getRecentSessions(200),
  ]);

  return (
    <>
      <AppNav />
      <main className={`container ${styles.page}`}>
        <h1 className={styles.title}>Account</h1>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>You</h2>
          <ul className={styles.rows}>
            <li className={styles.row}>
              <span className={styles.rowLabel}>Signed in as</span>
              <span className={styles.rowValue}>{user.email}</span>
            </li>
            {profile?.goal && (
              <li className={styles.row}>
                <span className={styles.rowLabel}>Practising for</span>
                <span className={styles.rowValue}>{GOAL_LABELS[profile.goal]}</span>
              </li>
            )}
            {profile?.experience && (
              <li className={styles.row}>
                <span className={styles.rowLabel}>Experience</span>
                <span className={styles.rowValue}>
                  {EXPERIENCE_LABELS[profile.experience]}
                </span>
              </li>
            )}
            {profile?.minutes_available && (
              <li className={styles.row}>
                <span className={styles.rowLabel}>Time per session</span>
                <span className={styles.rowValue}>{profile.minutes_available} minutes</span>
              </li>
            )}
            {profile?.floor_ok !== null && profile?.floor_ok !== undefined && (
              <li className={styles.row}>
                <span className={styles.rowLabel}>Floor poses</span>
                <span className={styles.rowValue}>
                  {profile.floor_ok ? 'Included' : 'Standing only'}
                </span>
              </li>
            )}
            <li className={styles.row}>
              <span className={styles.rowLabel}>Current plan</span>
              <span className={styles.rowValue}>{plan?.name ?? 'None yet'}</span>
            </li>
            <li className={styles.row}>
              <span className={styles.rowLabel}>Sessions saved</span>
              <span className={styles.rowValue}>{sessions.length}</span>
            </li>
          </ul>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>What we keep</h2>
          <p className={styles.cardBody}>
            What you held, for how long, and which cues the coach gave you.
            For the poses it flagged, we also keep the joint coordinates from
            the moment the fault was worst, so we can draw it back to you.
          </p>
          <p className={styles.cardBody}>
            No video, ever. Pose estimation runs in your browser and the camera
            image never leaves your device — not to us, and not to the server
            that checks your form.
          </p>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Delete everything</h2>
          <p className={styles.cardBody}>
            Removes every session, your plan, your form history and your
            onboarding answers. Your account stays, so you can start fresh.
          </p>
          <DeleteData sessionCount={sessions.length} />
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Sign out</h2>
          <p className={styles.cardBody}>
            You can still practise signed out — sessions are kept on this device
            and added to your account next time you sign in.
          </p>
          <form action="/auth/sign-out" method="post" className={styles.signOut}>
            <button type="submit" className="btn btn-secondary">
              Sign out
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
