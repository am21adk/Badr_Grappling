/* Badr Grappling — member portal. */
import {
  $, $$, esc, sb, qp, say, busy, requireMember, initTabs,
  loadBranches, activeBranch, onBranch, loadRanks, rankFor, rankPlate,
  dateShort,
} from './core.js';
import { renderVideo, videoThumb } from './video-source.js';
import { celebrate } from './levelup.js';
import { initTraining, loadTraining } from './training-log.js';

const me = await requireMember();
if (me) boot();

async function boot() {
  $('#main').hidden = false;
  if (qp('denied')) say($('#p-flash'), 'That page is for coaches and admins only.', '');

  const first = (me.full_name || '').split(' ')[0] || 'there';
  // Straight from registering, "back" would be wrong. Drop the flag from the
  // address once read, so a refresh or a bookmark says "Welcome back".
  const fresh = !!qp('welcome');
  if (fresh) history.replaceState(null, '', location.pathname);
  $('#p-hello').textContent = `${fresh ? 'Welcome' : 'Welcome back'}, ${first}`;
  $('#p-branch').textContent = me.branches?.name ? `${me.branches.name} member` : 'Member';

  initTabs($('.admin-tabs'), {
    onShow: (key) => {
      if (key === 'training') loadTraining();
      if (key === 'record') loadRecord();
      if (key === 'points') loadPoints();
      if (key === 'claim')  loadClaims();
    },
  });

  loadStanding();
  initLibrary();
  initClaimForm();
  initTraining(me, levelChanged);
}

/* =====================================================
   Standing: rank and level, side by side
   Two separate ladders. Rank comes from points, which only coaches and the
   system give. Level comes from EXP: every point counts as the same EXP, plus
   whatever the member's training log earns. The database works out both.
   ===================================================== */
let standing = { rank: null, ranks: [] };

async function loadStanding() {
  const [{ data: s, error }, ranks, { data: lv }] = await Promise.all([sb.rpc('my_summary'), loadRanks(), sb.rpc('my_level')]);
  if (error || !s) {
    $('#p-next').textContent = 'Your numbers could not be loaded just now.';
    return;
  }

  const r = rankFor(s.points, ranks);
  $('#p-rank-plate').innerHTML = rankPlate(r.current.code, true);
  $('#p-rank-label').textContent = r.current.label;
  $('#p-points').textContent = Number(s.points).toLocaleString('en-GB');

  const bar = $('#p-progress');
  bar.setAttribute('aria-valuenow', String(r.pct));
  bar.querySelector('i').style.width = `${r.pct}%`;
  $('#p-next').textContent = r.next
    ? `${r.toNext.toLocaleString('en-GB')} points to ${r.next.label}.`
    : 'Top of the ladder.';

  $('#s-sessions').textContent = s.sessions;
  $('#s-record').textContent = `${s.wins}–${s.losses}`;
  $('#s-month').textContent = s.points_month;
  $('#s-streak').textContent = s.streak_weeks;

  standing = { rank: r.current, ranks: [...ranks].sort((a, b) => a.min_points - b.min_points) };
  if (!lv) { $('#p-exp-next').textContent = 'Your level could not be loaded just now.'; return; }
  paintLevel(lv);
  announce(r.current, lv.level);
}

function paintLevel(lv) {
  const into = Math.max(0, lv.total_exp - lv.level_starts_at);
  const span = lv.next_level_at - lv.level_starts_at;
  const pct = span > 0 ? Math.min(100, Math.floor((into / span) * 100)) : 100;
  $('#p-level-plate').textContent = lv.level;
  $('#p-level-label').textContent = `Level ${lv.level}`;
  $('#p-exp-total').textContent = Number(lv.total_exp).toLocaleString('en-GB');
  const bar = $('#p-exp-progress');
  bar.setAttribute('aria-valuenow', String(pct));
  bar.querySelector('i').style.width = `${pct}%`;
  $('#p-exp-next').textContent = `${into.toLocaleString('en-GB')} / ${span.toLocaleString('en-GB')} EXP to Level ${lv.level + 1}`;
  $('#t-total').textContent = `Training has earned you ${Number(lv.exp_from_training).toLocaleString('en-GB')} EXP`;
}

