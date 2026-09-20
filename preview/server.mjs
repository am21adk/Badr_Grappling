// Badr Grappling — local preview with sample data.
//
//   node preview/server.mjs          then open http://localhost:8788
//
// Serves the site together with a small in-memory stand-in for Supabase
// (database, sign-in, storage) and the Cloudflare functions, so every page —
// portal and admin included — can be clicked through before the real
// Supabase project exists. Demo sign-ins take any password:
//   member@badr.test   a member with sample points and history
//   admin@badr.test    a super-admin
// Anyone can also sign up; new accounts wait for approval like the real site.
//
// Everything lives in memory and resets when the server stops. The members,
// updates, appeals and contributions in here are made up. Preview only: the
// build step never copies this folder, so it is never deployed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8788);

// Only the public site is served — never .git, the SQL, the README or this
// folder — so the preview is safe to open up through a tunnel.
const PUBLIC_DIRS = new Set(['css', 'js', 'assets']);
const isPublic = (rel) => {
  const parts = rel.split('/').filter(Boolean);
  if (parts.some((x) => x.startsWith('.') || x === '..')) return false;
  if (parts.length === 1) return /^[a-z-]+\.html$/.test(parts[0]);
  return PUBLIC_DIRS.has(parts[0]);
};
const uuid = () => crypto.randomUUID();
const iso = (d) => new Date(d).toISOString();
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };

/* ---------------- fixtures ---------------- */
const LON = 'b0000000-0000-4000-8000-000000000001';
const MAN = 'b0000000-0000-4000-8000-000000000002';
const people = [
  ['m1', 'Hassan Ali Rahimi', 'member'], ['m2', 'Yusuf Karim', 'member'], ['m3', 'Ali Reza Moosavi', 'member'],
  ['m4', 'Mahdi Jafari', 'member'], ['m5', 'Abbas Haidari', 'member'], ['m6', 'Sajjad Nouri', 'member'],
  ['m7', 'Kazim Hussaini', 'member'], ['m8', 'Zain Abidi', 'member'], ['ad', 'Adam Coach', 'super_admin'],
];
const mid = (k) => `a0000000-0000-4000-8000-0000000000${String(people.findIndex((p) => p[0] === k) + 10).padStart(2, '0')}`;

