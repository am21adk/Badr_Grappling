/* POST /api/stripe-webhook
 *
 * Stripe is the only thing that can mark a donation as paid. Events:
 *   checkout.session.completed / async_payment_succeeded -> first payment paid
 *   checkout.session.async_payment_failed / expired      -> failed
 *   invoice.paid (subscription_cycle)                    -> a monthly renewal
 *   charge.refunded                                      -> refunded
 *
 * Every handler is idempotent: Stripe retries, and a retry must not count
 * the same money twice.
 */
import { json, need, supabase, verifyStripeSignature } from '../_lib/util.js';

export async function onRequestPost({ request, env }) {
  try {
    need(env, 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_WEBHOOK_SECRET');
  } catch {
    return json(503, { error: 'Webhook not configured' });
  }

  // The signature is over the exact bytes Stripe sent, so read the raw text.
  const raw = await request.text();
  const ok = await verifyStripeSignature(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return json(400, { error: 'Bad signature' });

  const event = JSON.parse(raw);
  const db = supabase(env);
  const obj = event.data?.object || {};

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        if (obj.payment_status === 'paid') await markSessionPaid(db, obj);
        break;

      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        await db.update(
          `donations?stripe_session_id=eq.${encodeURIComponent(obj.id)}&status=eq.pending`,
          { status: 'failed' }
        );
        break;

      case 'invoice.paid':
        // The first invoice of a subscription is already counted by
        // checkout.session.completed. Only renewals are new money.
        if (obj.billing_reason === 'subscription_cycle') await recordRenewal(db, obj);
        break;

      case 'charge.refunded':
        if (obj.payment_intent && obj.refunded) {
          await db.update(
            `donations?stripe_payment_intent=eq.${encodeURIComponent(obj.payment_intent)}`,
            { status: 'refunded' }
          );
        }
        break;

      default:
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook]', event.type, err);
    // 500 makes Stripe retry, which is what we want for a transient failure.
    return json(500, { error: 'Handler failed' });
  }

  return json(200, { received: true });
}

async function markSessionPaid(db, s) {
  const patch = {
    status: 'paid',
    paid_at: new Date().toISOString(),
    donor_email: s.customer_details?.email || null,
    stripe_payment_intent: typeof s.payment_intent === 'string' ? s.payment_intent : null,
    stripe_subscription: typeof s.subscription === 'string' ? s.subscription : null,
  };

  const updated = await db.update(
    `donations?stripe_session_id=eq.${encodeURIComponent(s.id)}&status=neq.paid`,
    patch
  );

  // If the pending row never got written (the checkout function failed
  // between creating the session and saving the row), rebuild it from the
  // session metadata so the money is still attributed to its appeal.
  if (!updated?.length) {
    const existing = await db.select(
      `donations?stripe_session_id=eq.${encodeURIComponent(s.id)}&select=id&limit=1`
    );
    if (existing?.length) return;       // already paid — a retry
    const m = s.metadata || {};
    await db.insert('donations', {
      ...(m.donation_id ? { id: m.donation_id } : {}),
      appeal_id: m.appeal_id || null,
      amount_pence: s.amount_total,
      currency: s.currency || 'gbp',
      is_recurring: s.mode === 'subscription',
      donor_name: m.donor_name || null,
      is_anonymous: m.anonymous === 'true',
      stripe_session_id: s.id,
      ...patch,
    }, { onConflict: 'stripe_session_id' });
  }
}

async function recordRenewal(db, inv) {
  // Stripe moved subscription details under `parent` in newer API
  // versions; read both so an API upgrade does not break attribution.
  const sub = inv.subscription_details || inv.parent?.subscription_details || {};
  const subscriptionId = inv.subscription || sub.subscription || null;
  const m = sub.metadata || {};

  await db.insert('donations', {
    appeal_id: m.appeal_id || null,
    amount_pence: inv.amount_paid,
    currency: inv.currency || 'gbp',
    is_recurring: true,
    donor_name: m.donor_name || null,
    donor_email: inv.customer_email || null,
    is_anonymous: m.anonymous === 'true',
    status: 'paid',
    paid_at: new Date().toISOString(),
    stripe_invoice_id: inv.id,
    stripe_payment_intent: typeof inv.payment_intent === 'string' ? inv.payment_intent : null,
    stripe_subscription: subscriptionId,
  }, { onConflict: 'stripe_invoice_id' });   // a retried renewal is a no-op
}
