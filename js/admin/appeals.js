/* Admin — fundraising appeals and what each has raised.
 *
 * Public copy for appeals talks about supporting or contributing to the
 * club. The club is not registered as a charity: keep charity and tax-relief
 * wording out of titles and descriptions written here too.
 */
import { $, $$, esc, sb, busy, money, dateShort, slugify } from '../core.js';
import { uploadImage } from './upload.js';

// Words that must not appear in public appeal copy (see the brief).
const BANNED = /\b(charit(y|ies|able)|tax[-\s]?deductible|gift\s?aid)\b/i;

let ctx, panel, appeals = [], totals = {}, editing = null;

export async function init(c, p) {
  ctx = c; panel = p;
  panel.innerHTML = `
    <div class="split">
      <div>
        <h2 class="h3 mb1">Appeals</h2>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th scope="col">Appeal</th><th scope="col" class="num">Raised</th><th scope="col">Status</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
            <tbody id="apl-list"><tr><td colspan="4" class="load">Loading…</td></tr></tbody>
          </table>
        </div>
        <div id="apl-dons" class="mt3"></div>
      </div>
      <div>
        <h2 class="h3 mb1" id="apl-heading">New appeal</h2>
        <form method="post" class="panel" id="apl-form" novalidate>
          <div class="field">
            <label for="apl-title">Title</label>
            <input id="apl-title" type="text" maxlength="120" required placeholder="e.g. New mats for London">
          </div>
          <div class="field">
            <label for="apl-slug">Web address</label>
            <input id="apl-slug" type="text" maxlength="70" required pattern="[a-z0-9-]+" aria-describedby="apl-slug-hint">
            <p class="hint" id="apl-slug-hint">appeal.html?slug=<span id="apl-slug-echo"></span></p>
          </div>
          <div class="field">
            <label for="apl-desc">Description</label>
            <textarea id="apl-desc" maxlength="5000" required aria-describedby="apl-desc-hint"></textarea>
            <p class="hint" id="apl-desc-hint">What the money is for and why it matters. Leave a blank line between paragraphs.
              Describe it as supporting or contributing to the club.</p>
          </div>
          <div class="field">
            <label for="apl-img">Image</label>
            <input id="apl-img" type="file" accept="image/jpeg,image/png,image/webp">
            <div id="apl-img-now" class="mt1"></div>
          </div>
          <div class="field">
            <label for="apl-alt">Describe the image</label>
            <input id="apl-alt" type="text" maxlength="200" aria-describedby="apl-alt-hint">
            <p class="hint" id="apl-alt-hint">Read aloud to people using a screen reader, e.g. “Members lined up on the new blue mats”.</p>
          </div>
          <div class="row-2">
            <div class="field">
              <label for="apl-target">Target (£)</label>
              <input id="apl-target" type="number" min="1" step="1" inputmode="numeric">
            </div>
            <div class="field">
              <label for="apl-deadline">Deadline</label>
              <input id="apl-deadline" type="date">
            </div>
          </div>
          <div class="field">
            <label for="apl-branch">For</label>
            <select id="apl-branch"></select>
          </div>
          <div class="check">
            <input id="apl-active" type="checkbox" checked>
            <label for="apl-active">Live on the site</label>
          </div>
          <div class="btn-row mt1">
            <button class="btn btn-sm" type="submit" id="apl-save">Create appeal</button>
            <button class="btn btn-sm btn-ghost" type="button" id="apl-cancel" hidden>Cancel</button>
          </div>
        </form>
      </div>
    </div>`;

  const slug = $('#apl-slug', panel);
  $('#apl-title', panel).addEventListener('input', (e) => {
    if (!editing && !slug.dataset.touched) slug.value = slugify(e.target.value);
    $('#apl-slug-echo', panel).textContent = slug.value;
  });
  slug.addEventListener('input', () => {
    slug.dataset.touched = '1';
    // Light cleanup while typing (a full slugify would eat the hyphen
    // you just typed); the proper clean-up happens on save.
    slug.value = slug.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    $('#apl-slug-echo', panel).textContent = slug.value;
  });
  $('#apl-form', panel).addEventListener('submit', save);
  $('#apl-cancel', panel).addEventListener('click', resetForm);
  await refresh();
}