const db = {
  branches: [
    { id: LON, slug: 'london', name: 'London', city: 'London', address: 'Imam Hussain Mosque, 14 Brondesbury Road', postcode: 'NW6 6AS', maps_url: null,
      intro: 'Our founding branch. Adults and kids train every Friday evening at the mosque hall on Brondesbury Road.', contact_email: 'badrgrappling@outlook.com', is_active: true, sort_order: 10 },
    { id: MAN, slug: 'manchester', name: 'Manchester', city: 'Manchester', address: null, postcode: null, maps_url: null, intro: null, contact_email: null, is_active: false, sort_order: 20 },
  ],
  class_times: [
    { id: uuid(), branch_id: LON, label: 'Kids class', age_group: 'Under 16', weekday: 5, starts_at: '18:30:00', ends_at: '19:30:00', note: 'Children must be signed in and out by a parent or approved adult.', is_active: true },
    { id: uuid(), branch_id: LON, label: 'Adults class', age_group: '16+', weekday: 5, starts_at: '19:30:00', ends_at: '21:00:00', note: null, is_active: true },
  ],
  members: [
    ...people.map(([k, name, role], i) => ({ id: mid(k), user_id: `u-${k}`, full_name: name, email: `${k}@badr.test`, phone: i % 3 ? null : '07700 900' + (100 + i),
      branch_id: LON, role, status: 'active', joined_on: day(-400 + i * 30), created_at: iso(Date.now() - (400 - i * 30) * 864e5) })),
    { id: uuid(), user_id: 'u-p1', full_name: 'Omar Siddiqui', email: 'omar@badr.test', phone: '07700 900555', branch_id: LON, role: 'member', status: 'pending', joined_on: day(-2), created_at: iso(Date.now() - 2 * 864e5) },
    { id: uuid(), user_id: 'u-p2', full_name: 'Ibrahim Naqvi', email: 'ibrahim@badr.test', phone: null, branch_id: LON, role: 'member', status: 'pending', joined_on: day(-1), created_at: iso(Date.now() - 864e5) },
  ],
  ranks: [['E', 0], ['D', 250], ['C', 600], ['B', 1200], ['A', 2200], ['S', 4000]].map(([code, min], i) => ({ id: uuid(), code, label: `Rank ${code}`, min_points: min, sort_order: (i + 1) * 10 })),
  point_rules: [
    ['attend_session', 'Attend a session', 10, true], ['week_complete', 'Full week of sessions attended', 25, true],
    ['home_workout', 'Complete a logged home workout', 5, false], ['training_win', 'Win in a training round', 15, false],
    ['referral', 'Refer a friend who signs up and attends', 50, false], ['social_tag', 'Tag the club in a social post', 5, false],
  ].map(([code, label, points, is_auto], i) => ({ id: uuid(), code, label, points, is_auto, is_active: true, sort_order: (i + 1) * 10 })),
  updates: [
    { id: uuid(), slug: 'new-mats-are-down', title: 'New mats are down', excerpt: 'Forty square metres of new mat in the hall, thanks to everyone who chipped in.',
      body: 'Forty square metres of new mat went down in the hall on Thursday night, and Friday was the first session on them.\n\nThank you to everyone who contributed to the mats appeal, and to the brothers who stayed late to lay them.\n\nPlease keep shoes off the mat and wipe down after training.',
      image_url: 'assets/gallery/team-mats.jpg', branch_id: LON, is_published: true, published_at: iso(Date.now() - 3 * 864e5) },
    { id: uuid(), slug: 'kids-class-spaces', title: 'Spaces open in the kids class', excerpt: null,
      body: 'We have a small number of spaces in the Friday kids class, 6.30 to 7.30pm.\n\nParents: register through the Join page and come ten minutes early for the first session.',
      image_url: null, branch_id: LON, is_published: true, published_at: iso(Date.now() - 12 * 864e5) },
    { id: uuid(), slug: 'a-word-before-we-train', title: 'A word before we train', excerpt: 'Every session starts with a few minutes on why we are here.',
      body: 'Every session starts with a few minutes on why we are here: training the body, and working on the character that carries it.\n\nThis term those talks are being recorded for members in the portal.',
      image_url: 'assets/gallery/talk-before-training.jpg', branch_id: null, is_published: true, published_at: iso(Date.now() - 30 * 864e5) },
  ],
  appeals: [
    { id: 'c0000000-0000-4000-8000-000000000001', slug: 'new-mats-london', title: 'New mats for London', description: 'The mats we started on were borrowed and are coming apart at the seams.\n\nThis appeal pays for forty square metres of proper competition-grade mat, owned by the club, laid in the hall every Friday.',
      image_url: 'assets/gallery/team-mats.jpg', target_pence: 300000, deadline: day(40), branch_id: LON, is_active: true, sort_order: 10, created_at: iso(Date.now() - 20 * 864e5) },
    { id: 'c0000000-0000-4000-8000-000000000002', slug: 'competition-travel', title: 'Competition travel fund', description: 'Helps members get to their first competitions: entry fees, train fares and a night away where needed.',
      image_url: 'assets/gallery/team-line-up.jpg', target_pence: 150000, deadline: null, branch_id: null, is_active: true, sort_order: 20, created_at: iso(Date.now() - 60 * 864e5) },
  ],
  donations: [],
  videos: [
    ['Single-leg finish from the knees', 'Technique', -3], ['Friday session, full recording', 'Session recording', -3], ['Sprawl and go-behind drill', 'Drills', -10],
    ['Neck and grip conditioning', 'Conditioning', -17], ['Double-leg: setting up the shot', 'Technique', -24],
  ].map(([title, category, off], i) => ({ id: uuid(), title, description: i === 1 ? 'Warm-up, drilling and the last three live rounds.' : null, category, branch_id: i === 3 ? null : LON,
    source_type: 'youtube', source_ref: `abcdEFGH${String(i).padStart(3, '0')}`, recorded_on: day(off), is_archived: false, created_at: iso(Date.now() + off * 864e5) })),
  sessions: [],
  attendance: [],
  training_results: [],
  points_ledger: [],
  member_claims: [],
  branch_enquiries: [
    { id: uuid(), name: 'Ahmed Hasan', email: 'ahmed@example.com', phone: '07700 900321', city: 'Birmingham', grappling_background: 'Six years of freestyle wrestling, two of BJJ.', coaching_experience: 'Assistant coach at a university club for two years.', facility_access: 'Community hall at our mosque, available Tuesday and Thursday evenings. No mats yet.', why: 'There are a lot of young men here with nowhere like this to go.', status: 'new', admin_note: null, created_at: iso(Date.now() - 864e5) },
  ],
  qr_tokens: [],
};
db.donations = [
  [2500, 'paid', 'Hassan R.'], [5000, 'paid', null], [10000, 'paid', 'A supporter'], [2500, 'paid', 'Yusuf K.'], [1000, 'pending', null],
  [50000, 'paid', 'The Abidi family'], [25000, 'paid', null], [2500, 'refunded', 'Test'],
].map(([amt, status, name], i) => ({ id: uuid(), appeal_id: i < 6 ? db.appeals[0].id : db.appeals[1].id, amount_pence: amt, status, donor_name: name, donor_email: name ? 'donor@example.com' : null,
  is_anonymous: !name, is_recurring: i === 2, message: i === 5 ? 'For the brothers.' : null, created_at: iso(Date.now() - i * 864e5), paid_at: status === 'paid' ? iso(Date.now() - i * 864e5) : null }));
