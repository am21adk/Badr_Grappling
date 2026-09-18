/* Badr Grappling — admin panel shell.
 *
 * Branch admins manage their own branch and nothing else. Super-admins get
 * a "Managing" selector across every branch, including inactive ones (so a
 * new branch can be set up before it goes public), plus the club-wide
 * Enquiries and Settings tabs. Row-level security enforces all of this in
 * the database; the UI just avoids showing controls that would be refused.
 */
import { $, $$, esc, sb, say, requireMember, isSuperAdmin, initTabs } from '../core.js';

const me = await requireMember({ admin: true });
if (me) boot();

const PANELS = {
  register:  () => import('./register.js'),
  qr:        () => import('./qr.js'),
  wins:      () => import('./wins.js'),
  points:    () => import('./points.js'),
  approvals: () => import('./approvals.js'),
  members:   () => import('./members.js'),
  videos:    () => import('./videos.js'),
  appeals:   () => import('./appeals.js'),
  updates:   () => import('./updates.js'),
  enquiries: () => import('./enquiries.js'),
  settings:  () => import('./settings.js'),
};

async function boot() {
  const isSuper = isSuperAdmin(me);
  $('#main').hidden = false;
  $('#ad-role').textContent = isSuper ? 'Super-admin · all branches' : 'Branch admin';
  if (isSuper) $$('[data-super]').forEach((t) => { t.hidden = false; });

  // ---------- branch scope ----------
  // Admins can read inactive branches (RLS), so this list includes them.
  const { data: allBranches } = await sb.from('branches')
    .select('id, slug, name, is_active, sort_order').order('sort_order');
  const branches = isSuper
    ? (allBranches || [])
    : (allBranches || []).filter((b) => b.id === me.branch_id);

  const scopeSel = $('#scope');
  if (!branches.length) {
    say($('#ad-msg'), 'Your admin account is not assigned to a branch yet. Ask a super-admin to set one.', 'flag');
    return;
  }
  scopeSel.innerHTML = branches.map((b) =>
    `<option value="${esc(b.id)}">${esc(b.name)}${b.is_active ? '' : ' (not live)'}</option>`).join('');
  scopeSel.value = branches.some((b) => b.id === me.branch_id) ? me.branch_id : branches[0].id;
  if (!isSuper) scopeSel.disabled = true;

  const ctx = {
    me,
    isSuper,
    branches,
    get branch() { return branches.find((b) => b.id === scopeSel.value); },
    flash: (text, kind = '') => {
      const m = $('#ad-msg');
      say(m, text, kind);
      if (text) m.scrollIntoView({ block: 'nearest' });
      clearTimeout(ctx._t);
      if (text && kind === 'good') ctx._t = setTimeout(() => say(m, ''), 4000);
    },
    members: (opts) => loadMembers(ctx, opts),
    refreshCounts: () => refreshCounts(ctx),
    invalidateMembers: () => { memberCache.clear(); },
  };

  // Each panel's module loads the first time its tab opens, and re-reads
  // its data every time it is shown again or the branch scope changes.
  const started = new Map();

  async function open(key) {
    const panel = $(`#panel-${key}`);
    try {
      const mod = started.get(key);
      if (!mod) {
        const m = await PANELS[key]();
        started.set(key, m);
        await m.init(ctx, panel);
      } else {
        await mod.refresh?.(ctx, panel);
      }
    } catch (err) {
      console.error(`[admin:${key}]`, err);
      ctx.flash(`That section could not load: ${err.message || err}`, 'flag');
    }
  }

  scopeSel.addEventListener('change', () => {
    memberCache.clear();
    ctx.flash('');
    const current = $('.admin-tabs [aria-selected="true"]')?.id.replace('tab-', '');
    if (current) open(current);
    refreshCounts(ctx);
  });

  initTabs($('.admin-tabs'), {
    onShow: (key) => { ctx.flash(''); open(key); },
  });

  refreshCounts(ctx);
}

/* ---------- shared member list for the current scope ---------- */
const memberCache = new Map();

async function loadMembers(ctx, { includePending = false } = {}) {
  const key = `${ctx.branch.id}:${includePending}`;
  if (memberCache.has(key)) return memberCache.get(key);
  let q = sb.from('members')
    .select('id, full_name, email, phone, role, status, branch_id, joined_on, created_at')
    .eq('branch_id', ctx.branch.id)
    .order('full_name');
  q = includePending ? q.in('status', ['active', 'pending']) : q.eq('status', 'active');
  const { data, error } = await q;
  if (error) throw error;
  memberCache.set(key, data);
  return data;
}

/* ---------- badge counts on the tabs ---------- */
async function refreshCounts(ctx) {
  const setCount = (id, n) => {
    const el = $(id);
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = !n;
  };

  const branchId = ctx.branch?.id;
  if (!branchId) return;

  // Pending claims for members of this branch. member_claims has two
  // foreign keys to members (member_id, reviewed_by), so filter by the
  // branch's member ids rather than through an ambiguous embed.
  const ids = (await loadMembers(ctx).catch(() => [])).map((m) => m.id);
  let claims = 0;
  if (ids.length) {
    const { count } = await sb.from('member_claims')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending').in('member_id', ids);
    claims = count || 0;
  }
  setCount('#n-approvals', claims);

  const { count: pendingMembers } = await sb.from('members')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', branchId).eq('status', 'pending');
  setCount('#n-members', pendingMembers || 0);

  if (ctx.isSuper) {
    const { count: newEnquiries } = await sb.from('branch_enquiries')
      .select('id', { count: 'exact', head: true }).eq('status', 'new');
    setCount('#n-enquiries', newEnquiries || 0);
  }
}
