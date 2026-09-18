/* Badr Grappling — "Open a branch" enquiry form. */
import { $, say, busy } from './core.js';

const form = $('#enquiry-form');
const msg = $('#e-msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());

  if (!data.name?.trim()) return fail('Please give your name.', '#e-name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email?.trim() || '')) return fail('Please give a valid email address.', '#e-email');
  if (!data.city?.trim()) return fail('Please tell us which city.', '#e-city');

  const btn = $('#e-submit');
  busy(btn, true, 'Sending…');
  try {
    const res = await fetch('/api/enquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Your enquiry could not be sent.');
    form.hidden = true;
    say(msg, `Thank you, ${data.name.trim().split(' ')[0]}. Your enquiry has reached the club and someone will be in touch.`, 'good');
    msg.focus?.();
    msg.scrollIntoView({ block: 'center' });
  } catch (err) {
    busy(btn, false);
    fail(`${err.message} You can also email badrgrappling@outlook.com directly.`);
  }
});

function fail(text, focusSel) {
  say(msg, text, 'flag');
  if (focusSel) $(focusSel)?.focus();
}
