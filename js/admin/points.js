/* Admin — award and adjust points, and read any member's full history.
 * Every entry records who gave it and why. Corrections are entered as a
 * negative amount rather than by editing history.
 */
import { $, esc, sb, busy, dateShort, loadRanks, rankFor, rankPlate, whoIs } from '../core.js';

let ctx, panel, members = [], rules = [];

export async function init(c, p) {
  ctx = c; panel = p;
  panel.innerHTML = `
    <div class="split">
      <div>
        <div class="between mb1">
          <h2 class="h3">Points history</h2>
          <div class="field mb0">
            <label class="sr" for="pt-filter">Show history for</label>
            <select id="pt-filter"></select>
          </div>
        </div>
        <div id="pt-summary"></div>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th scope="col">Date</th><th scope="col">Member</th><th scope="col">For</th><th scope="col">By</th><th scope="col" class="num">Points</th></tr></thead>
            <tbody id="pt-list"><tr><td colspan="5" class="load">Loading…</td></tr></tbody>
          </table>
        </div>
      </div>
      <div>
        <h2 class="h3 mb1">Award or adjust</h2>
        <form method="post" class="panel" id="pt-form" novalidate>
          <div class="field">
            <label for="pt-member">Member</label>
            <select id="pt-member" required></select>
          </div>
          <div class="field">
            <label for="pt-rule">What for</label>
            <select id="pt-rule"></select>
          </div>
          <div class="field">
            <label for="pt-points">Points</label>
            <input id="pt-points" type="number" step="1" min="-1000" max="1000" required>
            <p class="hint">Use a minus number to correct a mistake, e.g. -10.</p>
          </div>
          <div class="field">
            <label for="pt-reason">Reason</label>
            <input id="pt-reason" type="text" maxlength="200" required>
            <p class="hint">The member sees this in their history.</p>
          </div>
          <button class="btn btn-sm" type="submit" id="pt-save">Save</button>
        </form>
        <p class="small muted mt2">
          Attendance and full-week bonuses are added automatically when the register is saved or a
          member scans in. Training wins are added from the Training wins tab. Referrals, social tags
          and home workouts come through Approvals. You cannot award points to yourself.
        </p>
      </div>
    </div>`;

  $('#pt-rule', panel).addEventListener('change', () => {
    const r = rules.find((x) => x.code === $('#pt-rule', panel).value);
    if (r) {
      $('#pt-points', panel).value = r.points;
      $('#pt-reason', panel).value = r.label;
    } else {
      $('#pt-points', panel).value = '';
      $('#pt-reason', panel).value = '';
    }
  });
  $('#pt-filter', panel).addEventListener('change', loadHistory);
  $('#pt-form', panel).addEventListener('submit', save);
  await refresh();
}

export async function refresh() {
  members = await ctx.members();
  const { data } = await sb.from('point_rules').select('code, label, points, is_auto').eq('is_active', true).order('sort_order');
  // Attendance, week bonuses and training wins each have their own record
  // (register, wins tab) that the leaderboard counts. Awarding them by hand
  // here would add the points without the record, so they are left out.
  rules = (data || []).filter((r) => !r.is_auto && r.code !== 'training_win');

  const opts = members.map((m) => `<option value="${esc(m.id)}">${esc(whoIs(m, members))}</option>`).join('');
  $('#pt-member', panel).innerHTML = `<option value="">Choose a member</option>${opts}`;
  const keep = $('#pt-filter', panel).value;
  $('#pt-filter', panel).innerHTML = `<option value="">Everyone at ${esc(ctx.branch.name)}</option>${opts}`;
  if (members.some((m) => m.id === keep)) $('#pt-filter', panel).value = keep;

  $('#pt-rule', panel).innerHTML = rules.map((r) =>
    `<option value="${esc(r.code)}">${esc(r.label)} (${r.points > 0 ? '+' : ''}${r.points})</option>`).join('') +
    `<option value="">Other — enter an amount</option>`;
  $('#pt-rule', panel).dispatchEvent(new Event('change'));

  await loadHistory();
}

async function loadHistory() {
  const body = $('#pt-list', panel);
  const summary = $('#pt-summary', panel);
  const one = $('#pt-filter', panel).value;
  const ids = one ? [one] : members.map((m) => m.id);
  summary.innerHTML = '';

  if (!ids.length) { body.innerHTML = `<tr><td colspan="5" class="muted">No active members yet.</td></tr>`; return; }

  const { data, error } = await sb.from('points_ledger')
    .select('id, member_id, points, reason, rule_code, awarded_by, source_type, created_at')
    .in('member_id', ids)
    .order('created_at', { ascending: false })
    .limit(one ? 500 : 120);
  if (error) { body.innerHTML = `<tr><td colspan="5" class="muted">Could not load points.</td></tr>`; return; }

  const name = (id) => whoIs(members.find((m) => m.id === id), members);
  const by = (row) => row.awarded_by ? (name(row.awarded_by) || 'Coach')
    : (row.source_type === 'attendance' || row.source_type === 'week') ? 'Automatic' : '—';

  if (one) {
    const total = data.reduce((n, r) => n + r.points, 0);
    const r = rankFor(total, await loadRanks());
    summary.innerHTML = `
      <div class="panel panel-bone mb1 flex">
        ${rankPlate(r.current.code, true)}
        <div><p class="stat-num">${total.toLocaleString('en-GB')}</p>
          <p class="small muted">${esc(r.current.label)}${r.next ? ` · ${r.toNext} to ${esc(r.next.label)}` : ' · top of the ladder'}</p></div>
      </div>`;
  }

  body.innerHTML = !data.length
    ? `<tr><td colspan="5" class="muted">No points recorded yet.</td></tr>`
    : data.map((r) => `
      <tr>
        <td class="nowrap">${esc(dateShort(r.created_at))}</td>
        <td>${esc(name(r.member_id) || '—')}</td>
        <td>${esc(r.reason || r.rule_code || '')}</td>
        <td class="small">${esc(by(r))}</td>
        <td class="num"><strong${r.points < 0 ? ' style="color:var(--flag)"' : ''}>${r.points > 0 ? '+' : ''}${r.points}</strong></td>
      </tr>`).join('');
}

async function save(e) {
  e.preventDefault();
  const member = $('#pt-member', panel).value;
  const points = parseInt($('#pt-points', panel).value, 10);
  const reason = $('#pt-reason', panel).value.trim();
  const rule = $('#pt-rule', panel).value || null;

  if (!member) return ctx.flash('Choose a member.', 'flag');
  if (!Number.isInteger(points) || points === 0) return ctx.flash('Enter a number of points (not zero).', 'flag');
  if (!reason) return ctx.flash('Give a reason — the member sees it.', 'flag');

  const btn = $('#pt-save', panel);
  busy(btn, true, 'Saving…');
  const { error } = await sb.rpc('adjust_points', { p_member: member, p_points: points, p_reason: reason, p_rule: rule });
  busy(btn, false);
  if (error) return ctx.flash(error.message, 'flag');

  ctx.flash(`${points > 0 ? 'Awarded' : 'Adjusted'} ${points > 0 ? '+' : ''}${points} to ${whoIs(members.find((m) => m.id === member), members)}.`, 'good');
  $('#pt-member', panel).value = '';
  $('#pt-filter', panel).value = member;
  loadHistory();
}

