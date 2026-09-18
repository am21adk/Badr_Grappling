/* Badr Grappling — leaderboard. */
import { $, $$, esc, sb, requireMember, loadBranches, activeBranch, setBranch, rankPlate } from './core.js';

const me = await requireMember();
if (me) boot();

let period = 'all';

async function boot() {
  $('#main').hidden = false;

  const sel = $('#lb-branch');
  const list = await loadBranches();
  const active = await activeBranch();
  sel.innerHTML = `<option value="">All branches</option>` + list
    .map((b) => `<option value="${esc(b.slug)}"${b.slug === active.slug ? ' selected' : ''}>${esc(b.name)}</option>`)
    .join('');

  // Picking a branch here also moves the site-wide selection, and vice versa.
  sel.addEventListener('change', () => {
    if (sel.value) setBranch(sel.value);
    paint();
  });
  document.addEventListener('branchchange', (e) => { sel.value = e.detail.slug; paint(); });

  $$('[data-period]').forEach((chip) => chip.addEventListener('click', () => {
    period = chip.dataset.period;
    $$('[data-period]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    paint();
  }));

  paint();
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

let seq = 0;
async function paint() {
  const mine = ++seq;
  const body = $('#lb-body');
  const sel = $('#lb-branch');
  const branch = (await loadBranches()).find((b) => b.slug === sel.value);

  body.innerHTML = `<tr><td colspan="6" class="load">Loading…</td></tr>`;
  const { data, error } = await sb.rpc('leaderboard', {
    p_branch: branch?.id ?? null,
    p_since: period === 'month' ? monthStart() : null,
  });
  if (mine !== seq) return;          // a newer filter change has already started

  const scope = `${branch ? branch.name : 'All branches'}, ${period === 'month' ? 'this month' : 'all time'}`;
  $('#lb-caption').textContent = `Leaderboard — ${scope}`;

  if (error) {
    body.innerHTML = `<tr><td colspan="6" class="muted">The leaderboard could not be loaded just now.</td></tr>`;
    return;
  }
  if (!data.length) {
    body.innerHTML = `<tr><td colspan="6" class="muted">No members on the board for ${esc(scope)} yet.</td></tr>`;
    $('#lb-foot').textContent = '';
    return;
  }

  // Shared positions for equal points: 1, 2, 2, 4.
  let pos = 0, last = null;
  const positions = data.map((r, i) => {
    if (r.total_points !== last) { pos = i + 1; last = r.total_points; }
    return pos;
  });

  body.innerHTML = data.map((r, i) => {
    const pos = positions[i];
    return `
      <tr${r.is_me ? ' class="is-me"' : ''}>
        <td class="pos">${pos}</td>
        <td><span class="lb-name">${esc(r.display_name)}${r.is_me ? ' <span class="lb-you">You</span>' : ''}</span></td>
        <td>${r.rank_code ? rankPlate(r.rank_code) : ''}<span class="sr">${esc(r.rank_label || '')}</span></td>
        <td class="num">${Number(r.total_points).toLocaleString('en-GB')}</td>
        <td class="num">${r.sessions_attended}</td>
        <td class="num hide-sm">${r.training_wins}</td>
      </tr>`;
  }).join('');

  const myRow = data.findIndex((r) => r.is_me);
  $('#lb-foot').textContent = myRow >= 0
    ? `You are ${positions[myRow] === positions[myRow + 1] || positions[myRow] === positions[myRow - 1] ? 'joint ' : ''}${ordinal(positions[myRow])} of ${data.length} for ${scope}.`
    : `${data.length} members for ${scope}.`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
