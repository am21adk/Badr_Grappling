/* Badr Grappling — shared runtime.
 * Supabase client, the site-wide branch selection, and small helpers.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { CONFIG } from './config.js';

export const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const CLUB = CONFIG.CLUB;

/* ---------- tiny DOM helpers ---------- */
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

/** Escape for interpolation into innerHTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const qp = (k, d = null) => new URLSearchParams(location.search).get(k) ?? d;

/** Admin-written plain text -> safe paragraphs. No HTML is ever trusted. */
export function paragraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** URL-safe slug from a title, e.g. for updates and appeals. */
export const slugify = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 70);

/* ---------- formatting ---------- */
export const money = (pence, currency = 'GBP') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: pence % 100 ? 2 : 0 })
    .format((pence || 0) / 100);

export const dateLong = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

export const dateShort = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';

export const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

/** A member's name as admin lists show it. If anyone else in `all` has the
 *  same name, their email is added (or their join date, if there is no
 *  email), so a coach never has to guess which of two people they're picking. */
export function whoIs(m, all = []) {
  if (!m) return '';
  const same = (x) => (x.full_name || '').trim().toLowerCase() === (m.full_name || '').trim().toLowerCase();
  if (!all.some((x) => x.id !== m.id && same(x))) return m.full_name;
  return `${m.full_name} (${m.email || `joined ${dateShort(m.joined_on)}`})`;
}