// What this device last showed, so a level or rank gained while the member
// was away (a coach ticking the register, an approved claim) is celebrated
// the next time they open the portal, once. The first visit on a device only
// remembers: there is nothing yet to compare with.
const seenKey = () => `badr.seen.${me.id}`;
function readSeen() { try { return JSON.parse(localStorage.getItem(seenKey()) || 'null'); } catch { return null; } }
function writeSeen(v) { try { localStorage.setItem(seenKey(), JSON.stringify(v)); } catch { /* private browsing: no memory, no harm */ } }

async function announce(rank, level) {
  const seen = readSeen();
  writeSeen({ rank: rank.code, level });
  if (!seen) return;
  const at = (code) => standing.ranks.findIndex((x) => x.code === code);
  const notices = [];
  // One notice for each rank climbed, in order: E to C shows E to D, then D to C.
  const was = at(seen.rank), now = at(rank.code);
  if (was >= 0) {
    for (let i = was + 1; i <= now; i += 1) notices.push({ type: 'rank', from: standing.ranks[i - 1], to: standing.ranks[i] });
  }
  if (Number.isFinite(seen.level) && level > seen.level) notices.push({ type: 'level', from: seen.level, to: level });
  if (notices.length) await celebrate(notices);
}

// After an entry is logged or deleted: repaint the level, and celebrate if
// the entry just logged took the member up, however many levels.
async function levelChanged(result) {
  const { data: lv } = await sb.rpc('my_level');
  if (!lv) return;
  paintLevel(lv);
  if (standing.rank) writeSeen({ rank: standing.rank.code, level: lv.level });
  if (result && result.level_after > result.level_before) {
    await celebrate([{ type: 'level', from: result.level_before, to: result.level_after }]);
  }
}

/* =====================================================
   Library
   ===================================================== */
let allVideos = [];

async function initLibrary() {
  const branchSel = $('#v-branch');
  const catSel = $('#v-cat');
  const q = $('#v-q');

  const list = await loadBranches();
  const active = await activeBranch();
  branchSel.innerHTML = `<option value="">All branches</option>` + list
    .map((b) => `<option value="${esc(b.id ?? '')}"${b.slug === active.slug ? ' selected' : ''}>${esc(b.name)}</option>`)
    .join('');

  // RLS only returns videos to active members, and never archived ones.
  const { data, error } = await sb.from('videos')
    .select('id, title, description, category, branch_id, source_type, source_ref, recorded_on, branches(name)')
    .order('recorded_on', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    $('#v-grid').innerHTML = `<p class="empty">The library could not be loaded just now.</p>`;
    return;
  }
  allVideos = data;

  const cats = [...new Set(data.map((v) => v.category).filter(Boolean))].sort();
  catSel.innerHTML = `<option value="">All categories</option>` +
    cats.map((c) => `<option>${esc(c)}</option>`).join('');

  const paint = () => paintLibrary(branchSel.value, catSel.value, q.value.trim().toLowerCase());
  branchSel.addEventListener('change', paint);
  catSel.addEventListener('change', paint);
  q.addEventListener('input', paint);

  // The header's branch switcher drives the library too.
  onBranch((b) => { if (b.id) { branchSel.value = b.id; paint(); } });
  paint();
}