export async function refresh() {
  // A super-admin can create club-wide appeals; a branch admin only for their branch.
  $('#apl-branch', panel).innerHTML =
    `<option value="${esc(ctx.branch.id)}">${esc(ctx.branch.name)}</option>` +
    (ctx.isSuper ? `<option value="">The whole club</option>` : '');

  let q = sb.from('appeals')
    .select('id, slug, title, description, image_url, image_alt, target_pence, deadline, branch_id, is_active, created_at')
    .order('created_at', { ascending: false });
  q = ctx.isSuper ? q.or(`branch_id.eq.${ctx.branch.id},branch_id.is.null`) : q.eq('branch_id', ctx.branch.id);
  const { data, error } = await q;
  if (error) { $('#apl-list', panel).innerHTML = `<tr><td colspan="4" class="muted">Could not load appeals.</td></tr>`; return; }
  appeals = data;

  const { data: t } = await sb.from('appeal_totals').select('appeal_id, raised_pence, donation_count')
    .in('appeal_id', appeals.map((a) => a.id).concat('00000000-0000-0000-0000-000000000000'));
  totals = Object.fromEntries((t || []).map((x) => [x.appeal_id, x]));

  if (!editing) resetForm();
  paintList();
}

function paintList() {
  const body = $('#apl-list', panel);
  if (!appeals.length) { body.innerHTML = `<tr><td colspan="4" class="muted">No appeals yet.</td></tr>`; return; }
  const today = new Date().toLocaleDateString('en-CA');
  body.innerHTML = appeals.map((a) => {
    const t = totals[a.id] || { raised_pence: 0, donation_count: 0 };
    const closed = a.deadline && a.deadline < today;
    const pct = a.target_pence ? Math.min(100, Math.round((t.raised_pence / a.target_pence) * 100)) : null;
    return `
      <tr data-id="${esc(a.id)}">
        <td><strong>${esc(a.title)}</strong><br>
          <span class="small muted">${a.branch_id ? esc(ctx.branch.name) : 'Whole club'}${a.deadline ? ` &middot; until ${esc(dateShort(a.deadline))}` : ''}</span>
          ${pct !== null ? `<div class="progress mt1" style="max-width:14rem"><i style="width:${pct}%"></i></div>` : ''}</td>
        <td class="num"><strong>${esc(money(t.raised_pence))}</strong>${a.target_pence ? `<br><span class="small muted">of ${esc(money(a.target_pence))}</span>` : ''}
          <br><span class="small muted">${t.donation_count} paid</span></td>
        <td>${!a.is_active ? '<span class="pill">Hidden</span>' : closed ? '<span class="pill">Closed</span>' : '<span class="pill pill-good">Live</span>'}</td>
        <td class="action-cell">
          <a class="linkish small" href="appeal.html?slug=${encodeURIComponent(a.slug)}" target="_blank" rel="noopener">View</a>
          <button class="linkish small" type="button" data-dons>Contributions</button>
          <button class="linkish small" type="button" data-edit>Edit</button>
        </td>
      </tr>`;
  }).join('');

  $$('[data-edit]', body).forEach((b) => b.addEventListener('click', () => startEdit(b.closest('tr').dataset.id)));
  $$('[data-dons]', body).forEach((b) => b.addEventListener('click', () => showDonations(b.closest('tr').dataset.id)));
}

async function showDonations(id) {
  const a = appeals.find((x) => x.id === id);
  const host = $('#apl-dons', panel);
  host.innerHTML = `<p class="load">Loading contributions…</p>`;
  const { data, error } = await sb.from('donations')
    .select('created_at, paid_at, amount_pence, is_recurring, donor_name, donor_email, is_anonymous, message, status')
    .eq('appeal_id', id).neq('status', 'pending')
    .order('created_at', { ascending: false }).limit(500);
  if (error) { host.innerHTML = `<p class="empty">Could not load contributions.</p>`; return; }

  const paid = data.filter((d) => d.status === 'paid');
  const sum = paid.reduce((n, d) => n + d.amount_pence, 0);
  host.innerHTML = `
    <div class="between mb1">
      <h3 class="h3">${esc(a.title)}: contributions</h3>
      <p class="small"><strong>${esc(money(sum))}</strong> from ${paid.length} ${paid.length === 1 ? 'payment' : 'payments'}</p>
    </div>
    ${data.length ? `<div class="table-scroll"><table class="table">
      <thead><tr><th scope="col">Date</th><th scope="col">From</th><th scope="col">Message</th><th scope="col" class="num">Amount</th><th scope="col">Status</th></tr></thead>
      <tbody>${data.map((d) => `
        <tr>
          <td class="nowrap small">${esc(dateShort(d.paid_at || d.created_at))}</td>
          <td class="small">${esc(d.donor_name || '—')}${d.is_anonymous ? ' <span class="pill">Keep private</span>' : ''}${d.donor_email ? `<br><span class="muted">${esc(d.donor_email)}</span>` : ''}</td>
          <td class="small">${esc(d.message || '')}</td>
          <td class="num">${esc(money(d.amount_pence))}${d.is_recurring ? '<br><span class="small muted">monthly</span>' : ''}</td>
          <td><span class="pill ${d.status === 'paid' ? 'pill-good' : d.status === 'refunded' ? 'pill-flag' : ''}">${esc(d.status)}</span></td>
        </tr>`).join('')}</tbody></table></div>`
      : `<p class="empty">No contributions yet.</p>`}
    <p class="hint mt1">Names marked “Keep private” asked not to be shown publicly. Refunds are made in the Stripe dashboard and update here automatically.</p>`;
  host.scrollIntoView({ block: 'start' });
}

