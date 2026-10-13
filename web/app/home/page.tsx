import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Flame, Play, Timer, Target } from 'lucide-react';
import { getUser } from '@/lib/supabase/server';
import {
  getActivePlan,
  getDailyPractice,
  getProfile,
  getRecentSessions,
  getStreak,
} from '@/lib/sessions/queries';
import { getYogaPose } from '@/lib/data/poses';
import { PoseFigure } from '@/components/PoseFigure';
import { ClaimGuestSessions } from '@/components/auth/ClaimGuestSessions';
import { AppNav } from '@/components/layout/AppNav';
import { PracticeCalendar } from '@/components/progress/PracticeCalendar';
import { HoldChart } from '@/components/progress/HoldChart';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Practice — FitSync',
};

function formatHeld(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes === 0) return `${rest}s`;
  return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

function relativeDay(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default async function HomePage() {
  const user = await getUser();
  if (!user) redirect('/sign-in?next=/home');

  const [profile, plan, sessions, streak, daily] = await Promise.all([
    getProfile(),
    getActivePlan(),
    getRecentSessions(30),
    getStreak(),
    getDailyPractice(84),
  ]);

  // Onboarding is where a plan comes from, so someone who has not done it has
  // nothing to practise here.
  if (profile && !profile.onboarding_completed_at) redirect('/onboarding');

  const firstName = profile?.display_name?.trim().split(/\s+/)[0] || null;
  const totalHeld = sessions.reduce((sum, s) => sum + Number(s.total_held_seconds), 0);
  const posesHit = sessions.reduce((sum, s) => sum + s.poses_to_target, 0);
  const posesTried = sessions.reduce((sum, s) => sum + s.total_poses, 0);
  const planDuration =
    plan?.steps.reduce((total, step) => total + step.hold_seconds + step.rest_seconds, 0) ?? 0;

  const hasPractised = sessions.length > 0;

  return (
    <>
      <AppNav />
      <main className={`container ${styles.page}`}>
        <ClaimGuestSessions />

        <header className={styles.head}>
          <div>
            <h1 className={styles.greeting}>
              {firstName ? `Ready when you are, ${firstName}.` : 'Ready when you are.'}
            </h1>
            <p className={styles.subtitle}>
              {streak.practisedToday
                ? 'You have already practised today.'
                : streak.current > 0
                  ? `${streak.current} day${streak.current === 1 ? '' : 's'} running — today keeps it going.`
                  : 'Roll out the mat whenever you are ready.'}
            </p>
          </div>

          {/* The way back out. The landing page is still the product's front
              door, and there was no route to it from inside the app. */}
          <Link href="/" className={`btn btn-ghost ${styles.backHome}`}>
            <ArrowLeft size={15} strokeWidth={2.75} />
            Back to landing
          </Link>
        </header>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statIcon}>
              <Flame size={16} strokeWidth={2.75} aria-hidden="true" />
            </span>
            <span className={styles.statValue}>{streak.current}</span>
            <span className={styles.statLabel}>
              day{streak.current === 1 ? '' : 's'} in a row
            </span>
            {streak.longest > streak.current && (
              <span className={styles.statFoot}>best {streak.longest}</span>
            )}
          </div>

          <div className={styles.stat}>
            <span className={styles.statIcon}>
              <Timer size={16} strokeWidth={2.75} aria-hidden="true" />
            </span>
            <span className={styles.statValue}>{formatHeld(totalHeld)}</span>
            <span className={styles.statLabel}>held in total</span>
            <span className={styles.statFoot}>
              across {sessions.length} session{sessions.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className={styles.stat}>
            <span className={styles.statIcon}>
              <Target size={16} strokeWidth={2.75} aria-hidden="true" />
            </span>
            <span className={styles.statValue}>
              {posesTried > 0 ? `${Math.round((posesHit / posesTried) * 100)}%` : '—'}
            </span>
            <span className={styles.statLabel}>poses held to target</span>
            {posesTried > 0 && (
              <span className={styles.statFoot}>
                {posesHit} of {posesTried}
              </span>
            )}
          </div>
        </div>

        {plan ? (
          <section className={styles.planCard}>
            <div className={styles.planHead}>
              <div>
                <h6 className={styles.kicker}>Your plan</h6>
                <h2 className={styles.planName}>{plan.name}</h2>
              </div>
              <span className="tag tag-neutral">
                about {Math.max(1, Math.round(planDuration / 60))} min
              </span>
            </div>

            <ol className={styles.poses}>
              {plan.steps.map((step, index) => {
                const pose = getYogaPose(step.pose_id);
                if (!pose) return null;
                return (
                  <li key={`${step.pose_id}-${index}`} className={styles.pose}>
                    <span className={styles.poseFigure}>
                      <PoseFigure poseId={pose.id} ground={false} />
                    </span>
                    <span className={styles.poseName}>{pose.short}</span>
                    <span className={styles.poseHold}>{step.hold_seconds}s</span>
                  </li>
                );
              })}
            </ol>

            {plan.rationale && <p className={styles.rationale}>{plan.rationale}</p>}

            <div className={styles.planActions}>
              <Link href={`/session?plan=${plan.id}`} className="btn btn-primary">
                <Play size={16} strokeWidth={2.75} />
                Start your plan
              </Link>
              <Link href="/onboarding" className="btn btn-ghost">
                Change plan
              </Link>
            </div>
          </section>
        ) : (
          <section className={styles.empty}>
            <h2 className={styles.emptyTitle}>No plan yet.</h2>
            <p className={styles.emptyBody}>
              Four questions and we will build one around what you are after,
              how long you have, and whether the floor is an option.
            </p>
            <Link href="/onboarding" className="btn btn-primary">
              Build my plan
            </Link>
          </section>
        )}

        {hasPractised ? (
          <div className={styles.charts}>
            <PracticeCalendar days={daily} />
            <HoldChart sessions={sessions} />
          </div>
        ) : (
          <section className={styles.empty}>
            <h2 className={styles.emptyTitle}>Nothing charted yet.</h2>
            <p className={styles.emptyBody}>
              Once you have finished a session this fills with your practice
              calendar, how long you held each time, and which corrections keep
              coming up.
            </p>
            <Link href="/session" className="btn btn-secondary">
              Practise now
            </Link>
          </section>
        )}

        {hasPractised && (
          <section className={styles.recent}>
            <div className={styles.recentHead}>
              <h6 className={styles.kicker}>Recent practice</h6>
              <Link href="/progress" className="btn btn-ghost">
                See your form trend →
              </Link>
            </div>

            <ul className={styles.sessionList}>
              {sessions.slice(0, 6).map((session) => (
                <li key={session.id} className={styles.sessionRow}>
                  <span className={styles.sessionWhen}>{relativeDay(session.ended_at)}</span>
                  <span className={styles.sessionHeld}>
                    {formatHeld(Number(session.total_held_seconds))}
                  </span>
                  <span className={styles.sessionPoses}>
                    {session.poses_to_target}/{session.total_poses} to target
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