// sessions + attendance for the register
for (let w = 0; w < 4; w++) {
  const s = { id: uuid(), branch_id: LON, class_time_id: db.class_times[1].id, held_on: day(-7 * w - ((new Date().getDay() + 2) % 7)), label: 'Adults class', created_at: iso(Date.now() - w * 7 * 864e5) };
  db.sessions.push(s);
  people.slice(0, 7 - w).forEach(([k], i) => db.attendance.push({ id: uuid(), session_id: s.id, member_id: mid(k), source: i % 3 === 0 ? 'qr' : 'coach', recorded_at: iso(Date.now() - w * 7 * 864e5 - i * 60e3) }));
}
db.member_claims.push(
  { id: uuid(), member_id: mid('m2'), kind: 'referral', referred_name: 'Hamza Qureshi', detail: 'Came with me last Friday and signed up on the night.', url: null, status: 'pending', created_at: iso(Date.now() - 864e5) },
  { id: uuid(), member_id: mid('m3'), kind: 'social_tag', referred_name: null, detail: null, url: 'https://www.instagram.com/p/DTnXvsXCIUf/', status: 'pending', created_at: iso(Date.now() - 2 * 864e5) },
);
db.points_ledger.push(
  ...db.attendance.map((a) => ({ id: uuid(), member_id: a.member_id, points: 10, rule_code: 'attend_session', reason: 'Attended', awarded_by: null, source_type: 'attendance', created_at: a.recorded_at })),
  { id: uuid(), member_id: mid('m1'), points: 15, rule_code: 'training_win', reason: 'Training round won', awarded_by: mid('ad'), source_type: 'training_win', created_at: iso(Date.now() - 864e5) },
);

/* ---------------- auth ---------------- */
const USERS = {
  'member@badr.test': { id: 'u-m1', email: 'member@badr.test' },
  'admin@badr.test':  { id: 'u-ad', email: 'admin@badr.test' },
};
const tokenFor = (u) => `mock.${Buffer.from(JSON.stringify({ sub: u.id, email: u.email })).toString('base64url')}.sig`;
const userFromAuth = (req) => {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!t.startsWith('mock.')) return null;
  try { const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); return { id: p.sub, email: p.email, aud: 'authenticated', role: 'authenticated' }; }
  catch { return null; }
};
const session = (u) => ({ access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600 * 24, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24, refresh_token: 'mock-refresh', user: { ...u, aud: 'authenticated', role: 'authenticated' } });

