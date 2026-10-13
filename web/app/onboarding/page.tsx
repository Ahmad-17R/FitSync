import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getProfile } from '@/lib/sessions/queries';
import { getUser } from '@/lib/supabase/server';
import { Onboarding } from '@/components/onboarding/Onboarding';

export const metadata: Metadata = {
  title: 'Build your plan — FitSync',
  description: 'Four questions, then a practice plan built around your answers.',
};

export default async function OnboardingPage() {
  const user = await getUser();
  if (!user) redirect('/sign-in?next=/onboarding');

  const profile = await getProfile();

  return (
    <main>
      <Onboarding displayName={profile?.display_name ?? null} />
    </main>
  );
}
