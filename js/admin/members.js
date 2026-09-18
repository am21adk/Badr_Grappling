/* Admin — members: approve sign-ups, assign branch, deactivate.
 *
 * Branch admins manage their own branch's members. Moving someone to
 * another branch, and changing anyone's role, are super-admin actions
 * (the database refuses them from anyone else — see guard_member_self_update).
 * Deactivating keeps a member's history; nothing here deletes a person.
 */
import { $, $$, esc, sb, dateShort } from '../core.js';

let ctx, panel, rows = [];

export async function init(c, p) {
  ctx = c; panel = p;
  panel.innerHTML = `
    <div id="mb-pending"></div>
    <div class="between mt2 mb1">
      <h2 class="h3">Members at <span id="mb-branch"></span></h2>
      <div class="flex">
        <label class="sr" for="mb-find">Search members</label>
        <input id="mb-find" type="search" placeholder="Search name or email" style="max-width:15rem">
        <label class="sr" for="mb-status">Show</label>
        <select id="mb-status" style="max-width:10rem">
          <option value="active">Active</option>
          <option value="inactive">Deactivated</option>
          <option value="">Everyone</option>
        </select>
      </div>
    </div>
    <div class="table-scroll">
      <table class="table">
        <thead><tr>
          <th scope="col">Name</th><th scope="col">Contact</th><th scope="col">Joined</th>
          <th scope="col">Role</th><th scope="col">Status</th><th scope="col"><span class="sr">Actions</span></th>
        </tr></thead>
        <tbody id="mb-list"><tr><td colspan="6" class="load">Loading…</td></tr></tbody>
      </table>
    </div>`;
  $('#mb-find', panel).addEventListener('input', paintList);
  $('#mb-status', panel).addEventListener('change', paintList);
  await refresh();
}

export async function refresh() {
  $('#mb-branch', panel).textContent = ctx.branch.name;
  const { data, error } = await sb.from('members')
    .select('id, full_name, email, phone, role, status, branch_id, joined_on, created_at')
    .eq('branch_id', ctx.branch.id)
    .order('full_name');
  if (error) { $('#mb-list', panel).innerHTML = `<tr><td colspan="6" class="muted">Could not load members.</td></tr>`; return; }
  rows = data;

  // A super-admin also sees anyone who signed up without a branch.
  let orphans = [];
  if (ctx.isSuper) {
    const { data: o } = await sb.from('members')
      .select('id, full_name, email, phone, role, status, branch_id, joined_on, created_at')
      .is('branch_id', null).neq('status', 'inactive').order('created_at');
    orphans = o || [];
  }

  paintPending(rows.filter((m) => m.status === 'pending'), orphans);
  paintList();
}

function paintPending(pending, orphans) {
  const host = $('#mb-pending', panel);
  if (!pending.length && !orphans.length) {
    host.innerHTML = `<p class="small muted">No sign-ups waiting for approval.</p>`;
    return;
  }
  const card = (m, orphan) => `
    <div class="roster-row" data-id="${esc(m.id)}">
      <div class="who">
        <strong>${esc(m.full_name)}</strong>
        <span class="small muted">&middot; ${esc(m.email || '')}${m.phone ? ` &middot; ${esc(m.phone)}` : ''} &middot; signed up ${esc(dateShort(m.created_at))}</span>
      </div>
      <div class="flex" style="gap:.4rem">
        ${orphan ? `<label class="sr" for="ob-${esc(m.id)}">Branch</label>
          <select id="ob-${esc(m.id)}" style="min-height:36px;width:auto">${ctx.branches.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select>` : ''}
        <button class="btn btn-sm" type="button" data-approve>Approve</button>
        <button class="btn btn-sm btn-ghost" type="button" data-decline>Decline</button>
      </div>
    </div>`;

  host.innerHTML = `
    <h2 class="h3 mb1">Waiting for approval</h2>
    <p class="small muted mb1">Approve once they have trained with you. Approving opens the portal and lets their check-ins count.</p>
    <div class="roster">${pending.map((m) => card(m, false)).join('')}${orphans.map((m) => card(m, true)).join('')}</div>`;

  $$('[data-approve]', host).forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('[data-id]');
    const branchSel = $('select', row);
    const patch = { status: 'active' };
    if (branchSel) patch.branch_id = branchSel.value;
    update(row.dataset.id, patch, 'Approved — they can sign in to the portal now.');
  }));
  $$('[data-decline]', host).forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('[data-id]');
    if (!confirm('Decline this sign-up? Their account stays but cannot use the portal. You can reactivate it later.')) return;
    update(row.dataset.id, { status: 'inactive' }, 'Sign-up declined.');
  }));
}