/* ---------------- PostgREST-ish ---------------- */
function parseCond(col, expr) {
  const m = expr.match(/^(not\.)?(eq|neq|is|in|like|gte|lte|gt|lt)\.(.*)$/s);
  if (!m) return () => true;
  const [, not, op, rawVal] = m;
  const val = rawVal === 'null' ? null : rawVal === 'true' ? true : rawVal === 'false' ? false : rawVal;
  const f = (row) => {
    const v = row[col];
    switch (op) {
      case 'eq': return String(v) === String(val);
      case 'neq': return String(v) !== String(val);
      case 'is': return val === null ? v === null || v === undefined : v === val;
      case 'in': return rawVal.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(v));
      case 'like': return new RegExp('^' + rawVal.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/\*/g, '.*') + '$').test(String(v ?? ''));
      case 'gte': return String(v) >= String(val);
      case 'lte': return String(v) <= String(val);
      case 'gt': return String(v) > String(val);
      case 'lt': return String(v) < String(val);
    }
    return true;
  };
  return not ? (r) => !f(r) : f;
}
function filtersFrom(params) {
  const fs_ = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or') {
      const parts = v.replace(/^\(|\)$/g, '').split(/,(?![^(]*\))/).map((p) => { const [col, ...rest] = p.split('.'); return parseCond(col, rest.join('.')); });
      fs_.push((r) => parts.some((f) => f(r)));
    } else if (!k.includes('.')) fs_.push(parseCond(k, v));
  }
  return (r) => fs_.every((f) => f(r));
}
function embed(table, row) {
  const out = { ...row };
  if ('branch_id' in row) { const b = db.branches.find((x) => x.id === row.branch_id); out.branches = b ? { name: b.name, slug: b.slug } : null; }
  if (table === 'sessions') out.attendance = [{ count: db.attendance.filter((a) => a.session_id === row.id).length }];
  return out;
}
function sortRows(rows, order) {
  if (!order) return rows;
  const keys = order.split(',').map((o) => { const [col, dir] = o.split('.'); return { col, desc: dir === 'desc' }; });
  return [...rows].sort((a, b) => { for (const { col, desc } of keys) { const x = a[col] ?? '', y = b[col] ?? ''; if (x < y) return desc ? 1 : -1; if (x > y) return desc ? -1 : 1; } return 0; });
}

