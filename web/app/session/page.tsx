import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LiveSession } from '@/components/session/LiveSession';
import { YOGA_POSE_BY_ID } from '@/lib/data/poses';
import { getYogaFlow, type YogaFlow } from '@/lib/data/flows';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export const metadata: Metadata = {
  title: 'Live session — FitSync',
  description:
    'Hold a pose and get spoken corrections in real time. Pose detection runs on your device.',
};

/**
 * Entry points into a session, all from the landing page:
 *   /session                       the default guided flow
 *   /session?pose=tree             one pose, held on its own
 *   /session?pose=tree&sheet=1     the same, with its details open
 *   /session?flow=morning-wakeup   a named flow
 *   /session?plan=<uuid>           the signed-in user's own plan
 */
interface PageProps {
  searchParams: Promise<{
    pose?: string;
    flow?: string;
    plan?: string;
    sheet?: string;
    preview?: string;
  }>;
}

/**
 * Loads a saved plan and presents it as a flow.
 *
 * Row-level security does the authorisation: the query runs as the signed-in
 * user, so a plan id belonging to somebody else simply returns nothing rather
 * than needing an ownership check here.
 */
async function loadPlan(planId: string): Promise<YogaFlow | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('plans')
    .select('id, name, description, steps')
    .eq('id', planId)
    .maybeSingle();

  if (!data) return null;

  const steps = (data.steps as { pose_id: string; hold_seconds: number; rest_seconds: number }[])
    // Drop anything the app does not know about rather than sending it to the
    // backend, which would answer `idle` with nothing on screen to explain why.
    .filter((step) => Boolean(YOGA_POSE_BY_ID[step.pose_id]))
    .map((step) => ({
      poseId: step.pose_id,
      holdSeconds: step.hold_seconds,
      restSeconds: step.rest_seconds,
    }));

  if (steps.length === 0) return null;

  return {
    id: data.id as string,
    name: data.name as string,
    description: (data.description as string) ?? '',
    level: 'beginner',
    steps,
  };
}

export default async function SessionPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Validate against the catalog rather than trusting the URL: an unknown
  // label would leave the backend reporting `idle` with no way for the user
  // to tell that from "no pose selected".
  const poseId = params.pose && YOGA_POSE_BY_ID[params.pose] ? params.pose : undefined;
  const flowId = getYogaFlow(params.flow)?.id;
  const plan = params.plan ? await loadPlan(params.plan) : null;

  return (
    <Suspense>
      <LiveSession
        initialPoseId={poseId}
        initialFlowId={flowId}
        customFlow={plan ?? undefined}
        planId={plan?.id ?? null}
        initialMode={poseId && !flowId && !plan ? 'single' : 'flow'}
        openSheetOnLoad={params.sheet === '1' && Boolean(poseId)}
        preview={params.preview === '1'}
      />
    </Suspense>
  );
}