function paintLibrary(branchId, cat, needle) {
  const grid = $('#v-grid');
  const shown = allVideos.filter((v) =>
    (!branchId || v.branch_id === branchId || v.branch_id === null) &&
    (!cat || v.category === cat) &&
    (!needle || `${v.title} ${v.description || ''}`.toLowerCase().includes(needle)));

  if (!allVideos.length) {
    grid.innerHTML = `<p class="empty">Nothing in the library yet. Coaches add sessions and tutorials here after training.</p>`;
    return;
  }
  if (!shown.length) {
    grid.innerHTML = `<p class="empty">No videos match those filters.</p>`;
    return;
  }

  // Players load on tap. Thirty embedded players on one page is a lot to ask
  // of a phone on mobile data; a thumbnail costs almost nothing.
  grid.innerHTML = shown.map((v) => {
    const thumb = videoThumb(v);
    return `
      <article class="vid-card" data-id="${esc(v.id)}">
        <button class="vid-facade" type="button" aria-label="Play: ${esc(v.title)}">
          ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : ''}
          <span class="play" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><path d="M4 2.5v13l11-6.5z"/></svg>
          </span>
        </button>
        <div class="vid-body">
          <p class="meta">${esc(v.category)} &middot; ${esc(v.branches?.name || 'All branches')}${v.recorded_on ? ` &middot; ${esc(dateShort(v.recorded_on))}` : ''}</p>
          <h3 class="tile-title mt1">${esc(v.title)}</h3>
          ${v.description ? `<p class="small muted">${esc(v.description)}</p>` : ''}
        </div>
      </article>`;
  }).join('');

  $$('.vid-facade', grid).forEach((btn) => btn.addEventListener('click', () => {
    const card = btn.closest('.vid-card');
    const v = allVideos.find((x) => x.id === card.dataset.id);
    const holder = document.createElement('div');
    holder.innerHTML = renderVideo(v);
    const player = holder.firstElementChild;
    btn.replaceWith(player);
    // Autoplay once the member has asked for it; focus the player for keyboard users.
    const frame = player.querySelector('iframe');
    if (frame) {
      frame.src += '&autoplay=1';
      frame.focus();
    }
  }));
}

/* =====================================================
   Record: attendance and training rounds
   ===================================================== */
let recordLoaded = false;
async function loadRecord() {
  if (recordLoaded) return;
  recordLoaded = true;

  const [att, tr] = await Promise.all([sb.rpc('my_attendance', { p_limit: 200 }), sb.rpc('my_training_record', { p_limit: 200 })]);

  const aBody = $('#r-attend');
  aBody.innerHTML = att.error ? `<tr><td colspan="3" class="muted">Could not load attendance.</td></tr>`
    : !att.data.length ? `<tr><td colspan="3" class="muted">No sessions recorded yet. Scan the QR code at the venue, or your coach will tick you off the register.</td></tr>`
    : att.data.map((a) => `
      <tr>
        <td class="nowrap">${esc(dateShort(a.held_on))}</td>
        <td>${esc(a.label)}${a.branch_name ? ` <span class="muted small">&middot; ${esc(a.branch_name)}</span>` : ''}</td>
        <td><span class="pill">${a.source === 'qr' ? 'QR scan' : 'Coach'}</span></td>
      </tr>`).join('');

  const mBody = $('#r-matches');
  mBody.innerHTML = tr.error ? `<tr><td colspan="3" class="muted">Could not load training rounds.</td></tr>`
    : !tr.data.length ? `<tr><td colspan="3" class="muted">No rounds logged yet. Coaches log training wins after sessions.</td></tr>`
    : tr.data.map((m) => `
      <tr>
        <td class="nowrap">${esc(dateShort(m.held_on))}</td>
        <td><span class="pill ${m.result === 'win' ? 'pill-good' : ''}">${m.result === 'win' ? 'Won' : 'Lost'}</span></td>
        <td>${esc(m.opponent_name || '—')}</td>
      </tr>`).join('');
}

/* =====================================================
   Points history, rules and ladder
   ===================================================== */