function paintList() {
  const body = $('#mb-list', panel);
  const needle = $('#mb-find', panel).value.trim().toLowerCase();
  const status = $('#mb-status', panel).value;
  const shown = rows.filter((m) => m.status !== 'pending'
    && (!status || m.status === status)
    && (!needle || `${m.full_name} ${m.email || ''}`.toLowerCase().includes(needle)));

  if (!shown.length) { body.innerHTML = `<tr><td colspan="6" class="muted">No members match.</td></tr>`; return; }

  const roleLabel = { member: 'Member', admin: 'Branch admin', super_admin: 'Super-admin' };
  body.innerHTML = shown.map((m) => {
    const isMe = m.id === ctx.me.id;
    const locked = m.role === 'super_admin' && !ctx.isSuper;
    return `
      <tr data-id="${esc(m.id)}">
        <td><strong>${esc(m.full_name)}</strong>${isMe ? ' <span class="pill">You</span>' : ''}</td>
        <td class="small">${m.email ? `<a class="link" href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ''}${m.phone ? `<br>${esc(m.phone)}` : ''}</td>
        <td class="nowrap small">${esc(dateShort(m.joined_on))}</td>
        <td>${ctx.isSuper && !isMe ? `
          <label class="sr" for="role-${esc(m.id)}">Role</label>
          <select id="role-${esc(m.id)}" data-role style="min-height:36px">
            ${Object.entries(roleLabel).map(([v, l]) => `<option value="${v}"${m.role === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>` : esc(roleLabel[m.role])}</td>
        <td><span class="pill ${m.status === 'active' ? 'pill-good' : ''}">${m.status === 'active' ? 'Active' : 'Deactivated'}</span></td>
        <td class="action-cell">${isMe || locked ? '' : `
          ${ctx.isSuper ? `<label class="sr" for="mv-${esc(m.id)}">Move to branch</label>
            <select id="mv-${esc(m.id)}" data-move style="min-height:36px;width:auto">
              ${ctx.branches.map((b) => `<option value="${esc(b.id)}"${b.id === m.branch_id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}
            </select>` : ''}
          ${m.status === 'active'
            ? `<button class="linkish danger small" type="button" data-deactivate>Deactivate</button>`
            : `<button class="linkish small" type="button" data-reactivate>Reactivate</button>`}`}
        </td>
      </tr>`;
  }).join('');

  $$('[data-deactivate]', body).forEach((b) => b.addEventListener('click', () => {
    const tr = b.closest('tr');
    const m = rows.find((x) => x.id === tr.dataset.id);
    if (!confirm(`Deactivate ${m.full_name}? They lose portal access and drop off the leaderboard. Their history is kept.`)) return;
    update(m.id, { status: 'inactive' }, `${m.full_name} deactivated.`);
  }));
  $$('[data-reactivate]', body).forEach((b) => b.addEventListener('click', () => {
    const m = rows.find((x) => x.id === b.closest('tr').dataset.id);
    update(m.id, { status: 'active' }, `${m.full_name} reactivated.`);
  }));
  $$('[data-role]', body).forEach((s) => s.addEventListener('change', () => {
    const m = rows.find((x) => x.id === s.closest('tr').dataset.id);
    if (!confirm(`Change ${m.full_name}'s role to ${s.selectedOptions[0].text}?`)) { s.value = m.role; return; }
    update(m.id, { role: s.value }, `${m.full_name} is now ${s.selectedOptions[0].text.toLowerCase()}.`);
  }));
  $$('[data-move]', body).forEach((s) => s.addEventListener('change', () => {
    const m = rows.find((x) => x.id === s.closest('tr').dataset.id);
    if (!confirm(`Move ${m.full_name} to ${s.selectedOptions[0].text}?`)) { s.value = m.branch_id; return; }
    update(m.id, { branch_id: s.value }, `${m.full_name} moved to ${s.selectedOptions[0].text}.`);
  }));
}

async function update(id, patch, okText) {
  const { error } = await sb.from('members').update(patch).eq('id', id);
  if (error) return ctx.flash(error.message, 'flag');
  ctx.flash(okText, 'good');
  ctx.invalidateMembers();
  ctx.refreshCounts();
  refresh();
}
