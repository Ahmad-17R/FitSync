import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { SignInForm } from '@/components/auth/SignInForm';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Sign in — FitSync',
  description: 'Save your practice and watch your form improve over time.',
};

interface PageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function SignInPage({ searchParams }: PageProps) {
  const params = await searchParams;

  if (await getUser()) redirect(params.next ?? '/home');

  // Only ever redirect within this app. An absolute URL here would turn the
  // sign-in link into an open redirect.
  const next = params.next?.startsWith('/') ? params.next : '/home';

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <span className={styles.markDot} />
          </span>
          FitSync
        </Link>

        <h1 className={styles.title}>Keep your practice.</h1>
        <p className={styles.lede}>
          Sign in to save what you held, follow a plan built for you, and watch
          your form settle over time.
        </p>

        {params.error && (
          <p className={styles.pageError} role="alert">
            That sign-in link did not work. It may have already been used, or
            expired. Try again below.
          </p>
        )}

        <SignInForm next={next} />

        {/*
          The landing page promises no account is needed, and this is where
          that promise is easiest to quietly break. The way out stays visible.
        */}
        <p className={styles.guest}>
          You don’t need an account to practise.{' '}
          <Link href="/session">Start a session as a guest →</Link>
        </p>
      </div>
    </main>
  );
}
