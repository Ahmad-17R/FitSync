import Link from 'next/link';
import styles from './FooterCta.module.css';

export function FooterCta() {
  return (
    <footer className={`container ${styles.wrap}`}>
      <section className={styles.panel}>
        <span className={`${styles.orb} ${styles.orbAccent} zf-breath-soft`} aria-hidden="true" />
        <span className={`${styles.orb} ${styles.orbSage} zf-breath-soft`} aria-hidden="true" />

        <div className={styles.content}>
          <h2 className={styles.title}>Roll out the mat. We’ll take it from there.</h2>
          <p className={styles.lede}>
            Stand where your whole body fits in frame, pick a pose, and close your eyes.
          </p>
          <Link href="/session" className={`btn ${styles.cta}`}>
            Begin a session
          </Link>
        </div>
      </section>

      <div className={styles.colophon}>
        <span>
          FitSync — pose feedback for people who’d rather not watch a screen.
        </span>
        <span>
          Pose detection runs on-device · MediaPipe + FitSync form engine
        </span>
      </div>
    </footer>
  );
}