/** 24h "19:30:00" -> "7.30pm", the way the club writes its timetable. */
export function clockTime(t) {
  if (!t) return '';
  const [H, M] = String(t).split(':').map(Number);
  const ampm = H >= 12 ? 'pm' : 'am';
  const h12 = H % 12 === 0 ? 12 : H % 12;
  return M ? `${h12}.${String(M).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dayName = (n) => DAYS[n] ?? '';

/* ---------- status messaging ---------- */
// A dropped connection reaches the page as "TypeError: Failed to fetch"
// (Chrome), "NetworkError when attempting to fetch resource." (Firefox) or
// "Load failed" (Safari). None of that means anything to a coach, and the
// request may well have landed before the reply was lost, so say so plainly.
const OFFLINE = /failed to fetch|networkerror|load failed|network request failed/i;
export const OFFLINE_TEXT = 'Could not reach the club’s database just now. If you were saving '
  + 'something, refresh the page to check whether it went through before trying again.';

export function say(node, message, kind = '') {
  if (!node) return;
  if (kind === 'flag' && OFFLINE.test(message || '')) message = OFFLINE_TEXT;
  node.className = 'notice' + (kind ? ` notice-${kind}` : '');
  node.textContent = message || '';
  node.hidden = !message;
}

export function busy(btn, on, labelWhenBusy = 'Working…') {
  if (!btn) return;
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.textContent = labelWhenBusy;
    btn.setAttribute('aria-disabled', 'true');
  } else {
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.removeAttribute('aria-disabled');
  }
}

/* =====================================================
   Branches
   The active branch is site-wide and persists across
   pages. Adding a branch is a row in `branches` — no
   code anywhere hard-codes London or Manchester.
   ===================================================== */

const BRANCH_KEY = 'badr.branch';
let _branches = null;   // the in-flight promise, so parallel callers share one request
let _active = null;

export function loadBranches() {
  _branches ??= sb
    .from('branches')
    .select('id, slug, name, city, address, postcode, maps_url, intro, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .then(({ data, error }) => {
      if (error || !data?.length) {
        console.warn('[badr] branches unavailable, using fallback', error);
        return [CONFIG.FALLBACK_BRANCH];
      }
      return data;
    });
  return _branches;
}

export async function activeBranch() {
  if (_active) return _active;
  const list = await loadBranches();
  let saved = null;
  try { saved = localStorage.getItem(BRANCH_KEY); } catch { /* storage blocked */ }
  _active = list.find((b) => b.slug === saved) || list[0];
  return _active;
}

export async function setBranch(slug) {
  const list = await loadBranches();
  const next = list.find((b) => b.slug === slug);
  if (!next || next.slug === _active?.slug) return _active;
  _active = next;
  try { localStorage.setItem(BRANCH_KEY, slug); } catch { /* private mode */ }
  document.dispatchEvent(new CustomEvent('branchchange', { detail: next }));
  return next;
}

/** Run `fn(branch)` now and again whenever the branch changes. */
export function onBranch(fn) {
  activeBranch().then(fn);
  document.addEventListener('branchchange', (e) => fn(e.detail));
}

/* =====================================================
   Auth
   ===================================================== */

export async function currentUser() {
  const { data } = await sb.auth.getUser();
  return data?.user ?? null;
}

let _profile = null;    // in-flight promise, shared by the header and the page
export function currentProfile({ fresh = false } = {}) {
  if (_profile && !fresh) return _profile;
  _profile = (async () => {
    const user = await currentUser();
    if (!user) return null;
    const { data, error } = await sb
      .from('members')
      .select('id, user_id, full_name, email, branch_id, role, status, joined_on, branches(slug, name)')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) console.warn('[badr] profile load failed', error);
    return data ?? null;
  })();
  return _profile;
}

export const isAdmin = (p) => p?.role === 'admin' || p?.role === 'super_admin';
export const isSuperAdmin = (p) => p?.role === 'super_admin';

/**
 * Gate a page. Sends unauthenticated visitors to the login page with a
 * `next` parameter so they land back where they were headed.
 */
export async function requireMember({ admin = false } = {}) {
  const user = await currentUser();
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`login.html?next=${next}`);
    return null;
  }
  const profile = await currentProfile();
  if (!profile) {
    location.replace('login.html?noaccount=1');
    return null;
  }
  if (profile.status !== 'active') {
    location.replace('login.html?inactive=1');
    return null;
  }
  if (admin && !isAdmin(profile)) {
    location.replace('portal.html?denied=1');
    return null;
  }
  return profile;
}

export async function signOut() {
  await sb.auth.signOut();
  location.href = 'index.html';
}

/* =====================================================
   Ranks
   Thresholds live in the database and are admin-editable.
   ===================================================== */

let _ranks = null;
export function loadRanks() {
  _ranks ??= sb
    .from('ranks')
    .select('code, label, min_points, sort_order')
    .order('min_points', { ascending: true })
    .then(({ data, error }) => ((error || !data?.length)
      ? [{ code: 'E', label: 'Rank E', min_points: 0, sort_order: 1 }]
      : data));
  return _ranks;
}

/** Where a points total sits on the ladder, and how far to the next rung. */
export function rankFor(points, ranks) {
  const total = Number(points) || 0;
  const ladder = [...ranks].sort((a, b) => a.min_points - b.min_points);
  let current = ladder[0];
  for (const r of ladder) if (total >= r.min_points) current = r;
  const next = ladder.find((r) => r.min_points > total) || null;
  const floor = current.min_points;
  const ceil = next ? next.min_points : floor;
  const span = ceil - floor;
  return {
    current,
    next,
    toNext: next ? next.min_points - total : 0,
    pct: next && span > 0 ? Math.min(100, Math.round(((total - floor) / span) * 100)) : 100,
  };
}

export function rankPlate(code, large = false) {
  return `<span class="rank${large ? ' rank-lg' : ''}" data-rank="${esc(code)}" aria-hidden="true">${esc(code)}</span>`;
}

/* =====================================================
   Tabs (WAI-ARIA pattern)
   Click or arrow keys to move; Home/End jump. The chosen
   tab is kept in the URL hash so a refresh stays put.
   ===================================================== */
export function initTabs(tablist, { onShow } = {}) {
  const tabs = $$('[role="tab"]', tablist);
  const show = (tab, focus = false) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (focus) tab.focus();
    const key = tab.id.replace(/^tab-/, '');
    if (location.hash !== `#${key}`) history.replaceState(null, '', `#${key}`);
    onShow?.(key);
  };

  tabs.forEach((t) => {
    t.type = 'button';
    t.addEventListener('click', () => show(t));
    t.addEventListener('keydown', (e) => {
      // Tabs hidden for this user's role are skipped by the keyboard too.
      const live = tabs.filter((x) => !x.hidden);
      const i = live.indexOf(t);
      let n = null;
      if (e.key === 'ArrowRight') n = (i + 1) % live.length;
      if (e.key === 'ArrowLeft')  n = (i - 1 + live.length) % live.length;
      if (e.key === 'Home') n = 0;
      if (e.key === 'End')  n = live.length - 1;
      if (n !== null) { e.preventDefault(); show(live[n], true); }
    });
  });

  const fromHash = tabs.find((t) => t.id === `tab-${location.hash.slice(1)}` && !t.hidden);
  show(fromHash || tabs.find((t) => !t.hidden) || tabs[0]);
  return { show: (key) => { const t = tabs.find((x) => x.id === `tab-${key}`); if (t) show(t); } };
}
