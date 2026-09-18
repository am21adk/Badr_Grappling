/* Shared helpers for Cloudflare Pages Functions.
 * Runtime is Workers: fetch and Web Crypto only, no Node APIs.
 */

export const json = (status, data, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

export function need(env, ...keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) throw new ConfigError(`Missing environment variable: ${missing.join(', ')}`);
}
export class ConfigError extends Error {}

/* ---------- Supabase REST, with the service-role key ---------- */
export function supabase(env) {
  const base = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1`;
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  async function call(method, path, body, extra = {}) {
    const res = await fetch(`${base}/${path}`, {
      method,
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = data?.message || data?.hint || res.statusText;
      throw new Error(`Supabase ${method} ${path.split('?')[0]}: ${msg}`);
    }
    return data;
  }

  return {
    select: (path) => call('GET', path),
    // `onConflict` names the unique column a duplicate should be matched on.
    // Without it PostgREST only ignores primary-key clashes, and any other
    // unique violation comes back as a 409.
    insert: (table, row, { onConflict } = {}) =>
      call('POST', onConflict ? `${table}?on_conflict=${onConflict}` : table, row, {
        Prefer: `return=representation${onConflict ? ',resolution=ignore-duplicates' : ''}`,
      }),
    update: (pathWithFilter, patch) =>
      call('PATCH', pathWithFilter, patch, { Prefer: 'return=representation' }),
  };
}

/* ---------- Stripe, over plain fetch ---------- */

/** Flatten a nested object into Stripe's bracketed form encoding. */
export function stripeForm(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') stripeForm(item, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(item));
      });
    } else if (typeof v === 'object') {
      stripeForm(v, key, out);
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}

export async function stripe(env, method, path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? stripeForm(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${path} failed`);
  return data;
}

/**
 * Verify a Stripe-Signature header against the raw request body.
 * https://docs.stripe.com/webhooks#verify-manually
 */
export async function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v])
  );
  const t = parts.t;
  const sigs = header.split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.some((s) => timingSafeEqual(s, expected));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- email, via Resend ---------- */
export async function sendEmail(env, { to, subject, text, replyTo }) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not set' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'Badr Grappling <noreply@badrgrappling.co.uk>',
      to: Array.isArray(to) ? to : [to],
      subject,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) return { sent: false, reason: await res.text() };
  return { sent: true };
}

export const clip = (s, n) => String(s ?? '').trim().slice(0, n);
