/* Admin — session register.
 *
 * The coach opens a session and ticks who was there. Ticks are staged and
 * saved together, so ticking a whole room is one save, not forty requests.
 * QR check-ins land in the same table and appear here with a QR label; the
 * coach can untick any entry, whichever route it came in by.
 */
import { $, $$, esc, sb, busy, clockTime, dayName, dateShort } from '../core.js';

let ctx, panel;
let sessionId = null;
let present = new Map();   // member_id -> { source, recorded_at }
let staged = new Map();    // member_id -> true (add) | false (remove)

export async function init(c, p) {
  ctx = c; panel = p;
  panel.innerHTML = `
    <div class="split">
      <div id="rg-roster">
        <p class="empty">Pick a session to take the register, or create today’s.</p>
      </div>
      <div>
        <h2 class="h3 mb1">New session</h2>
        <form method="post" id="rg-new" class="panel mb2" novalidate>
          <div class="row-2">
            <div class="field">
              <label for="rg-date">Date</label>
              <input id="rg-date" type="date" required>
            </div>
            <div class="field">
              <label for="rg-class">Class</label>
              <select id="rg-class"></select>
            </div>
          </div>
          <div class="field" id="rg-custom-wrap" hidden>
            <label for="rg-custom">Session name</label>
            <input id="rg-custom" type="text" placeholder="e.g. Open mat">
          </div>
          <button class="btn btn-sm" type="submit">Create session</button>
        </form>
        <h2 class="h3 mb1">Recent sessions</h2>
        <ul class="sessions-list" id="rg-list"><li class="load" style="padding:1rem">Loading…</li></ul>
      </div>
    </div>`;

  $('#rg-date', panel).value = new Date().toLocaleDateString('en-CA');   // yyyy-mm-dd, local
  $('#rg-class', panel).addEventListener('change', syncCustom);
  $('#rg-new', panel).addEventListener('submit', createSession);
  await refresh();
}

export async function refresh() {
  sessionId = null;
  present = new Map();
  staged = new Map();
  $('#rg-roster', panel).innerHTML = `<p class="empty">Pick a session to take the register, or create today’s.</p>`;
  await Promise.all([loadClasses(), loadSessions()]);
}

/* ---------- class options for the new-session form ---------- */
async function loadClasses() {
  const { data } = await sb.from('class_times')
    .select('id, label, weekday, starts_at').eq('branch_id', ctx.branch.id).eq('is_active', true)
    .order('weekday').order('starts_at');
  $('#rg-class', panel).innerHTML = (data || []).map((c) =>
    `<option value="${esc(c.id)}" data-label="${esc(c.label)}">${esc(c.label)} — ${esc(dayName(c.weekday))} ${esc(clockTime(c.starts_at))}</option>`)
    .join('') + `<option value="">Something else…</option>`;
  syncCustom();
}

function syncCustom() {
  $('#rg-custom-wrap', panel).hidden = $('#rg-class', panel).value !== '';
}

async function createSession(e) {
  e.preventDefault();
  const sel = $('#rg-class', panel);
  const held_on = $('#rg-date', panel).value;
  const label = sel.value ? sel.selectedOptions[0].dataset.label : $('#rg-custom', panel).value.trim();
  if (!held_on) return ctx.flash('Pick a date for the session.', 'flag');
  if (!label) return ctx.flash('Give the session a name.', 'flag');

  const { data, error } = await sb.from('sessions').insert({
    branch_id: ctx.branch.id,
    class_time_id: sel.value || null,
    held_on, label,
    created_by: ctx.me.id,
  }).select('id').single();

  if (error) {
    return ctx.flash(error.code === '23505'
      ? `There is already a “${label}” session on that date. Open it from the list instead.`
      : error.message, 'flag');
  }
  ctx.flash(`Session created: ${label}, ${dateShort(held_on)}.`, 'good');
  await loadSessions();
  openSession(data.id);
}

