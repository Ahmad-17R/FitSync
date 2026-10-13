import Link from 'next/link';
import { NavAuthLink } from './NavAuthLink';
import styles from './Nav.module.css';

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#poses', label: 'Poses' },
  { href: '#faq', label: 'FAQ' },
];

/**
 * The brand mark is a ring with a dot inside it — the same geometry as the
 * hold ring in the live session, so the logo is the product's core gesture
 * rather than a shape chosen to look like a logo.
 */
export function Nav() {
  return (
    <header className={styles.nav}>
      <Link href="/" className={styles.brand} aria-label="FitSync, home">
        <span className={styles.mark} aria-hidden="true">
          <span className={styles.markDot} />
        </span>
        <span className={styles.wordmark}>FitSync</span>
      </Link>

      <nav className={styles.links} aria-label="Sections">
        {LINKS.map((link) => (
          <a key={link.href} href={link.href} className={styles.link}>
            {link.label}
          </a>
        ))}
      </nav>

      <div className={styles.actions}>
        {/*
          Sign-in is offered, never required. The lede two sections down
          promises no account is needed for a first flow, so the primary
          action stays the session itself.
        */}
        <NavAuthLink className={`btn btn-ghost ${styles.secondary}`} />
        <Link href="/session" className={`btn btn-primary ${styles.cta}`}>
          Start a session
        </Link>
      </div>
    </header>
  );
}