function startEdit(id) {
  const a = appeals.find((x) => x.id === id);
  editing = a;
  $('#apl-heading', panel).textContent = 'Edit appeal';
  $('#apl-title', panel).value = a.title;
  $('#apl-slug', panel).value = a.slug;
  $('#apl-slug-echo', panel).textContent = a.slug;
  $('#apl-desc', panel).value = a.description || '';
  $('#apl-alt', panel).value = a.image_alt || '';
  $('#apl-target', panel).value = a.target_pence ? a.target_pence / 100 : '';
  $('#apl-deadline', panel).value = a.deadline || '';
  $('#apl-branch', panel).value = a.branch_id || '';
  $('#apl-active', panel).checked = a.is_active;
  $('#apl-img-now', panel).innerHTML = a.image_url
    ? `<img class="thumb-sm" src="${esc(a.image_url)}" alt=""> <span class="small muted">Current image. Choose a file to replace it.</span>` : '';
  $('#apl-save', panel).textContent = 'Save changes';
  $('#apl-cancel', panel).hidden = false;
  $('#apl-title', panel).focus();
}

function resetForm() {
  editing = null;
  $('#apl-form', panel).reset();
  delete $('#apl-slug', panel).dataset.touched;
  $('#apl-slug-echo', panel).textContent = '';
  $('#apl-img-now', panel).innerHTML = '';
  $('#apl-heading', panel).textContent = 'New appeal';
  $('#apl-save', panel).textContent = 'Create appeal';
  $('#apl-cancel', panel).hidden = true;
  $('#apl-branch', panel).value = ctx.branch.id;
  $('#apl-active', panel).checked = true;
}

async function save(e) {
  e.preventDefault();
  const title = $('#apl-title', panel).value.trim();
  const slug = slugify($('#apl-slug', panel).value);
  const description = $('#apl-desc', panel).value.trim();
  const target = $('#apl-target', panel).value;
  if (!title || !slug || !description) return ctx.flash('An appeal needs a title, a web address and a description.', 'flag');
  if (BANNED.test(`${title} ${description}`)) {
    return ctx.flash('Badr Grappling is not a registered charity, so appeal copy cannot mention charity, charitable giving, Gift Aid or tax relief. Describe it as supporting or contributing to the club.', 'flag');
  }
  if (target && !(Number(target) >= 1)) return ctx.flash('The target must be at least £1, or left empty.', 'flag');

  const btn = $('#apl-save', panel);
  busy(btn, true, 'Saving…');
  try {
    const file = $('#apl-img', panel).files[0];
    const alt = $('#apl-alt', panel).value.trim();
    // Checked before uploading, so a missing description never leaves an
    // orphaned file in storage.
    if ((file || editing?.image_url) && !alt) {
      throw new Error('Describe the image in a few words, for people using a screen reader.');
    }
    const image_url = file ? await uploadImage(file, 'appeals') : (editing?.image_url ?? null);
    const row = {
      title, slug, description, image_url,
      image_alt: image_url ? alt : null,
      target_pence: target ? Math.round(Number(target) * 100) : null,
      deadline: $('#apl-deadline', panel).value || null,
      branch_id: $('#apl-branch', panel).value || null,
      is_active: $('#apl-active', panel).checked,
    };
    const { error } = editing
      ? await sb.from('appeals').update(row).eq('id', editing.id)
      : await sb.from('appeals').insert(row);
    if (error) throw new Error(error.code === '23505' ? 'Another appeal already uses that web address.' : error.message);
    busy(btn, false);
    ctx.flash(editing ? 'Appeal updated.' : `“${title}” created${row.is_active ? ' and live on the Fundraise page' : ''}.`, 'good');
    editing = null;
    await refresh();
  } catch (err) {
    busy(btn, false);
    ctx.flash(err.message, 'flag');
  }
}