/* ---------------- RPCs ---------------- */
const me = (req) => { const u = userFromAuth(req); return u && db.members.find((m) => m.user_id === u.id); };
const SAMPLE = new Set(people.map(([k]) => mid(k)));      // the made-up demo members
const totalFor = (id) => db.points_ledger.filter((l) => l.member_id === id).reduce((n, l) => n + l.points, 0);
const rankOf = (pts) => [...db.ranks].sort((a, b) => a.min_points - b.min_points).filter((r) => r.min_points <= pts).pop();
const RPC = {
  my_summary: (req) => {
    const m = me(req);
    const pad = SAMPLE.has(m.id);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    return {
      points: totalFor(m.id) + (pad ? 300 : 0),
      points_month: pad ? 60 : db.points_ledger.filter((l) => l.member_id === m.id && new Date(l.created_at) >= monthStart).reduce((n, l) => n + l.points, 0),
      sessions: db.attendance.filter((a) => a.member_id === m.id).length + (pad ? 20 : 0),
      wins: pad ? 7 : db.training_results.filter((t) => t.winner_id === m.id).length,
      losses: pad ? 4 : db.training_results.filter((t) => t.opponent_id === m.id).length,
      streak_weeks: pad ? 6 : 0,
    };
  },
  leaderboard: (req, body) => {
    const m = me(req);
    const rows = db.members.filter((x) => x.status === 'active' && (!body.p_branch || x.branch_id === body.p_branch)).map((x, i) => {
      const pad = SAMPLE.has(x.id);
      const pts = totalFor(x.id) + (pad && !body.p_since ? 300 - i * 37 : 0) + (pad && x.id === m?.id ? 300 : 0);
      const [first, ...rest] = x.full_name.split(' ');
      const r = rankOf(pts);
      return { member_id: x.id, display_name: x.id === m?.id ? x.full_name : `${first}${rest.length ? ` ${rest.pop()[0]}.` : ''}`, is_me: x.id === m?.id, branch_id: x.branch_id,
        total_points: pts, sessions_attended: db.attendance.filter((a) => a.member_id === x.id).length + (pad && !body.p_since ? 18 - i : 0), training_wins: pad ? Math.max(0, 9 - i) : 0, rank_code: r.code, rank_label: r.label };
    });
    return rows.sort((a, b) => b.total_points - a.total_points);
  },
  my_points_history: (req) => { const m = me(req); return [...(SAMPLE.has(m.id) ? [
    { id: uuid(), points: 50, reason: 'Referral approved — welcome, Hamza', rule_label: 'Refer a friend who signs up and attends', awarded_by_name: 'Adam Coach', created_at: iso(Date.now() - 2 * 864e5) },
    { id: uuid(), points: 10, reason: `Attended ${day(-3)}`, rule_label: 'Attend a session', awarded_by_name: 'Automatic', created_at: iso(Date.now() - 3 * 864e5) },
    { id: uuid(), points: 15, reason: 'Training round won', rule_label: 'Win in a training round', awarded_by_name: 'Adam Coach', created_at: iso(Date.now() - 3 * 864e5) },
    { id: uuid(), points: 25, reason: 'Full week of sessions, week beginning 07 Sep 2026', rule_label: 'Full week of sessions attended', awarded_by_name: 'Automatic', created_at: iso(Date.now() - 5 * 864e5) },
    { id: uuid(), points: -10, reason: 'Correction: logged twice', rule_label: null, awarded_by_name: 'Adam Coach', created_at: iso(Date.now() - 9 * 864e5) },
    ] : []),
    ...db.points_ledger.filter((l) => l.member_id === m.id).map((l) => ({ ...l, rule_label: 'Attend a session', awarded_by_name: 'Automatic' })),
  ]; },
  my_attendance: (req) => { const m = me(req); return db.attendance.filter((a) => a.member_id === m.id).map((a) => { const s = db.sessions.find((x) => x.id === a.session_id); return { held_on: s.held_on, label: s.label, branch_name: 'London', source: a.source }; }); },
  my_training_record: (req) => !SAMPLE.has(me(req).id) ? [] : [
    { held_on: day(-3), result: 'win', opponent_name: 'Yusuf Karim', notes: null }, { held_on: day(-3), result: 'loss', opponent_name: 'Ali Reza Moosavi', notes: null },
    { held_on: day(-10), result: 'win', opponent_name: 'Mahdi Jafari', notes: 'Takedown in the last ten seconds' },
  ],
  ensure_qr_token: () => { const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); return { token: 'a3f9c2e17b8d4e6f9a0b1c2d3e4f5a6b', week_start: monday.toLocaleDateString('en-CA'), expires_at: iso(+monday + 7 * 864e5) }; },
  rotate_qr_token: () => ({ ...RPC.ensure_qr_token(), token: crypto.randomBytes(16).toString('hex') }),
  checkin_with_token: (req, body) => body.p_token === 'expired' ? { status: 'expired' } : { status: 'ok', branch: 'London', date: day(0), session: 'Adults class' },
  review_claim: (req, body) => { const c = db.member_claims.find((x) => x.id === body.p_claim); c.status = body.p_approve ? 'approved' : 'rejected'; c.reviewed_at = iso(Date.now()); c.review_note = body.p_note; return { status: c.status, points: body.p_approve ? 50 : 0 }; },
  delete_member: (req, body) => {
    const m = db.members.find((x) => x.id === body.p_member);
    if (!m) throw new Error('That member no longer exists');
    if (m.id === me(req)?.id) throw new Error('You cannot delete your own account');
    db.members = db.members.filter((x) => x.id !== body.p_member);
    for (const t of ['attendance', 'points_ledger', 'member_claims']) db[t] = db[t].filter((r) => r.member_id !== body.p_member);
    db.training_results = db.training_results.filter((r) => r.winner_id !== body.p_member);
    if (m.email) delete USERS[m.email];
    return { ok: true, name: m.full_name, login_removed: true };
  },
  adjust_points: (req, body) => { db.points_ledger.push({ id: uuid(), member_id: body.p_member, points: body.p_points, reason: body.p_reason, rule_code: body.p_rule, awarded_by: me(req).id, source_type: 'manual', created_at: iso(Date.now()) }); return { ok: true }; },
};

