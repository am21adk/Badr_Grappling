/* Badr Grappling — QR check-in.
 *
 * The weekly QR code at the venue points here with ?t=<token>. Signed-out
 * members are sent to sign in and brought straight back. The token is
 * resolved on the server by checkin_with_token(); the browser never
 * decides whether a check-in counts.
 */
import { $, esc, sb, qp, requireMember, dateLong } from './core.js';

const out = $('#ci-out');
const token = (qp('t') || '').trim();

const ICON = {
  ok:   '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13.5l5.5 5.5L21 8"/></svg>',
  same: '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13h16"/></svg>',
  bad:  '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 7l12 12M19 7L7 19"/></svg>',
};

function show(kind, title, body, actions = '') {
  out.innerHTML = `
    <div class="ci-mark ${kind}" aria-hidden="true">${ICON[kind]}</div>
    <h1 class="h1">${esc(title)}</h1>
    <p class="lede mt1">${body}</p>
    ${actions ? `<div class="btn-row mt2">${actions}</div>` : ''}`;
}

if (!token) {
  show('bad', 'No code found',
    'Scan the QR code on the wall at the venue to check in. If you typed this address in, the code part is missing.',
    `<a class="btn" href="portal.html">Go to the portal</a>`);
} else {
  const me = await requireMember();   // signs them in and returns here if needed
  if (me) run(me);
}

async function run(me) {
  const { data, error } = await sb.rpc('checkin_with_token', { p_token: token });

  if (error) {
    show('bad', 'Check-in did not go through',
      'Something went wrong on our side. Tell the coach on the mat — they can add you to the register by hand.',
      `<a class="btn" href="${esc(location.href)}">Try again</a>`);
    return;
  }

  const first = esc((me.full_name || '').split(' ')[0] || '');
  const portal = `<a class="btn" href="portal.html">See your points</a>`;

  switch (data?.status) {
    case 'ok':
      show('ok', `You’re in${first ? `, ${first}` : ''}.`,
        `Checked in at <strong>${esc(data.branch)}</strong> for ${esc(data.session)} on ${esc(dateLong(data.date))}. Your points for this session have been added.`,
        portal);
      break;
    case 'already':
      show('same', 'Already checked in',
        `You are already on the register for today’s ${esc(data.session)} at ${esc(data.branch)}. Scanning again does not add anything.`,
        portal);
      break;
    case 'expired':
      show('bad', 'This code has expired',
        'QR codes change every week. Scan this week’s code, or ask the coach to add you to the register.');
      break;
    case 'invalid':
      show('bad', 'Code not recognised',
        'This does not match a current check-in code. Scan the one on the wall again, or ask the coach.');
      break;
    case 'not_active':
      show('bad', 'Membership not active',
        'Your membership is not active, so check-ins do not count. Speak to a coach on the mat today.');
      break;
    default:
      show('bad', 'Check-in did not go through',
        'Tell the coach on the mat — they can add you to the register by hand.');
  }
}
