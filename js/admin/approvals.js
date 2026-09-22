/* Admin — approve or reject referrals, social tags and home workouts.
 * Points are granted by review_claim() on approval, never on submission.
 */
import { $, $$, esc, sb, dateShort, whoIs } from '../core.js';

const KIND = { referral: 'Referral', social_tag: 'Social tag', home_workout: 'Home workout' };
const RULE = { referral: 'referral', social_tag: 'social_tag', home_workout: 'home_workout' };

let ctx, panel, members = [], points = {};

export async function init(c, p) {
  ctx = c; panel = p;
  panel.innerHTML = `
    <div class="split">
      <div>
        <h2 class="h3 mb1">Waiting for a decision</h2>
        <div id="ap-pending"><p class="load">Loading…</p></div>
      </div>
      <div>
        <h2 class="h3 mb1">Recently decided</h2>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th scope="col">Member</th><th scope="col">Claim</th><th scope="col">Decision</th></tr></thead>
            <tbody id="ap-done"></tbody>
          </table>
        </div>
      </div>
    </div>`;
  await refresh();
}

export async function refresh() {
  members = await ctx.members();
  const { data: rules } = await sb.from('point_rules').select('code, points, is_active');
  points = Object.fromEntries((rules || []).filter((r) => r.is_active).map((r) => [r.code, r.points]));

  const ids = members.map((m) => m.id);
  const pendingHost = $('#ap-pending', panel);
  const doneBody = $('#ap-done', panel);
  if (!ids.length) {
    pendingHost.innerHTML = `<p class="empty">No active members at ${esc(ctx.branch.name)} yet.</p>`;
    doneBody.innerHTML = '';
    return;
  }

  const [pending, done] = await Promise.all([
    sb.from('member_claims').select('id, member_id, kind, detail, url, referred_name, created_at')
      .eq('status', 'pending').in('member_id', ids).order('created_at'),
    sb.from('member_claims').select('id, member_id, kind, status, reviewed_at, review_note')
      .neq('status', 'pending').in('member_id', ids).order('reviewed_at', { ascending: false }).limit(25),
  ]);

  const name = (id) => whoIs(members.find((m) => m.id === id), members) || 'Member';

  if (pending.error) {
    pendingHost.innerHTML = `<p class="empty">Could not load claims.</p>`;
  } else if (!pending.data.length) {
    pendingHost.innerHTML = `<p class="empty">Nothing waiting. Members’ referrals, social tags and home workouts appear here.</p>`;
  } else {
    pendingHost.innerHTML = pending.data.map((c) => {
      const pts = points[RULE[c.kind]] ?? 0;
      const safeUrl = /^https?:\/\//i.test(c.url || '') ? c.url : null;
      const self = c.member_id === ctx.me.id;
      return `
        <article class="claim-card" data-id="${esc(c.id)}">
          <div class="between">
            <p><strong>${esc(name(c.member_id))}</strong> <span class="pill">${esc(KIND[c.kind] || c.kind)}</span></p>
            <p class="meta">${esc(dateShort(c.created_at))}</p>
          </div>
          <dl class="kv mt1">
            ${c.referred_name ? `<dt>Friend</dt><dd>${esc(c.referred_name)}</dd>` : ''}
            ${safeUrl ? `<dt>Post</dt><dd><a class="link" href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">Open the post</a></dd>` : ''}
            ${c.detail ? `<dt>Details</dt><dd>${esc(c.detail)}</dd>` : ''}
          </dl>
          ${c.kind === 'referral' ? `<p class="hint mt1">Approve once the friend has signed up <em>and</em> attended.</p>` : ''}
          ${self ? `<p class="hint mt1">This is your own claim — another coach needs to review it.</p>` : `
          <div class="field mt1 mb0">
            <label for="note-${esc(c.id)}">Note to the member <span class="muted">(optional)</span></label>
            <input id="note-${esc(c.id)}" type="text" maxlength="200">
          </div>
          <div class="btn-row mt1">
            <button class="btn btn-sm" type="button" data-act="approve">Approve${pts ? ` (+${pts})` : ''}</button>
            <button class="btn btn-sm btn-ghost" type="button" data-act="reject">Reject</button>
          </div>`}
        </article>`;
    }).join('');

    $$('[data-act]', pendingHost).forEach((b) => b.addEventListener('click', () => decide(b)));
  }

  doneBody.innerHTML = (done.data || []).length
    ? done.data.map((c) => `
      <tr>
        <td>${esc(name(c.member_id))}</td>
        <td>${esc(KIND[c.kind] || c.kind)}${c.review_note ? `<br><span class="small muted">${esc(c.review_note)}</span>` : ''}</td>
        <td><span class="pill ${c.status === 'approved' ? 'pill-good' : 'pill-flag'}">${esc(c.status)}</span>
          <span class="small muted">${esc(dateShort(c.reviewed_at))}</span></td>
      </tr>`).join('')
    : `<tr><td colspan="3" class="muted">Nothing decided yet.</td></tr>`;
}

async function decide(btn) {
  const card = btn.closest('.claim-card');
  const id = card.dataset.id;
  const approve = btn.dataset.act === 'approve';
  const note = $(`#note-${CSS.escape(id)}`, card)?.value.trim() || null;
  $$('button', card).forEach((b) => { b.disabled = true; });

  const { data, error } = await sb.rpc('review_claim', { p_claim: id, p_approve: approve, p_note: note });
  if (error) {
    $$('button', card).forEach((b) => { b.disabled = false; });
    return ctx.flash(error.message, 'flag');
  }
  ctx.flash(approve ? `Approved — ${data?.points || 0} points added.` : 'Claim rejected.', 'good');
  ctx.refreshCounts();
  refresh();
}
