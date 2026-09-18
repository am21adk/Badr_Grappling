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

  if (!name)  return fail('Please enter your full name.', '#j-name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Please enter a valid email address.', '#j-email');
  if (password.length < 8) return fail('Your password needs at least 8 characters.', '#j-pass');
  if (!$('#j-terms').checked) return fail('Please read and agree to the participation terms.', '#j-terms');

  busy(btn, true, 'Creating account…');
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      // The on_auth_user_created trigger reads these to create the
      // pending member row, on the right branch.
      data: { full_name: name, phone, branch_slug: pick.value },
      emailRedirectTo: new URL('login.html?confirmed=1', location.href).href,
    },
  });
  busy(btn, false);

  if (error) return fail(error.message);

  form.reset();
  form.hidden = true;
  const needsConfirm = !data.session;
  say(msg,
    needsConfirm
      ? `Account created. We have sent a confirmation link to ${email} — open it to finish. `
        + 'A coach then approves your membership once you have trained with us.'
      : 'Account created. A coach approves new members once they have trained with us — '
        + 'the portal opens up as soon as they do.',
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
