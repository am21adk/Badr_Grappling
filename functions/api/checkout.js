/* POST /api/checkout
 * Starts a Stripe Checkout session for a contribution to one appeal.
 * Public: no sign-in needed to support the club.
 */
import { json, need, supabase, stripe, clip, ConfigError } from '../_lib/util.js';

const MIN = 100;        // £1
const MAX = 1000000;    // £10,000

export async function onRequestPost({ request, env }) {
  try {
    need(env, 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY');
  } catch {
    return json(503, { error: 'Contributions are not switched on yet. Please try again soon.' });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid request.' }); }

  const amount = Math.round(Number(body.amount_pence));
  if (!Number.isInteger(amount) || amount < MIN || amount > MAX) {
    return json(400, { error: 'Please choose an amount between £1 and £10,000.' });
  }
  const recurring = body.recurring === true;
  const slug = clip(body.appeal, 120);
  if (!slug) return json(400, { error: 'No appeal selected.' });

  const db = supabase(env);

  try {
    const rows = await db.select(
      `appeals?slug=eq.${encodeURIComponent(slug)}&select=id,slug,title,is_active,deadline&limit=1`
    );
    const appeal = rows?.[0];
    if (!appeal || !appeal.is_active) return json(404, { error: 'That appeal is not open.' });
    if (appeal.deadline && Date.now() > new Date(`${appeal.deadline}T23:59:59Z`).getTime()) {
      return json(410, { error: 'That appeal has closed.' });
    }

    const origin = new URL(request.url).origin;
    const back = `${origin}/appeal.html?slug=${encodeURIComponent(appeal.slug)}`;
    const donationId = crypto.randomUUID();
    const name = clip(body.name, 120);
    const anonymous = body.anonymous === true;

    const metadata = {
      donation_id: donationId,
      appeal_id: appeal.id,
      appeal_slug: appeal.slug,
      donor_name: name,
      anonymous: String(anonymous),
    };

    const session = await stripe(env, 'POST', 'checkout/sessions', {
      mode: recurring ? 'subscription' : 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'gbp',
          unit_amount: amount,
          product_data: {
            name: `${recurring ? 'Monthly contribution' : 'Contribution'} to Badr Grappling`,
            description: appeal.title,
          },
          ...(recurring ? { recurring: { interval: 'month' } } : {}),
        },
      }],
      metadata,
      // Renewals arrive as invoice.paid; the subscription carries the appeal
      // with it so each month is attributed to the same appeal.
      ...(recurring
        ? { subscription_data: { metadata } }
        : { payment_intent_data: { metadata } }),
      custom_text: { submit: { message: 'Thank you for supporting Badr Grappling.' } },
      success_url: `${back}&thanks=1`,
      cancel_url: `${back}&cancelled=1`,
    });

    // Recorded as pending; the webhook marks it paid once Stripe confirms.
    await db.insert('donations', {
      id: donationId,
      appeal_id: appeal.id,
      amount_pence: amount,
      currency: 'gbp',
      is_recurring: recurring,
      donor_name: name || null,
      message: clip(body.message, 500) || null,
      is_anonymous: anonymous,
      status: 'pending',
      stripe_session_id: session.id,
    });

    return json(200, { url: session.url });
  } catch (err) {
    if (err instanceof ConfigError) return json(503, { error: 'Contributions are not switched on yet.' });
    console.error('[checkout]', err);
    return json(502, { error: 'Payment could not be started. Please try again.' });
  }
}
