'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { StickyMock } from './StickyMock';
import styles from './HowItWorks.module.css';

/**
 * Numbered because this genuinely is a sequence — you cannot pick a pose
 * before the camera can see you, and you cannot be coached before you have
 * picked one. The numbers carry order the reader needs, which is the only
 * thing that earns them.
 */
const STEPS = [
  {
    n: '01',
    meta: '~10 seconds',
    title: 'Prop your phone or laptop',
    body: 'Stand back until your whole body fits the frame. FitSync draws the box it needs and tells you when every joint is visible.',
  },
  {
    n: '02',
    meta: 'you choose',
    title: 'Pick a pose, or take a flow',
    body: 'Six poses in sequence, or one held on its own. Each carries its own hold target — 15 seconds for Mountain, 25 for Warrior II.',
  },
  {
    n: '03',
    meta: 'eyes closed',
    title: 'Listen, don’t look',
    body: 'One spoken cue at a time, a chime when the pose locks, the ring counting your hold, and the breath paced 4·4·8.',
  },
];

export function HowItWorks() {
  const [activeStep, setActiveStep] = useState(0);
  const sectionRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const section = sectionRef.current;
    if (!section) return;

    const sticky = section.querySelector<HTMLElement>('[data-sticky]');
    if (!sticky) return;

    /**
     * The pin's travel, not the section's height.
     *
     * A sticky element only moves through `section.height - stickyTop -
     * stickyHeight` pixels. Dividing progress by the section's *full* height
     * instead means step 3 activates after the pin has already released, and
     * the payoff step plays against a mock sliding out of frame.
     *
     * Both values are measured rather than hardcoded so the same trigger is
     * correct at every breakpoint — the CSS is free to shrink the sticky on
     * a phone without the maths drifting out of sync with it.
     */
    const stickyTop = () => parseFloat(getComputedStyle(sticky).top) || 0;
    const travel = () =>
      Math.max(1, section.offsetHeight - stickyTop() - sticky.offsetHeight);

    // The pin itself is CSS `position: sticky`, not ScrollTrigger's `pin`.
    // ScrollTrigger's pin inserts a spacer element that would break the grid
    // this section is built on; its only job here is reporting progress.
    const trigger = ScrollTrigger.create({
      trigger: section,
      start: () => `top ${stickyTop()}px`,
      end: () => `+=${travel()}`,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const index = Math.max(0, Math.min(2, Math.floor(self.progress * 3.02)));
        setActiveStep((prev) => (prev === index ? prev : index));
      },
    });

    return () => trigger.kill();
  }, []);

  return (
    <>
      <div className={`container ${styles.intro}`} id="how">
        <h6 className={styles.kicker}>How it works</h6>
        <h2 className={styles.title}>
          Three steps, then you stop looking at the screen.
        </h2>
        <p className={styles.lede}>
          No calibration, no account needed for your first flow.
        </p>
      </div>

      <div ref={sectionRef} className={`container ${styles.scroller}`}>
        <ol className={styles.steps}>
          {STEPS.map((step, index) => (
            <li
              key={step.n}
              className={styles.step}
              data-active={index === activeStep}
              aria-current={index === activeStep ? 'step' : undefined}
            >
              <span className={styles.number} aria-hidden="true">
                {step.n}
              </span>
              <span className={`tag tag-neutral ${styles.meta}`}>{step.meta}</span>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepBody}>{step.body}</p>
            </li>
          ))}
        </ol>

        {/* This element is the pin. Its containing block is its grid area,
            which spans the full row, so it travels the whole section — and
            it stays the sticky one at every breakpoint so the ScrollTrigger
            below always has a single box to measure. */}
        <div className={styles.stickyColumn} data-sticky>
          <div className={styles.sticky}>
            <StickyMock activeStep={activeStep} />
          </div>
        </div>
      </div>
    </>
  );
}