/* ---------- recent sessions list ---------- */
async function loadSessions() {
  const list = $('#rg-list', panel);
  const { data, error } = await sb.from('sessions')
    .select('id, held_on, label, attendance(count)')
    .eq('branch_id', ctx.branch.id)
    .order('held_on', { ascending: false }).order('created_at', { ascending: false })
    .limit(40);
  if (error) { list.innerHTML = `<li style="padding:1rem" class="muted">Could not load sessions.</li>`; return; }
  if (!data.length) { list.innerHTML = `<li style="padding:1rem" class="muted">No sessions yet.</li>`; return; }

  list.innerHTML = data.map((s) => `
    <li><button type="button" data-id="${esc(s.id)}"${s.id === sessionId ? ' aria-current="true"' : ''}>
      <span><strong>${esc(s.label)}</strong><br><span class="small muted">${esc(dayName(new Date(s.held_on + 'T12:00').getDay()))} ${esc(dateShort(s.held_on))}</span></span>
      <span class="small">${s.attendance?.[0]?.count ?? 0} in</span>
    </button></li>`).join('');
  $$('button[data-id]', list).forEach((b) => b.addEventListener('click', () => openSession(b.dataset.id)));
}

/* ---------- the register itself ---------- */
async function openSession(id) {
  sessionId = id;
  staged = new Map();
  $$('#rg-list button', panel).forEach((b) => b.setAttribute('aria-current', String(b.dataset.id === id)));

  const host = $('#rg-roster', panel);
  host.innerHTML = `<p class="load">Loading register…</p>`;

  const [{ data: s }, { data: rows, error }, members] = await Promise.all([
    sb.from('sessions').select('id, held_on, label').eq('id', id).single(),
    sb.from('attendance').select('member_id, source, recorded_at').eq('session_id', id),
    ctx.members(),
  ]);
  if (error || !s) { host.innerHTML = `<p class="empty">Could not load that session.</p>`; return; }

  present = new Map(rows.map((r) => [r.member_id, r]));

  // Anyone checked in who is not on this branch's list (a visitor from
  // another branch) still shows, so the coach can see and remove them.
  const known = new Set(members.map((m) => m.id));
  const visitors = rows.filter((r) => !known.has(r.member_id))
    .map((r) => ({ id: r.member_id, full_name: 'Member from another branch' }));
  const everyone = [...members, ...visitors];

  host.innerHTML = `
    <div class="between mb1">
      <div>
        <h2 class="h2">${esc(s.label)}</h2>
        <p class="meta mt1">${esc(dayName(new Date(s.held_on + 'T12:00').getDay()))} ${esc(dateShort(s.held_on))} &middot; <span id="rg-tally"></span></p>
      </div>
      <button class="linkish danger small" type="button" id="rg-del">Delete session</button>
    </div>
    <div class="roster-tools">
      <label class="sr" for="rg-find">Find a member</label>
      <input id="rg-find" type="search" placeholder="Find a member" style="max-width:16rem">
      <button class="btn btn-sm btn-ghost" type="button" id="rg-all">Tick everyone shown</button>
      <button class="btn btn-sm btn-ghost" type="button" id="rg-none">Untick everyone shown</button>
    </div>
    ${everyone.length ? `<div class="roster" id="rg-rows">${everyone.map(rowHtml).join('')}</div>`
      : `<p class="empty">No active members at ${esc(ctx.branch.name)} yet. Approve sign-ups in Members.</p>`}
    <div class="between mt2">
      <p class="small muted" id="rg-dirty"></p>
      <button class="btn" type="button" id="rg-save" disabled>Save register</button>
    </div>`;

  $$('#rg-rows input[type=checkbox]', host).forEach((cb) => cb.addEventListener('change', () => {
    const id = cb.value;
    const was = present.has(id);
    if (cb.checked === was) staged.delete(id); else staged.set(id, cb.checked);
    paintRow(id, cb.checked);
    paintState();
  }));

  const visibleBoxes = () => $$('#rg-rows .roster-row', host).filter((r) => !r.hidden).map((r) => $('input', r)).filter((cb) => !cb.disabled);
  $('#rg-all', host).addEventListener('click', () => visibleBoxes().forEach((cb) => { if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); } }));
  $('#rg-none', host).addEventListener('click', () => visibleBoxes().forEach((cb) => { if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change')); } }));

  $('#rg-find', host).addEventListener('input', (e) => {
    const n = e.target.value.trim().toLowerCase();
    $$('#rg-rows .roster-row', host).forEach((r) => { r.hidden = n && !r.dataset.name.includes(n); });
  });

  $('#rg-save', host).addEventListener('click', save);
  $('#rg-del', host).addEventListener('click', () => deleteSession(s));
  paintState();
}

function rowHtml(m) {
  const p = present.get(m.id);
  // Coaches check themselves in with the QR code; the database refuses a
  // coach ticking their own name, so the box is not offered.
  const self = m.id === ctx.me.id && !p;
  return `
    <div class="roster-row${p ? ' is-in' : ''}" data-name="${esc(m.full_name.toLowerCase())}" data-id="${esc(m.id)}">
      <input type="checkbox" id="rg-${esc(m.id)}" value="${esc(m.id)}"${p ? ' checked' : ''}${self ? ' disabled' : ''}>
      <label for="rg-${esc(m.id)}">${esc(m.full_name)}${self ? ' <span class="small muted">— you, scan the QR code</span>' : ''}</label>
      <span class="src">${p ? sourcePill(p) : ''}</span>
    </div>`;
}

const sourcePill = (p) => p.source === 'qr'
  ? `<span class="pill pill-brass" title="Scanned in at ${esc(new Date(p.recorded_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}">QR ${esc(new Date(p.recorded_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}</span>`
  : `<span class="pill">Coach</span>`;

function paintRow(id, checked) {
  const row = $(`#rg-rows .roster-row[data-id="${CSS.escape(id)}"]`, panel);
  if (!row) return;
  row.classList.toggle('is-in', checked);
  const src = $('.src', row);
  const p = present.get(id);
  src.innerHTML = checked
    ? (p ? sourcePill(p) : `<span class="pill pill-good">Adding</span>`)
    : (p ? `<span class="pill pill-flag">Removing</span>` : '');
}

function paintState() {
  const inNow = new Set(present.keys());
  for (const [id, add] of staged) add ? inNow.add(id) : inNow.delete(id);
  const qr = [...present.values()].filter((p) => p.source === 'qr').length;
  $('#rg-tally', panel).textContent = `${inNow.size} present (${qr} by QR)`;
  $('#rg-dirty', panel).textContent = staged.size ? `${staged.size} unsaved ${staged.size === 1 ? 'change' : 'changes'}` : 'All changes saved';
  $('#rg-save', panel).disabled = !staged.size;
}

async function save() {
  const btn = $('#rg-save', panel);
  const adds = [...staged].filter(([, v]) => v).map(([id]) => id);
  const removes = [...staged].filter(([, v]) => !v).map(([id]) => id);
  busy(btn, true, 'Saving…');

  let err = null;
  if (adds.length) {
    const { error } = await sb.from('attendance').upsert(
      adds.map((member_id) => ({ session_id: sessionId, member_id, source: 'coach', recorded_by: ctx.me.id })),
      { onConflict: 'session_id,member_id', ignoreDuplicates: true });
    err = err || error;
  }
  if (removes.length) {
    const { error } = await sb.from('attendance').delete()
      .eq('session_id', sessionId).in('member_id', removes);
    err = err || error;
  }
  busy(btn, false);

  if (err) return ctx.flash(`Register not saved: ${err.message}`, 'flag');
  ctx.flash(`Register saved — ${adds.length} added, ${removes.length} removed. Points updated automatically.`, 'good');
  await loadSessions();
  openSession(sessionId);
}

async function deleteSession(s) {
  const n = present.size;
  const ok = confirm(`Delete “${s.label}” on ${dateShort(s.held_on)}?${n ? `\n\nThis also removes ${n} register ${n === 1 ? 'entry' : 'entries'} and the points they earned.` : ''}`);
  if (!ok) return;
  const { error } = await sb.from('sessions').delete().eq('id', s.id);
  if (error) return ctx.flash(error.message, 'flag');
  ctx.flash('Session deleted.', 'good');
  await refresh();
}
