import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AppNav } from '@/components/layout/AppNav';
import { GuideSearch } from '@/components/search/GuideSearch';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Pose guides — FitSync',
  description:
    'Search FitSync’s pose guides by goal or by a correction the coach gave you, and see how each retrieval model ranked them.',
};

/**
 * Entry points:
 *   /search                                    the search tab, empty
 *   /search?q=...&model=bm25f&from=coach       from a correction in the session summary
 *   /search?tab=compare|structured|evaluation  the other retrieval views
 *
 * Guest-friendly like the session: nothing here needs an account.
 */
export default function SearchPage() {
  return (
    <>
      <AppNav />
      <main className={`container ${styles.page}`}>
        <h1 className={styles.title}>Pose guides</h1>
        <p className={styles.lede}>
          Search by what you want to work on, or follow a correction from your last session.
          Every result shows how it was scored.
        </p>
        <Suspense>
          <GuideSearch />
        </Suspense>
      </main>
    </>
  );
}