/* ---------------- server ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'Content-Range', ...headers });
  res.end(body === undefined ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  if (req.method === 'OPTIONS') return send(res, 204);

  if (p === '/js/config.js') {
    // Point the site at this server's stand-in at whatever address the page
    // was opened on — localhost here, or a forwarded port's public address
    // for someone else. Worked out in the browser, so it holds whatever
    // headers a tunnel or proxy passes along.
    const src = fs.readFileSync(path.join(SITE, 'js/config.js'), 'utf8')
      .replace(/SUPABASE_URL: '[^']*'/, `SUPABASE_URL: location.origin + '/mock'`).replace(/SUPABASE_ANON_KEY: '[^']*'/, `SUPABASE_ANON_KEY: 'mock-anon'`);
    return send(res, 200, src, { 'Content-Type': 'text/javascript' });
  }

  // ---- auth
  if (p === '/mock/auth/v1/token') {
    const b = await readBody(req);
    const u = USERS[String(b.email || '').trim().toLowerCase()];
    // The two demo accounts take any password; people who sign up use their own.
    const ok = u && (!u.password || u.password === b.password);
    return ok ? send(res, 200, session(u), { 'Content-Type': 'application/json' }) : send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' }, { 'Content-Type': 'application/json' });
  }
  if (p === '/mock/auth/v1/user') { const u = userFromAuth(req); return u ? send(res, 200, u, { 'Content-Type': 'application/json' }) : send(res, 401, { msg: 'no user' }); }
  if (p === '/mock/auth/v1/logout') return send(res, 204);
  if (p === '/mock/auth/v1/signup') {
    const b = await readBody(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (USERS[email]) return send(res, 422, { code: 'user_already_exists', msg: 'User already registered' }, { 'Content-Type': 'application/json' });
    const u = { id: `u-${uuid()}`, email, password: b.password };
    USERS[email] = u;
    // What the on_auth_user_created trigger does: an active member on the chosen branch.
    const branch = db.branches.find((x) => x.slug === b.data?.branch_slug);
    db.members.push({ id: uuid(), user_id: u.id, full_name: b.data?.full_name || email.split('@')[0], email, phone: b.data?.phone || null,
      branch_id: branch?.id || null, role: 'member', status: 'active', joined_on: day(0), created_at: iso(Date.now()) });
    console.log(`[mock] signed up ${email} (active)`);
    // Behaves like Supabase with email confirmation switched off: signed straight in.
    return send(res, 200, session(u), { 'Content-Type': 'application/json' });
  }
  if (p === '/mock/auth/v1/recover') return send(res, 200, {}, { 'Content-Type': 'application/json' });

  // ---- storage
  if (p.startsWith('/mock/storage/v1/object/public/media/')) {
    const f = path.join(SITE, 'assets/gallery/team-mats.jpg');
    return send(res, 200, fs.readFileSync(f), { 'Content-Type': 'image/jpeg' });
  }
  if (p.startsWith('/mock/storage/v1/object/media/')) return send(res, 200, { Key: p.replace('/mock/storage/v1/object/', '') }, { 'Content-Type': 'application/json' });

  // ---- functions
  if (p === '/api/checkout') { const b = await readBody(req); return send(res, 200, { url: `/appeal.html?slug=${encodeURIComponent(b.appeal)}&thanks=1` }, { 'Content-Type': 'application/json' }); }
  if (p === '/api/enquiry') { const b = await readBody(req); db.branch_enquiries.unshift({ id: uuid(), ...b, status: 'new', created_at: iso(Date.now()) }); return send(res, 200, { ok: true }, { 'Content-Type': 'application/json' }); }

  // ---- rpc
  const rpc = p.match(/^\/mock\/rest\/v1\/rpc\/(\w+)$/);
  if (rpc) {
    const fn = RPC[rpc[1]];
    if (!fn) return send(res, 404, { message: `no rpc ${rpc[1]}` });
    // A raise in a real function comes back as an error the page shows, not a crash.
    try {
      const out = fn(req, await readBody(req));
      return send(res, 200, out, { 'Content-Type': 'application/json' });
    } catch (e) {
      return send(res, 400, { message: e.message }, { 'Content-Type': 'application/json' });
    }
  }

  // ---- tables
  const tm = p.match(/^\/mock\/rest\/v1\/(\w+)$/);
  if (tm) {
    const table = tm[1];
    if (table === 'appeal_totals') {
      const rows = db.appeals.map((a) => ({ appeal_id: a.id, slug: a.slug,
        raised_pence: db.donations.filter((d) => d.appeal_id === a.id && d.status === 'paid').reduce((n, d) => n + d.amount_pence, 0),
        donation_count: db.donations.filter((d) => d.appeal_id === a.id && d.status === 'paid').length }));
      return send(res, 200, rows.filter(filtersFrom(url.searchParams)), { 'Content-Type': 'application/json' });
    }
    const rows = db[table];
    if (!rows) return send(res, 404, { message: `no table ${table}` });
    const match = filtersFrom(url.searchParams);
    const wantsObject = (req.headers.accept || '').includes('vnd.pgrst.object');

    if (req.method === 'GET' || req.method === 'HEAD') {
      let out = sortRows(rows.filter(match), url.searchParams.get('order'));
      const total = out.length;
      if (url.searchParams.get('limit')) out = out.slice(0, Number(url.searchParams.get('limit')));
      out = out.map((r) => embed(table, r));
      const headers = { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(0, out.length - 1)}/${total}` };
      if (req.method === 'HEAD') return send(res, 200, undefined, headers);
      if (wantsObject) return out.length ? send(res, 200, out[0], headers) : send(res, 406, { code: 'PGRST116', message: 'no rows' }, headers);
      return send(res, 200, out, headers);
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const list = (Array.isArray(b) ? b : [b]).map((r) => ({ id: uuid(), created_at: iso(Date.now()), ...r }));
      rows.push(...list);
      return send(res, 201, wantsObject ? list[0] : list, { 'Content-Type': 'application/json' });
    }
    if (req.method === 'PATCH') {
      const b = await readBody(req);
      const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, b));
      return send(res, 200, hit, { 'Content-Type': 'application/json' });
    }
    if (req.method === 'DELETE') {
      const keep = rows.filter((r) => !match(r)); const gone = rows.length - keep.length;
      db[table] = keep;
      return send(res, 200, [], { 'Content-Type': 'application/json', 'Content-Range': `*/${gone}` });
    }
  }

  // ---- static (public site only)
  let rel;
  try { rel = decodeURIComponent(p === '/' ? '/index.html' : p); } catch { return send(res, 400, 'Bad request'); }
  const f = path.join(SITE, rel);
  if (isPublic(rel) && f.startsWith(SITE + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    return send(res, 200, fs.readFileSync(f), { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  }
  send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
}).listen(PORT, () => {
  console.log(`Badr Grappling preview (sample data) on http://localhost:${PORT}`);
  console.log('Demo sign-ins, any password: member@badr.test, admin@badr.test');
});
