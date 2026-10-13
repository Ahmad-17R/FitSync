/**
 * Whether accounts are configured at all.
 *
 * FitSync is guest-first: the entire live session works signed out, and the
 * landing page promises exactly that. So a deployment with no Supabase
 * credentials should be a fully working guest-only app, not a 500 — which is
 * what it was until this existed, because the middleware constructed a client
 * on every request and threw when the URL was undefined.
 *
 * Everything that touches Supabase checks this first and degrades to the
 * signed-out path.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
