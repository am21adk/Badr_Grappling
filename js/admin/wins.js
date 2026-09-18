/* Admin — log training-round wins.
 * Each win awards the training_win points automatically (database trigger);
 * deleting a win takes them back.
 */
import { $, $$, esc, sb, busy, dateShort } from '../core.js';

let ctx, panel, members = [];

export async function init(c, p) {
  ctx = c; panel = p;
  panel.innerHTML = `
    <div class="split">
      <div>
        <h2 class="h3 mb1">Recent training wins</h2>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th scope="col">Date</th><th scope="col">Winner</th><th scope="col">Against</th><th scope="col">Notes</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
            <tbody id="w-list"><tr><td colspan="5" class="load">Loading…</td></tr></tbody>
          </table>
        </div>
      </div>
      <div>
        <h2 class="h3 mb1">Log a win</h2>
        <form method="post" class="panel" id="w-form" novalidate>
          <div class="field">
            <label for="w-date">Date</label>
            <input id="w-date" type="date" required>
          </div>
          <div class="field">
            <label for="w-winner">Winner</label>
            <select id="w-winner" required></select>
          </div>
          <div class="field">
            <label for="w-opp">Against <span class="muted">(optional)</span></label>
            <select id="w-opp"></select>
          </div>
          <div class="field">
            <label for="w-notes">Notes <span class="muted">(optional)</span></label>
            <input id="w-notes" type="text" maxlength="200" placeholder="e.g. Takedown in the final round">
          </div>
          <button class="btn btn-sm" type="submit" id="w-save">Log win</button>
          <p class="hint mt1" id="w-pts"></p>
        </form>
      </div>
    </div>`;

  $('#w-date', panel).value = new Date().toLocaleDateString('en-CA');
  $('#w-form', panel).addEventListener('submit', save);
  await refresh();
}

export async function refresh() {
  members = await ctx.members();
  const opts = members.map((m) => `<option value="${esc(m.id)}">${esc(m.full_name)}</option>`).join('');
  // Another coach logs your own wins, so you are not offered as the winner.
  const winners = members.filter((m) => m.id !== ctx.me.id)
    .map((m) => `<option value="${esc(m.id)}">${esc(m.full_name)}</option>`).join('');
  $('#w-winner', panel).innerHTML = `<option value="">Choose a member</option>${winners}`;
  $('#w-opp', panel).innerHTML = `<option value="">—</option>${opts}`;

  const { data: rule } = await sb.from('point_rules').select('points, is_active').eq('code', 'training_win').maybeSingle();
  $('#w-pts', panel).textContent = rule?.is_active ? `Each win adds ${rule.points} points to the winner.` : 'Training wins currently award no points.';

  await loadList();
}

async function loadList() {
  const body = $('#w-list', panel);
  const { data, error } = await sb.from('training_results')
    .select('id, held_on, winner_id, opponent_id, notes')
    .eq('branch_id', ctx.branch.id)
    .order('held_on', { ascending: false }).order('created_at', { ascending: false })
    .limit(60);
  if (error) { body.innerHTML = `<tr><td colspan="5" class="muted">Could not load wins.</td></tr>`; return; }
  if (!data.length) { body.innerHTML = `<tr><td colspan="5" class="muted">No wins logged yet.</td></tr>`; return; }

  const name = (id) => id ? (members.find((m) => m.id === id)?.full_name || 'Former member') : '—';
  body.innerHTML = data.map((w) => `
    <tr>
      <td class="nowrap">${esc(dateShort(w.held_on))}</td>
      <td>${esc(name(w.winner_id))}</td>
      <td>${esc(name(w.opponent_id))}</td>
      <td class="small muted">${esc(w.notes || '')}</td>
      <td class="action-cell"><button class="linkish danger small" type="button" data-del="${esc(w.id)}">Remove</button></td>
    </tr>`).join('');

  $$('[data-del]', body).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this win? The points it awarded are taken back.')) return;
    const { error: e } = await sb.from('training_results').delete().eq('id', b.dataset.del);
    if (e) return ctx.flash(e.message, 'flag');
    ctx.flash('Win removed and its points taken back.', 'good');
    loadList();
  }));
}

async function save(e) {
  e.preventDefault();
  const winner = $('#w-winner', panel).value;
  const opp = $('#w-opp', panel).value || null;
  const held_on = $('#w-date', panel).value;
  if (!winner) return ctx.flash('Choose who won.', 'flag');
  if (opp && opp === winner) return ctx.flash('A member cannot beat themselves.', 'flag');
  if (!held_on) return ctx.flash('Pick the date.', 'flag');

  const btn = $('#w-save', panel);
  busy(btn, true, 'Saving…');
  const { error } = await sb.from('training_results').insert({
    branch_id: ctx.branch.id,
    winner_id: winner,
    opponent_id: opp,
    held_on,
    notes: $('#w-notes', panel).value.trim() || null,
    logged_by: ctx.me.id,
  });
  busy(btn, false);
  if (error) return ctx.flash(error.message, 'flag');

  const who = members.find((m) => m.id === winner)?.full_name;
  ctx.flash(`Win logged for ${who}.`, 'good');
  // Keep the date and clear the people, so a coach can log a run of rounds quickly.
  $('#w-winner', panel).value = '';
  $('#w-opp', panel).value = '';
  $('#w-notes', panel).value = '';
  $('#w-winner', panel).focus();
  loadList();
}
