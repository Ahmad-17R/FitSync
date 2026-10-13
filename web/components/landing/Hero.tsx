import { Fragment } from 'react';
import Link from 'next/link';
import { HeroCenterpiece } from './HeroCenterpiece';
import styles from './Hero.module.css';

const TRUST = [
  '8 guided poses',
  'Runs in the browser',
  'Nothing to wear',
  'Video never leaves your device',
];

export function Hero() {
  return (
    <section className={styles.hero}>
      <div className={`${styles.blob} ${styles.blobAccent} zf-drift`} aria-hidden="true" />
      <div className={`${styles.blob} ${styles.blobSage} zf-drift`} aria-hidden="true" />

      <div className={`${styles.copy} zf-lift`}>
        <span className={`tag tag-accent-2 ${styles.eyebrow}`}>
          Real-time form feedback
        </span>

        <h1 className={styles.headline}>Hold the pose.</h1>
        <h1 className={`${styles.headline} ${styles.headlineAccent}`}>
          We’ll watch the rest.
        </h1>

        <p className={styles.lede}>
          FitSync reads your body through the camera you already have, times every
          hold, and speaks one calm correction at a time — so you can keep your eyes
          closed and stay in the breath.
        </p>

        <div className={styles.actions}>
          <Link href="/session" className={`btn btn-primary ${styles.primaryCta}`}>
            Begin a session
          </Link>
          {/*
            The handoff pairs this with "Watch a 40s demo". There is no demo
            film, and a button that does nothing is worse than one fewer
            button — so it points at the section that actually demonstrates
            the product, and says so.
          */}
          <a href="#how" className={`btn btn-secondary ${styles.secondaryCta}`}>
            See how it works
          </a>
        </div>

        <p className={styles.trust}>
          {TRUST.map((item, i) => (
            <Fragment key={item}>
              {i > 0 && (
                <span className={styles.sep} aria-hidden="true">
                  ·
                </span>
              )}
              <span>{item}</span>
            </Fragment>
          ))}
        </p>
      </div>

      <HeroCenterpiece />
    </section>
  );
}
