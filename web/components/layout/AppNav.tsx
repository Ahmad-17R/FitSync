import Link from 'next/link';
import { getUser } from '@/lib/supabase/server';
import { getProfile } from '@/lib/sessions/queries';
import styles from './AppNav.module.css';

/**
 * The nav for signed-in surfaces.
 *
 * Separate from the landing page's marketing nav: that one sells the product
 * to someone who has not tried it, this one gets someone who has already
 * decided to their practice in as few clicks as possible.
 */
export async function AppNav() {
  const user = await getUser();
  const profile = user ? await getProfile() : null;
  /*
   * Guard against an empty initial. `coalesce` in the signup trigger only
   * skips NULL, so a provider that supplies an empty full_name leaves
   * display_name as '' — and `''.charAt(0)` is '', which renders the avatar as
   * a blank circle that looks like a broken button.
   */
  const initial =
    [profile?.display_name, user?.email]
      .map((value) => value?.trim())
      .find((value) => value && value.length > 0)
      ?.charAt(0)
      .toUpperCase() ?? '?';

  return (
    <header className={styles.nav}>
      <Link href="/home" className={styles.brand} aria-label="FitSync, practice home">
        <span className={styles.mark} aria-hidden="true">
          <span className={styles.markDot} />
        </span>
        <span className={styles.wordmark}>FitSync</span>
      </Link>

      <nav className={styles.links} aria-label="Practice">
        <Link href="/home" className={styles.link}>
          Practice
        </Link>
        <Link href="/progress" className={styles.link}>
          Progress
        </Link>
        <Link href="/search" className={styles.link}>
          Guides
        </Link>
        <Link href="/account" className={styles.link}>
          Account
        </Link>
      </nav>

      <div className={styles.right}>
        <Link href="/session" className={`btn btn-primary ${styles.cta}`}>
          Start a session
        </Link>
        <Link href="/account" className={styles.avatar} aria-label="Your account">
          {initial}
        </Link>
      </div>
    </header>
  );
}
