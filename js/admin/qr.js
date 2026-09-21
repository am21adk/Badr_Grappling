/* Admin — the weekly check-in QR code for a branch.
 *
 * One code per branch per week. Opening this tab makes sure this week's
 * exists (the weekly cron job normally already has). The code is a link to
 * checkin.html?t=<token>; the token means nothing to anyone without a
 * member login, and stops working at midnight on Sunday.
 */
import { $, esc, sb, busy, dateLong } from '../core.js';
import { ask } from '../dialog.js';

let ctx, panel;

export async function init(c, p) {
  ctx = c; panel = p;
  await refresh();
}

export async function refresh() {
  panel.innerHTML = `<p class="load">Loading this week’s code…</p>`;
  const { data, error } = await sb.rpc('ensure_qr_token', { p_branch: ctx.branch.id });
  if (error) {
    panel.innerHTML = `<p class="empty">The code could not be loaded: ${esc(error.message)}</p>`;
    return;
  }
  await paint(data);
}

function loadLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/qrcode.js';
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => reject(new Error('QR library failed to load'));
    document.head.append(s);
  });
}

async function paint(tok) {
  const qrcode = await loadLib();
  const url = new URL(`checkin.html?t=${encodeURIComponent(tok.token)}`, location.href).href;

  // Error correction level M survives a crease or a bit of glare on a
  // printed sheet without making the code too dense to scan from a distance.
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 8, margin: 16, scalable: true, title: `Check-in code for ${ctx.branch.name}` });

  const monday = new Date(`${tok.week_start}T12:00`);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);

  panel.innerHTML = `
    <div class="split">
      <div>
        <div class="poster" id="qr-poster">
          <img src="assets/brand/badr-mark.png" alt="" width="72" height="72" style="margin:0 auto 1rem">
          <p class="eyebrow" style="justify-content:center">Badr Grappling &middot; ${esc(ctx.branch.name)}</p>
          <h2 class="h1" style="margin-bottom:1rem">Check in here</h2>
          <div class="qr-plate">${svg}</div>
          <p class="mt1"><strong>Point your phone camera at the code.</strong><br>
            Sign in if it asks, and you are on the register.</p>
          <p class="meta mt1">Valid ${esc(dateLong(monday))} – ${esc(dateLong(sunday))}</p>
        </div>
      </div>
      <div class="no-print">
        <h2 class="h3 mb1">This week’s code</h2>
        <p class="small">
          Print it and put it up at the venue, or show it full screen on a laptop or TV.
          It changes automatically every Monday — last week’s sheet stops working at midnight on Sunday.
        </p>
        <p class="small">
          Members can only check in once per session; scanning twice does nothing.
          Every scan appears on the Register tab with a QR label, and you can remove any of them there.
        </p>
        <div class="btn-row mt2">
          <button class="btn" type="button" id="qr-print">Print</button>
          <button class="btn btn-ghost" type="button" id="qr-full">Full screen</button>
        </div>
        <hr class="mt3 mb2">
        <h3 class="h3 mb1" style="font-size:1.05rem">Code shared outside the room?</h3>
        <p class="small">Issue a new one. The current code stops working straight away, so reprint or refresh the screen.</p>
        <button class="btn btn-sm btn-ghost mt1" type="button" id="qr-rotate">Issue a new code now</button>
        <details class="mt2">
          <summary class="small" style="cursor:pointer">Link inside the code</summary>
          <p class="tiny muted mt1" style="word-break:break-all">${esc(url)}</p>
        </details>
      </div>
    </div>`;

  $('#qr-print', panel).addEventListener('click', () => window.print());
  $('#qr-full', panel).addEventListener('click', () => {
    const el = $('#qr-poster', panel);
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  });
  $('#qr-rotate', panel).addEventListener('click', async (e) => {
    if (!(await ask({
      title: 'Issue a new code?',
      body: 'The one currently printed or on screen will stop working immediately.',
      confirm: 'Issue new code', danger: true,
    }))) return;
    busy(e.target, true, 'Issuing…');
    const { data, error } = await sb.rpc('rotate_qr_token', { p_branch: ctx.branch.id });
    if (error) { busy(e.target, false); ctx.flash(error.message, 'flag'); return; }
    ctx.flash('New code issued. Reprint the sheet or refresh the screen at the venue.', 'good');
    paint(data);
  });
}
