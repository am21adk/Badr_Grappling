/* Badr Grappling — appeals list, single appeal and the donation form.
 *
 * Copy on these pages describes giving as donating to or supporting the
 * club. The club is not registered as a charity, so no charity wording —
 * and no tax-relief or Gift Aid wording — appears anywhere here.
 */
import { $, $$, esc, sb, qp, say, busy, money, dateLong, paragraphs } from './core.js';

const PRESETS = [1000, 2500, 5000, 10000];   // pence
const MIN = 100;                             // £1
const MAX = 1000000;                         // £10,000

/* ---------- shared ---------- */
async function totalsFor(ids) {
  if (!ids.length) return {};
  const { data } = await sb.from('appeal_totals')
    .select('appeal_id, raised_pence, donation_count')
    .in('appeal_id', ids);
  return Object.fromEntries((data || []).map((t) => [t.appeal_id, t]));
}

function isClosed(a) {
  if (!a.deadline) return false;
  // A deadline is inclusive: the appeal is open for the whole of that day.
  const end = new Date(a.deadline + 'T23:59:59');
  return Date.now() > end.getTime();
}

function progress(a, t) {
  const raised = t?.raised_pence || 0;
  const count = t?.donation_count || 0;
  if (!a.target_pence) {
    return `<p class="appeal-fig"><span><b>${esc(money(raised))}</b> raised</span>
      <span class="muted">${count} ${count === 1 ? 'donation' : 'donations'}</span></p>`;
  }
  const pct = Math.min(100, Math.round((raised / a.target_pence) * 100));
  return `
    <div class="appeal-bar">
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"
           aria-label="${esc(money(raised))} of ${esc(money(a.target_pence))} raised"><i style="width:${pct}%"></i></div>
    </div>
    <p class="appeal-fig">
      <span><b>${esc(money(raised))}</b> of ${esc(money(a.target_pence))}</span>
      <span class="muted">${pct}% &middot; ${count} ${count === 1 ? 'donation' : 'donations'}</span>
    </p>`;
}

function deadlineLine(a) {
  if (!a.deadline) return '';
  return isClosed(a)
    ? `<p class="meta mt1">Closed ${esc(dateLong(a.deadline))}</p>`
    : `<p class="meta mt1">Open until ${esc(dateLong(a.deadline))}</p>`;
}

/* =====================================================
   Appeals list  (donate.html)
   ===================================================== */
async function paintList() {
  const host = $('#appeals');
  const { data, error } = await sb.from('appeals')
    .select('id, slug, title, description, image_url, target_pence, deadline')
    .eq('is_active', true)
    .order('sort_order').order('created_at', { ascending: false });

  if (error) {
    host.innerHTML = `<p class="empty">Appeals are unavailable right now.</p>`;
    return;
  }
  if (!data.length) {
    host.innerHTML = `<p class="empty">There are no open appeals at the moment.</p>`;
    return;
  }

  const totals = await totalsFor(data.map((a) => a.id));
  host.innerHTML = data.map((a) => `
    <a class="tile panel" href="appeal.html?slug=${encodeURIComponent(a.slug)}" style="padding:0">
      ${a.image_url
        ? `<div class="tile-img"><img src="${esc(a.image_url)}" alt="" loading="lazy"></div>`
        : ''}
      <div style="padding:1.5rem">
        <h2 class="tile-title">${esc(a.title)}</h2>
        <p class="small muted">${esc(String(a.description || '').split(/\n\s*\n/)[0].slice(0, 200))}</p>
        ${progress(a, totals[a.id])}
        ${deadlineLine(a)}
        <p class="mt1"><span class="link">${isClosed(a) ? 'See how it went' : 'Donate'}</span></p>
      </div>
    </a>`).join('');
}

/* =====================================================
   Single appeal  (appeal.html)
   ===================================================== */
