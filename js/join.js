/* Badr Grappling — join page: class times and member registration. */
import { $, esc, sb, say, busy, onBranch, loadBranches, activeBranch, clockTime, dayName } from './core.js';

/* ---------- class times for the selected branch ---------- */
onBranch((branch) => {
  const body = $('#join-times');
  if (!body) return;
  if (!branch.id) {
    body.innerHTML = `<tr><td colspan="3" class="muted">Class times are unavailable right now.</td></tr>`;
    return;
  }
  sb.from('class_times')
    .select('label, age_group, weekday, starts_at, ends_at')
    .eq('branch_id', branch.id).eq('is_active', true)
    .order('weekday').order('starts_at')
    .then(({ data, error }) => {
      body.innerHTML = (error || !data?.length)
        ? `<tr><td colspan="3" class="muted">No classes listed for ${esc(branch.name)} yet.</td></tr>`
        : data.map((c) => `
          <tr>
            <td>${esc(c.label)}${c.age_group ? ` <span class="pill">${esc(c.age_group)}</span>` : ''}</td>
            <td>${esc(dayName(c.weekday))}</td>
            <td class="time">${esc(clockTime(c.starts_at))}–${esc(clockTime(c.ends_at))}</td>
          </tr>`).join('');
    });
});

/* ---------- registration ---------- */
const form = $('#join-form');
const msg = $('#join-msg');
const btn = $('#j-submit');
const pick = $('#j-branch');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  say(msg, '');

  const name = $('#j-name').value.trim();
  const email = $('#j-email').value.trim();
  const phone = $('#j-phone').value.trim();
  const password = $('#j-pass').value;
  const again = $('#j-pass2').value;

  if (!name)  return fail('Please enter your full name.', '#j-name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Please enter a valid email address.', '#j-email');
  if (password.length < 8) return fail('Your password needs at least 8 characters.', '#j-pass');
  if (!again) return fail('Please type your password again to confirm it.', '#j-pass2');
  if (again !== password) return fail('The passwords do not match. Please type the same one in both boxes.', '#j-pass2');
  if (!$('#j-terms').checked) return fail('Please read and agree to the participation terms.', '#j-terms');

  busy(btn, true, 'Creating account…');
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      // The on_auth_user_created trigger reads these to create the
      // member row, on the right branch.
      data: { full_name: name, phone, branch_slug: pick.value },
      emailRedirectTo: new URL('login.html?confirmed=1', location.href).href,
    },
  });
  busy(btn, false);

  if (error) {
    const m = error.message || '';
    if (error.code === 'user_already_exists' || /already registered/i.test(m)) {
      return fail('There is already an account with that email. Sign in instead, or use "Forgotten your password?" on the sign-in page.');
    }
    if (/rate limit/i.test(m)) {
      // The club's email service only allows so many messages an hour.
      return fail('We could not send your confirmation email just now — too many have gone out in the last hour. '
        + 'Please try again later, or speak to a coach and they will set your account up.');
    }
    return fail(m);
  }

  // Signed in already (email confirmation is off): straight into the portal.
  // replace(), so Back does not land on a form that has been submitted.
  if (data.session) {
    location.replace('portal.html?welcome=1');
    return;
  }

  // Email confirmation is on, so there is no session until they click the link.
  form.reset();
  form.hidden = true;
  say(msg,
    `Account created. We have sent a confirmation link to ${email} — open it, `
      + 'then sign in and the member portal is yours.',
    'good');
  msg.scrollIntoView({ block: 'center' });
});

function fail(text, focusSel) {
  say(msg, text, 'flag');
  if (focusSel) $(focusSel)?.focus();
}

/* ---------- branch picker in the form ----------
   Filled in last: the submit handler above is already attached, so the
   form works even while this waits on the network. */
const list = await loadBranches();
const active = await activeBranch();
pick.innerHTML = list
  .map((b) => `<option value="${esc(b.slug)}"${b.slug === active.slug ? ' selected' : ''}>${esc(b.name)}</option>`)
  .join('');
document.addEventListener('branchchange', (e) => { pick.value = e.detail.slug; });
