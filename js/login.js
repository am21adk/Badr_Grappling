/* Badr Grappling — sign in, pending-approval notice, password recovery. */
import { $, sb, qp, say, busy, currentUser, currentProfile } from './core.js';

const msg = $('#login-msg');
const loginForm = $('#login-form');
const resetForm = $('#reset-form');

/**
 * Only ever follow a `next` that points back into this site. An absolute
 * URL in the query string would otherwise turn the login page into an
 * open redirect.
 */
function safeNext() {
  const raw = qp('next');
  if (!raw) return 'portal.html';
  try {
    const u = new URL(raw, location.href);
    if (u.origin !== location.origin) return 'portal.html';
    return u.pathname.replace(/^\//, '') + u.search + u.hash || 'portal.html';
  } catch {
    return 'portal.html';
  }
}

async function routeSignedIn() {
  const profile = await currentProfile({ fresh: true });
  if (!profile) {
    say(msg, 'Your account exists but has no member record yet. Please contact the club.', 'flag');
    return;
  }
  if (profile.status === 'pending') {
    say(msg,
      'Thanks for registering. A coach needs to approve your membership before the portal opens, '
      + 'usually once you have trained with us. You will be able to sign in as soon as they have.', '');
    loginForm.hidden = true;
    return;
  }
  if (profile.status === 'inactive') {
    say(msg, 'This membership is not currently active. Please speak to a coach if you think that is wrong.', 'flag');
    loginForm.hidden = true;
    return;
  }
  location.replace(safeNext());
}

/* ---------- arrival states ---------- */
if (qp('confirmed')) say(msg, 'Email confirmed. Sign in below.', 'good');
if (qp('pending'))   say(msg, 'Your membership is waiting for a coach to approve it.', '');

// A reset link lands here with a recovery session.
sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    loginForm.hidden = true;
    resetForm.hidden = false;
    $('#login-title').textContent = 'Choose a new password';
    say(msg, '');
    $('#r-pass').focus();
  }
});

/* ---------- sign in ---------- */
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#l-email').value.trim();
  const password = $('#l-pass').value;
  if (!email || !password) {
    say(msg, 'Enter your email and password.', 'flag');
    return;
  }
  const btn = $('#l-submit');
  busy(btn, true, 'Signing in…');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  busy(btn, false);
  if (error) {
    say(msg, error.message === 'Invalid login credentials'
      ? 'That email and password do not match an account.' : error.message, 'flag');
    return;
  }
  await routeSignedIn();
});

/* ---------- forgotten password ---------- */
$('#l-forgot').addEventListener('click', async () => {
  const email = $('#l-email').value.trim();
  if (!email) {
    say(msg, 'Type your email address above first, then press "Forgotten your password?" again.', '');
    $('#l-email').focus();
    return;
  }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('login.html', location.href).href,
  });
  // Same message either way, so the form does not reveal who has an account.
  say(msg, error && error.status !== 400
    ? 'Something went wrong sending the reset email. Please try again shortly.'
    : `If ${email} has an account, a reset link is on its way.`, error && error.status !== 400 ? 'flag' : 'good');
});

/* ---------- set new password ---------- */
resetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('#r-pass').value;
  if (password.length < 8) {
    say(msg, 'Your password needs at least 8 characters.', 'flag');
    return;
  }
  const btn = $('#r-submit');
  busy(btn, true, 'Saving…');
  const { error } = await sb.auth.updateUser({ password });
  busy(btn, false);
  if (error) {
    say(msg, error.message, 'flag');
    return;
  }
  say(msg, 'Password updated.', 'good');
  await routeSignedIn();
});

// Already signed in (and not mid-recovery)? Send them on. This runs last so
// the form above is wired up before anything waits on the network.
if (!location.hash.includes('type=recovery') && !qp('pending')) {
  const user = await currentUser();
  if (user) await routeSignedIn();
}