async function paintAppeal() {
  const slug = qp('slug');
  const host = $('#a-body');
  const msg = $('#a-msg');

  if (qp('thanks'))    say(msg, 'Thank you. Your donation has gone through, and Stripe has emailed you a receipt.', 'good');
  if (qp('cancelled')) say(msg, 'Payment cancelled — nothing has been taken.', '');

  const { data: a, error } = await sb.from('appeals')
    .select('id, slug, title, description, image_url, image_alt, target_pence, deadline, is_active')
    .eq('slug', slug || '')
    .maybeSingle();

  if (error || !a) {
    $('#a-title').textContent = 'Appeal not found';
    host.innerHTML = `<p class="empty">We could not find that appeal. <a class="link" href="donate.html">See open appeals</a>.</p>`;
    return;
  }

  document.title = `${a.title} — Fundraise — Badr Grappling`;
  $('#a-title').textContent = a.title;
  const totals = await totalsFor([a.id]);
  const closed = isClosed(a) || !a.is_active;

  host.innerHTML = `
    <div>
      ${a.image_url ? `<div class="appeal-hero mb2"><img src="${esc(a.image_url)}" alt="${esc(a.image_alt || '')}"></div>` : ''}
      ${progress(a, totals[a.id])}
      ${deadlineLine(a)}
      <div class="mt2">${paragraphs(a.description)}</div>
    </div>
    <div class="panel">
      ${closed ? `
        <h2 class="h3 mb1">This appeal has closed</h2>
        <p class="small">Thank you to everyone who donated.
          <a class="link" href="donate.html">See open appeals</a>.</p>` : `
      <h2 class="h3 mb1">Donate to this appeal</h2>
      <form method="post" id="give-form" novalidate>
        <fieldset>
          <legend class="sr">How often</legend>
          <div class="freq">
            <button class="chip" type="button" data-freq="once" aria-pressed="true">One-off</button>
            <button class="chip" type="button" data-freq="monthly" aria-pressed="false">Monthly</button>
          </div>
        </fieldset>
        <fieldset>
          <legend class="sr">Amount</legend>
          <div class="amounts">
            ${PRESETS.map((p, i) => `<button class="chip" type="button" data-amount="${p}" aria-pressed="${i === 1}">${esc(money(p))}</button>`).join('')}
          </div>
          <div class="field mt1">
            <label for="g-custom">Or enter an amount</label>
            <div class="money-in"><span aria-hidden="true">£</span>
              <input id="g-custom" type="number" inputmode="decimal" min="1" max="10000" step="1" placeholder="Other">
            </div>
          </div>
        </fieldset>
        <div class="field">
          <label for="g-name">Your name <span class="muted">(optional)</span></label>
          <input id="g-name" type="text" autocomplete="name">
        </div>
        <div class="field">
          <label for="g-note">A message to the club <span class="muted">(optional)</span></label>
          <textarea id="g-note" maxlength="500" style="min-height:5rem"></textarea>
        </div>
        <div class="check">
          <input id="g-anon" type="checkbox">
          <label for="g-anon">Keep my name private</label>
        </div>
        <button class="btn mt1" type="submit" id="g-submit" style="width:100%">Continue to payment</button>
        <p class="hint mt1" id="g-summary"></p>
        <p class="hint">You will be taken to Stripe to pay securely.</p>
      </form>`}
    </div>`;

  if (!closed) wireForm(a, msg);
}

function wireForm(a, msg) {
  let freq = 'once';
  let amount = PRESETS[1];
  const custom = $('#g-custom');
  const summary = $('#g-summary');

  const paint = () => {
    summary.textContent = amount >= MIN
      ? `${money(amount)}${freq === 'monthly' ? ' every month' : ' once'}, towards ${a.title}.`
      : '';
  };

  $$('[data-freq]').forEach((b) => b.addEventListener('click', () => {
    freq = b.dataset.freq;
    $$('[data-freq]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    paint();
  }));

  $$('[data-amount]').forEach((b) => b.addEventListener('click', () => {
    amount = Number(b.dataset.amount);
    custom.value = '';
    $$('[data-amount]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    paint();
  }));

  custom.addEventListener('input', () => {
    const v = Math.round(parseFloat(custom.value) * 100);
    amount = Number.isFinite(v) ? v : 0;
    $$('[data-amount]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    paint();
  });

  paint();

  $('#give-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(amount >= MIN && amount <= MAX)) {
      say(msg, 'Please choose an amount between £1 and £10,000.', 'flag');
      custom.focus();
      return;
    }
    const btn = $('#g-submit');
    busy(btn, true, 'Opening Stripe…');
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appeal: a.slug,
          amount_pence: amount,
          recurring: freq === 'monthly',
          name: $('#g-name').value.trim(),
          message: $('#g-note').value.trim(),
          anonymous: $('#g-anon').checked,
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.url) throw new Error(out.error || 'Payment could not be started.');
      location.href = out.url;
    } catch (err) {
      busy(btn, false);
      say(msg, err.message, 'flag');
      msg.scrollIntoView({ block: 'center' });
    }
  });
}

/* ---------- boot ---------- */
if ($('#appeals')) paintList();
if ($('#a-body')) paintAppeal();