let pointsLoaded = false;
async function loadPoints() {
  if (pointsLoaded) return;
  pointsLoaded = true;

  const [hist, rules, ranks] = await Promise.all([
    sb.rpc('my_points_history', { p_limit: 300 }),
    sb.from('point_rules').select('label, points, is_auto').eq('is_active', true).order('sort_order'),
    loadRanks(),
  ]);

  const body = $('#pts-body');
  body.innerHTML = hist.error ? `<tr><td colspan="4" class="muted">Could not load your points.</td></tr>`
    : !hist.data.length ? `<tr><td colspan="4" class="muted">No points yet. Your first session gets you on the board.</td></tr>`
    : hist.data.map((p) => `
      <tr>
        <td class="nowrap">${esc(dateShort(p.created_at))}</td>
        <td>${esc(p.reason || p.rule_label || 'Points')}</td>
        <td>${esc(p.awarded_by_name || '—')}</td>
        <td class="num"><span class="ledger-pts${p.points < 0 ? ' neg' : ''}">${p.points > 0 ? '+' : ''}${p.points}</span></td>
      </tr>`).join('');

  $('#rules-body').innerHTML = (rules.data || []).map((r) => `
    <tr>
      <td>${esc(r.label)}${r.is_auto ? ' <span class="pill">Automatic</span>' : ' <span class="pill">Coach approves</span>'}</td>
      <td class="num"><span class="ledger-pts">+${r.points}</span></td>
    </tr>`).join('');

  $('#ladder').innerHTML = ranks.map((r) => `
    <div class="flex" style="gap:.5rem;margin-right:1rem">
      ${rankPlate(r.code)}
      <span class="small">${r.min_points.toLocaleString('en-GB')}+</span>
    </div>`).join('');
}

/* =====================================================
   Claims: referrals, social tags, home workouts
   ===================================================== */
function initClaimForm() {
  const kind = $('#c-kind');
  const sync = () => {
    $('#c-ref-wrap').hidden = kind.value !== 'referral';
    $('#c-url-wrap').hidden = kind.value !== 'social_tag';
  };
  kind.addEventListener('change', sync);
  sync();

  $('#claim-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#c-msg');
    const row = {
      member_id: me.id,
      kind: kind.value,
      detail: $('#c-detail').value.trim() || null,
      referred_name: kind.value === 'referral' ? ($('#c-ref').value.trim() || null) : null,
      url: kind.value === 'social_tag' ? ($('#c-url').value.trim() || null) : null,
    };
    if (row.kind === 'referral' && !row.referred_name) {
      say(msg, 'Give your friend’s name so the coach can match them up.', 'flag');
      $('#c-ref').focus();
      return;
    }
    if (row.kind === 'social_tag' && !/^https?:\/\//i.test(row.url || '')) {
      say(msg, 'Paste the link to the post so the coach can see it.', 'flag');
      $('#c-url').focus();
      return;
    }

    const btn = $('#c-submit');
    busy(btn, true, 'Sending…');
    const { error } = await sb.from('member_claims').insert(row);
    busy(btn, false);
    if (error) {
      say(msg, 'That could not be sent. Please try again.', 'flag');
      return;
    }
    e.target.reset();
    sync();
    say(msg, 'Sent. A coach will check it — you will see the points here once it is approved.', 'good');
    claimsLoaded = false;
    loadClaims();
  });
}

let claimsLoaded = false;
async function loadClaims() {
  if (claimsLoaded) return;
  claimsLoaded = true;
  const labels = { referral: 'Referral', social_tag: 'Social tag', home_workout: 'Home workout' };
  const { data, error } = await sb.from('member_claims')
    .select('kind, referred_name, status, created_at, review_note')
    .order('created_at', { ascending: false })
    .limit(50);

  const body = $('#c-list');
  body.innerHTML = error ? `<tr><td colspan="3" class="muted">Could not load your claims.</td></tr>`
    : !data.length ? `<tr><td colspan="3" class="muted">Nothing claimed yet.</td></tr>`
    : data.map((c) => `
      <tr>
        <td class="nowrap">${esc(dateShort(c.created_at))}</td>
        <td>${esc(labels[c.kind] || c.kind)}${c.referred_name ? ` <span class="muted small">&middot; ${esc(c.referred_name)}</span>` : ''}
          ${c.review_note ? `<br><span class="small muted">${esc(c.review_note)}</span>` : ''}</td>
        <td><span class="pill ${c.status === 'approved' ? 'pill-good' : c.status === 'rejected' ? 'pill-flag' : ''}">${esc(c.status)}</span></td>
      </tr>`).join('');
}

