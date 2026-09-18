/* POST /api/enquiry
 * "Open a branch" form. Saves the enquiry for the admin panel and emails
 * it to the club. Everything goes through here rather than straight into
 * the table, so the spam trap applies to every submission.
 */
import { json, need, supabase, sendEmail, clip } from '../_lib/util.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function onRequestPost({ request, env }) {
  try {
    need(env, 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  } catch {
    return json(503, { error: 'The form is not switched on yet. Please email us instead.' });
  }

  let b;
  try { b = await request.json(); } catch { return json(400, { error: 'Invalid request.' }); }

  // Honeypot: a field people never see. Bots fill it; pretend it worked.
  if (clip(b.website, 200)) return json(200, { ok: true });

  const row = {
    name: clip(b.name, 120),
    email: clip(b.email, 200).toLowerCase(),
    phone: clip(b.phone, 40) || null,
    city: clip(b.city, 120),
    grappling_background: clip(b.grappling_background, 3000) || null,
    coaching_experience: clip(b.coaching_experience, 3000) || null,
    facility_access: clip(b.facility_access, 3000) || null,
    why: clip(b.why, 3000) || null,
  };

  if (!row.name || !row.city) return json(400, { error: 'Please give your name and city.' });
  if (!EMAIL_RE.test(row.email)) return json(400, { error: 'Please give a valid email address.' });

  try {
    await supabase(env).insert('branch_enquiries', row);
  } catch (err) {
    console.error('[enquiry] save failed', err);
    return json(502, { error: 'Your enquiry could not be saved. Please try again, or email us.' });
  }

  const text = [
    `New "open a branch" enquiry — ${row.city}`,
    '',
    `Name:   ${row.name}`,
    `Email:  ${row.email}`,
    `Phone:  ${row.phone || '—'}`,
    `City:   ${row.city}`,
    '',
    'Grappling background',
    row.grappling_background || '—',
    '',
    'Coaching experience',
    row.coaching_experience || '—',
    '',
    'Facility access',
    row.facility_access || '—',
    '',
    'Why they want to open one',
    row.why || '—',
    '',
    'This enquiry is also in the admin panel under Enquiries.',
  ].join('\n');

  // Saved either way; an email failure should not lose the enquiry.
  const mail = await sendEmail(env, {
    to: env.CLUB_EMAIL || 'badrgrappling@outlook.com',
    subject: `Open a branch: ${row.city} — ${row.name}`,
    text,
    replyTo: row.email,
  });
  if (!mail.sent) console.warn('[enquiry] email not sent:', mail.reason);

  return json(200, { ok: true });
}
