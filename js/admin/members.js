/* Admin — members: assign branch, deactivate, delete.
 *
 * There is no approval step: people sign up and are in. Branch admins
 * manage their own branch's members. Moving someone to
 * another branch, and changing anyone's role, are super-admin actions
 * (the database refuses them from anyone else — see guard_member_self_update).
 *
 * Deactivating keeps a member's history. Declining a leftover sign-up, or
 * deleting an account, removes the person and their sign-in for good:
 * both go through delete_member(), which the database guards.
 */
import { $, $$, esc, sb, dateShort } from '../core.js';

let ctx, panel, rows = [];

export async function init(c, p) {
  ctx = c; panel = p;
  panel.innerHTML = `
    <div id="mb-nobranch"></div>
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

  paintNoBranch(orphans);
  paintList();
}

// Signing up picks a branch, but a bad link or a renamed branch can leave
// someone without one, and they are then in nobody's list. Super-admins get
// them here so they can be placed.
function paintNoBranch(orphans) {
  const host = $('#mb-nobranch', panel);
  if (!orphans.length) { host.innerHTML = ''; return; }

  host.innerHTML = `
    <h2 class="h3 mb1">Signed up without a branch</h2>
    <p class="small muted mb1">Give each one a branch and they appear in that branch's list.</p>
    <div class="roster">${orphans.map((m) => `
      <div class="roster-row" data-id="${esc(m.id)}">
        <div class="who">
          <strong>${esc(m.full_name)}</strong>
          <span class="small muted">&middot; ${esc(m.email || '')}${m.phone ? ` &middot; ${esc(m.phone)}` : ''} &middot; signed up ${esc(dateShort(m.created_at))}</span>
        </div>
        <div class="flex" style="gap:.4rem">
          <label class="sr" for="ob-${esc(m.id)}">Branch</label>
          <select id="ob-${esc(m.id)}" style="min-height:36px;width:auto">${ctx.branches.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select>
          <button class="btn btn-sm" type="button" data-place>Save</button>
          <button class="btn btn-sm btn-ghost" type="button" data-remove>Delete</button>
        </div>
      </div>`).join('')}</div>`;

  $$('[data-place]', host).forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('[data-id]');
    const sel = $('select', row);
    update(row.dataset.id, { branch_id: sel.value },
      `${$('strong', row).textContent} moved to ${sel.selectedOptions[0].text}.`);
  }));
  $$('[data-remove]', host).forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('[data-id]');
    const who = $('strong', row).textContent;
    if (!confirm(`Delete ${who}? Their account and sign-in go with it. `
      + 'If that turns out to be a mistake, they can register again.')) return;
    remove(row.dataset.id, `${who}'s account deleted.`);
  }));
}

function paintList() {
  const body = $('#mb-list', panel);
  const needle = $('#mb-find', panel).value.trim().toLowerCase();
  const status = $('#mb-status', panel).value;
  const shown = rows.filter((m) => (!status || m.status === status)
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
            : `<button class="linkish small" type="button" data-reactivate>Reactivate</button>`}
          <button class="linkish danger small" type="button" data-delete>Delete</button>`}
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
  $$('[data-delete]', body).forEach((b) => b.addEventListener('click', () => {
    const m = rows.find((x) => x.id === b.closest('tr').dataset.id);
    if (!confirm(`Delete ${m.full_name}'s account?\n\nThis removes their sign-in and their whole `
      + 'record: attendance, points, claims and training results. Deactivating instead keeps all '
      + 'of it.\n\nThis cannot be undone.')) return;
    remove(m.id, `${m.full_name}'s account deleted.`);
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

/** Delete a member and their sign-in. The database does the guarding. */
async function remove(id, okText) {
  const { data, error } = await sb.rpc('delete_member', { p_member: id });
  if (error) return ctx.flash(error.message, 'flag');
  // The sign-in lives in Supabase's own table; say so plainly if it had to stay.
  const loginStayed = data?.login_removed === false;
  ctx.flash(loginStayed
    ? `${okText} Their sign-in could not be removed from here — delete it in Supabase under Authentication → Users.`
    : okText, loginStayed ? '' : 'good');
  ctx.invalidateMembers();
  ctx.refreshCounts();
  refresh();
}
