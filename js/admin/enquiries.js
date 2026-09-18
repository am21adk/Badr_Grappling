/* Admin (super-admin only) — "Open a branch" enquiries.
 * Each one is also emailed to the club address when it arrives.
 */
import { $, $$, esc, sb, dateShort } from '../core.js';

let ctx, panel, rows = [];

export async function init(c, p) {
  ctx = c; panel = p;
  panel.innerHTML = `
    <div class="between mb1">
      <h2 class="h3">Enquiries about opening a branch</h2>
      <div class="field mb0">
        <label class="sr" for="eq-status">Show</label>
        <select id="eq-status">
          <option value="open">New and in progress</option>
          <option value="new">New</option>
          <option value="reviewing">In progress</option>
          <option value="closed">Closed</option>
          <option value="">All</option>
        </select>
      </div>
    </div>
    <div id="eq-list"><p class="load">Loading…</p></div>`;
  $('#eq-status', panel).addEventListener('change', paint);
  await refresh();
}

export async function refresh() {
  const { data, error } = await sb.from('branch_enquiries').select('*').order('created_at', { ascending: false }).limit(300);
  if (error) { $('#eq-list', panel).innerHTML = `<p class="empty">Could not load enquiries.</p>`; return; }
  rows = data;
  paint();
}

function paint() {
  const host = $('#eq-list', panel);
  const f = $('#eq-status', panel).value;
  const shown = rows.filter((r) => !f || (f === 'open' ? r.status !== 'closed' : r.status === f));
  if (!shown.length) { host.innerHTML = `<p class="empty">No enquiries here.</p>`; return; }

  const field = (label, v) => v ? `<dt>${label}</dt><dd>${esc(v)}</dd>` : '';
  host.innerHTML = shown.map((r) => `
    <details class="claim-card" data-id="${esc(r.id)}"${r.status === 'new' ? ' open' : ''}>
      <summary style="cursor:pointer;list-style:none" class="between">
        <span><strong>${esc(r.city)}</strong> &middot; ${esc(r.name)}</span>
        <span class="flex" style="gap:.5rem">
          <span class="pill ${r.status === 'new' ? 'pill-brass' : r.status === 'closed' ? '' : 'pill-good'}">${esc({ new: 'New', reviewing: 'In progress', closed: 'Closed' }[r.status] || r.status)}</span>
          <span class="meta">${esc(dateShort(r.created_at))}</span>
        </span>
      </summary>
      <dl class="kv mt2">
        <dt>Email</dt><dd><a class="link" href="mailto:${esc(r.email)}?subject=${encodeURIComponent(`Badr Grappling ${r.city}`)}">${esc(r.email)}</a></dd>
        ${field('Phone', r.phone)}
        ${field('Background', r.grappling_background)}
        ${field('Coaching', r.coaching_experience)}
        ${field('Facility', r.facility_access)}
        ${field('Why', r.why)}
      </dl>
      <div class="row-2 mt2">
        <div class="field">
          <label for="eqs-${esc(r.id)}">Status</label>
          <select id="eqs-${esc(r.id)}" data-status>
            <option value="new"${r.status === 'new' ? ' selected' : ''}>New</option>
            <option value="reviewing"${r.status === 'reviewing' ? ' selected' : ''}>In progress</option>
            <option value="closed"${r.status === 'closed' ? ' selected' : ''}>Closed</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="eqn-${esc(r.id)}">Notes <span class="muted">(only admins see these)</span></label>
        <textarea id="eqn-${esc(r.id)}" data-note style="min-height:4rem">${esc(r.admin_note || '')}</textarea>
      </div>
      <button class="btn btn-sm" type="button" data-save>Save</button>
    </details>`).join('');

  $$('[data-save]', host).forEach((b) => b.addEventListener('click', async () => {
    const card = b.closest('[data-id]');
    const { error } = await sb.from('branch_enquiries').update({
      status: $('[data-status]', card).value,
      admin_note: $('[data-note]', card).value.trim() || null,
    }).eq('id', card.dataset.id);
    if (error) return ctx.flash(error.message, 'flag');
    ctx.flash('Enquiry saved.', 'good');
    ctx.refreshCounts();
    refresh();
  }));
}
