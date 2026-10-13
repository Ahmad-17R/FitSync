import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isSupabaseConfigured } from '@/lib/supabase/config';

/**
 * Refreshes the Supabase session on every request.
 *
 * Auth tokens are short-lived. Server Components can read cookies but cannot
 * write them, so without this the token would expire and never renew, and a
 * signed-in user would silently become signed-out on their next navigation.
 *
 * This deliberately does NOT gate any route. FitSync is guest-first: the whole
 * live session works signed out, and the landing page promises exactly that
 * ("no account needed for your first flow"). Pages that need a user check for
 * one themselves and offer sign-in; nothing redirects at the edge.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // No credentials means no accounts, which is a supported way to run this
  // app rather than an error. Constructing a client here regardless is what
  // turned a missing environment variable into a 500 on every route.
  if (!isSupabaseConfigured()) return response;

  /*
   * Rescue an auth code that landed somewhere other than the callback.
   *
   * Supabase ignores `emailRedirectTo` when it is not in the project's
   * redirect allow-list and silently falls back to the Site URL, so a magic
   * link arrives as `/?code=...` instead of `/auth/callback?code=...`. Nothing
   * on the landing page reads that code, so the user clicks a valid link and
   * lands on a page that quietly does nothing.
   *
   * Forwarding it here means the flow completes anyway. It does not excuse a
   * wrong Site URL — if that points at another host entirely, the link never
   * reaches this app at all — but it removes the silent failure for every case
   * where it does.
   */
  const { pathname, searchParams } = request.nextUrl;
  if (searchParams.has('code') && !pathname.startsWith('/auth/')) {
    const callback = request.nextUrl.clone();
    callback.pathname = '/auth/callback';
    return NextResponse.redirect(callback);
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not remove: this call is what performs the refresh. Its result is
  // unused here on purpose.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the vendored MediaPipe runtime.
     * The wasm bundle and the 5.8 MB pose model are large and immutable —
     * running auth middleware over them would add a round trip to every
     * chunk for no benefit.
     */
    '/((?!_next/static|_next/image|favicon.ico|mediapipe|models|.*\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|task|wasm)$).*)',
  ],
};
