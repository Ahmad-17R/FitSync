import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authCallbackUrl, siteOrigin } from '../siteUrl';

/**
 * These pin the fix for a host-header injection: the origin used in emailed
 * sign-in links must come from configuration, never from a request. A
 * regression here is not a cosmetic bug — it lets an attacker have Supabase
 * mail a victim a link pointing at the attacker's host.
 */
const KEYS = [
  'NEXT_PUBLIC_SITE_URL',
  'VERCEL_ENV',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_URL',
  'PORT',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('siteOrigin', () => {
  it('falls back to localhost when nothing is configured', () => {
    expect(siteOrigin()).toBe('http://localhost:3000');
  });

  it('respects a custom dev port', () => {
    process.env.PORT = '3001';
    expect(siteOrigin()).toBe('http://localhost:3001');
  });

  it('uses the production domain on a production deployment', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'web-kappa-liard.vercel.app';
    process.env.VERCEL_URL = 'web-somehash-scope.vercel.app';
    expect(siteOrigin()).toBe('https://web-kappa-liard.vercel.app');
  });

  it('returns to the preview that sent you, not to production', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'web-kappa-liard.vercel.app';
    process.env.VERCEL_URL = 'web-somehash-scope.vercel.app';
    expect(siteOrigin()).toBe('https://web-somehash-scope.vercel.app');
  });

  it('lets an explicit override win', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'web-kappa-liard.vercel.app';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://fitsync.app';
    expect(siteOrigin()).toBe('https://fitsync.app');
  });

  it('tolerates a trailing slash on the override', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://fitsync.app/';
    expect(siteOrigin()).toBe('https://fitsync.app');
  });
});

describe('authCallbackUrl', () => {
  it('always points at the callback route', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://fitsync.app';
    expect(authCallbackUrl('/home')).toBe(
      'https://fitsync.app/auth/callback?next=%2Fhome'
    );
  });

  it('encodes the destination', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://fitsync.app';
    expect(authCallbackUrl('/session?pose=tree&sheet=1')).toBe(
      'https://fitsync.app/auth/callback?next=%2Fsession%3Fpose%3Dtree%26sheet%3D1'
    );
  });

  it('cannot be steered by anything resembling a header value', () => {
    // The whole point: there is no input to this function that a request can
    // reach. Only configuration decides the host.
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'web-kappa-liard.vercel.app';
    expect(authCallbackUrl('/home')).toContain('https://web-kappa-liard.vercel.app/');
    expect(authCallbackUrl('/home')).not.toContain('evil');
  });
});
