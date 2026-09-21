/* Admin — settings.
 *
 * Every admin: their branch's public details and its timetable.
 * Super-admins also: the rank ladder, the point values, and adding a branch.
 * Adding a branch is only ever a new row — nothing in the code names one.
 */
import { $, $$, esc, sb, busy, dayName, clockTime, slugify } from '../core.js';
import { ask } from '../dialog.js';

let ctx, panel;

export async function init(c, p) {
  ctx = c; panel = p;
  await refresh();
}

export async function refresh() {
  panel.innerHTML = `
    <div class="split-even">
      <section aria-labelledby="st-branch-h">
        <h2 class="h3 mb1" id="st-branch-h">${esc(ctx.branch.name)} — public details</h2>
        <form method="post" class="panel" id="st-branch" novalidate><p class="load">Loading…</p></form>
      </section>
      <section aria-labelledby="st-tt-h">
        <h2 class="h3 mb1" id="st-tt-h">${esc(ctx.branch.name)} — timetable</h2>
        <div id="st-tt"><p class="load">Loading…</p></div>
      </section>
    </div>
    ${ctx.isSuper ? `
    <hr class="mt3 mb2">
    <div class="split-even">
      <section aria-labelledby="st-ranks-h">
        <h2 class="h3 mb1" id="st-ranks-h">Rank ladder</h2>
        <p class="small muted mb1">Points needed to reach each rank. Changes apply to every branch straight away.</p>
        <div id="st-ranks"><p class="load">Loading…</p></div>
      </section>
      <section aria-labelledby="st-rules-h">
        <h2 class="h3 mb1" id="st-rules-h">Point values</h2>
        <p class="small muted mb1">Changes apply to points given from now on. Points already given stay as they were.</p>
        <div id="st-rules"><p class="load">Loading…</p></div>
      </section>
    </div>
    <hr class="mt3 mb2">
    <section aria-labelledby="st-new-h" style="max-width:36rem">
      <h2 class="h3 mb1" id="st-new-h">Add a branch</h2>
      <p class="small muted mb1">
        A new branch starts hidden from the public site. Fill in its details and timetable using
        the Managing selector above, then tick “Live on the public site”.
      </p>
      <form method="post" class="panel" id="st-new" novalidate>
        <div class="row-2">
          <div class="field"><label for="nb-name">Name</label><input id="nb-name" type="text" required placeholder="e.g. Birmingham"></div>
          <div class="field"><label for="nb-city">City</label><input id="nb-city" type="text"></div>
        </div>
        <button class="btn btn-sm" type="submit">Add branch</button>
      </form>
    </section>` : ''}`;

  await Promise.all([
    paintBranch(),
    paintTimetable(),
    ctx.isSuper ? paintRanks() : null,
    ctx.isSuper ? paintRules() : null,
  ]);
  if (ctx.isSuper) $('#st-new', panel).addEventListener('submit', addBranch);
}

/* ---------- branch details ---------- */
async function paintBranch() {
  const form = $('#st-branch', panel);
  const { data: b, error } = await sb.from('branches').select('*').eq('id', ctx.branch.id).single();
  if (error) { form.innerHTML = `<p class="muted">Could not load the branch.</p>`; return; }

  const f = (id, label, value, attrs = '') => `
    <div class="field"><label for="${id}">${label}</label><input id="${id}" type="text" value="${esc(value || '')}" ${attrs}></div>`;
  form.innerHTML = `
    ${f('sb-name', 'Name', b.name, 'required')}
    <div class="row-2">${f('sb-city', 'City', b.city)}${f('sb-postcode', 'Postcode', b.postcode)}</div>
    ${f('sb-address', 'Address', b.address)}
    ${f('sb-maps', 'Map link <span class="muted">(optional)</span>', b.maps_url, 'inputmode="url"')}
    ${f('sb-email', 'Contact email <span class="muted">(optional)</span>', b.contact_email, 'inputmode="email"')}
    <div class="field">
      <label for="sb-intro">Short introduction</label>
      <textarea id="sb-intro" maxlength="400" style="min-height:5rem">${esc(b.intro || '')}</textarea>
    </div>
    ${ctx.isSuper ? `
      <div class="row-2">
        <div class="field"><label for="sb-sort">Order in lists</label><input id="sb-sort" type="number" value="${esc(b.sort_order)}"></div>
      </div>
      <div class="check"><input id="sb-live" type="checkbox"${b.is_active ? ' checked' : ''}><label for="sb-live">Live on the public site</label></div>` : ''}
    <button class="btn btn-sm mt1" type="submit" id="sb-save">Save details</button>`;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#sb-name', form).value.trim();
    if (!name) return ctx.flash('The branch needs a name.', 'flag');
    const maps = $('#sb-maps', form).value.trim();
    if (maps && !/^https:\/\//i.test(maps)) return ctx.flash('The map link should start with https://', 'flag');

    const patch = {
      name,
      city: $('#sb-city', form).value.trim() || null,
      postcode: $('#sb-postcode', form).value.trim().toUpperCase() || null,
      address: $('#sb-address', form).value.trim() || null,
      maps_url: maps || null,
      contact_email: $('#sb-email', form).value.trim() || null,
      intro: $('#sb-intro', form).value.trim() || null,
    };
    if (ctx.isSuper) {
      patch.sort_order = parseInt($('#sb-sort', form).value, 10) || 100;
      patch.is_active = $('#sb-live', form).checked;
      if (patch.is_active && (!patch.address || !patch.intro)) {
        if (!(await ask({
          title: 'Put it live anyway?',
          body: 'This branch has no address or introduction yet.',
          confirm: 'Put it live',
        }))) return;
      }
    }
    const btn = $('#sb-save', form);
    busy(btn, true, 'Saving…');
    const { error } = await sb.from('branches').update(patch).eq('id', ctx.branch.id);
    busy(btn, false);
    if (error) return ctx.flash(error.message, 'flag');
    ctx.flash(`${name} saved. Reload the page to see the new name in the selectors.`, 'good');
  };
}

/* ---------- timetable ---------- */
async function paintTimetable() {
  const host = $('#st-tt', panel);
  const { data, error } = await sb.from('class_times')
    .select('id, label, age_group, weekday, starts_at, ends_at, note, is_active')
    .eq('branch_id', ctx.branch.id).order('weekday').order('starts_at');
  if (error) { host.innerHTML = `<p class="muted">Could not load the timetable.</p>`; return; }

  const dayOpts = (sel) => [1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}"${d === sel ? ' selected' : ''}>${dayName(d)}</option>`).join('');

  host.innerHTML = `
    ${data.length ? `<div class="table-scroll"><table class="table">
      <thead><tr><th scope="col">Class</th><th scope="col">When</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
      <tbody>${data.map((c) => `
        <tr data-id="${esc(c.id)}"${c.is_active ? '' : ' style="opacity:.55"'}>
          <td><strong>${esc(c.label)}</strong>${c.age_group ? ` <span class="pill">${esc(c.age_group)}</span>` : ''}${c.is_active ? '' : ' <span class="pill">Hidden</span>'}
            ${c.note ? `<br><span class="small muted">${esc(c.note)}</span>` : ''}</td>
          <td class="nowrap">${esc(dayName(c.weekday))} ${esc(clockTime(c.starts_at))}–${esc(clockTime(c.ends_at))}</td>
          <td class="action-cell">
            <button class="linkish small" type="button" data-toggle>${c.is_active ? 'Hide' : 'Show'}</button>
            <button class="linkish small danger" type="button" data-del>Delete</button>
          </td>
        </tr>`).join('')}</tbody></table></div>`
      : `<p class="empty">No classes yet. Add the first one below.</p>`}
    <form method="post" class="panel mt2" id="tt-form" novalidate>
      <h3 class="h3 mb1" style="font-size:1.05rem">Add a class</h3>
      <div class="row-2">
        <div class="field"><label for="tt-label">Class name</label><input id="tt-label" type="text" required placeholder="e.g. Adults class"></div>
        <div class="field"><label for="tt-age">Age group <span class="muted">(optional)</span></label><input id="tt-age" type="text" placeholder="e.g. 16+"></div>
      </div>
      <div class="field"><label for="tt-day">Day</label><select id="tt-day">${dayOpts(5)}</select></div>
      <div class="row-2">
        <div class="field"><label for="tt-start">Starts</label><input id="tt-start" type="time" required value="19:30"></div>
        <div class="field"><label for="tt-end">Ends</label><input id="tt-end" type="time" required value="21:00"></div>
      </div>
      <div class="field"><label for="tt-note">Note <span class="muted">(optional)</span></label><input id="tt-note" type="text" maxlength="200"></div>
      <button class="btn btn-sm" type="submit">Add class</button>
    </form>`;

  $$('[data-toggle]', host).forEach((b) => b.addEventListener('click', async () => {
    const c = data.find((x) => x.id === b.closest('tr').dataset.id);
    const { error: e } = await sb.from('class_times').update({ is_active: !c.is_active }).eq('id', c.id);
    if (e) return ctx.flash(e.message, 'flag');
    paintTimetable();
  }));
  $$('[data-del]', host).forEach((b) => b.addEventListener('click', async () => {
    const c = data.find((x) => x.id === b.closest('tr').dataset.id);
    if (!(await ask({
      title: `Delete “${c.label}” from the timetable?`,
      body: 'Past sessions and attendance are kept.',
      confirm: 'Delete', danger: true,
    }))) return;
    const { error: e } = await sb.from('class_times').delete().eq('id', c.id);
    if (e) return ctx.flash(e.message, 'flag');
    paintTimetable();
  }));

  $('#tt-form', host).addEventListener('submit', async (e) => {
    e.preventDefault();
    const label = $('#tt-label', host).value.trim();
    const starts_at = $('#tt-start', host).value;
    const ends_at = $('#tt-end', host).value;
    if (!label) return ctx.flash('Give the class a name.', 'flag');
    if (!starts_at || !ends_at || ends_at <= starts_at) return ctx.flash('The class needs to end after it starts.', 'flag');
    const { error: err } = await sb.from('class_times').insert({
      branch_id: ctx.branch.id,
      label,
      age_group: $('#tt-age', host).value.trim() || null,
      weekday: parseInt($('#tt-day', host).value, 10),
      starts_at, ends_at,
      note: $('#tt-note', host).value.trim() || null,
    });
    if (err) return ctx.flash(err.message, 'flag');
    ctx.flash(`${label} added to the ${ctx.branch.name} timetable.`, 'good');
    paintTimetable();
  });
}

/* ---------- rank ladder (super-admin) ---------- */
async function paintRanks() {
  const host = $('#st-ranks', panel);
  // In ladder order (E first), not threshold order, so a mistyped threshold
  // shows up in the wrong place instead of silently reordering the ladder.
  const { data, error } = await sb.from('ranks').select('id, code, label, min_points').order('sort_order');
  if (error) { host.innerHTML = `<p class="muted">Could not load ranks.</p>`; return; }

  host.innerHTML = `
    <form method="post" id="rk-form" novalidate>
      <div class="table-scroll"><table class="table">
        <thead><tr><th scope="col">Rank</th><th scope="col">Name</th><th scope="col" class="num">From (points)</th></tr></thead>
        <tbody>${data.map((r) => `
          <tr data-id="${esc(r.id)}">
            <td><span class="rank" data-rank="${esc(r.code)}">${esc(r.code)}</span></td>
            <td><label class="sr" for="rl-${esc(r.id)}">Name for rank ${esc(r.code)}</label>
              <input id="rl-${esc(r.id)}" data-label type="text" value="${esc(r.label)}" maxlength="30"></td>
            <td class="num"><label class="sr" for="rp-${esc(r.id)}">Points for rank ${esc(r.code)}</label>
              <input id="rp-${esc(r.id)}" data-min type="number" min="0" step="1" value="${r.min_points}" style="max-width:8rem;text-align:right"${r.min_points === 0 ? ' readonly title="The first rank always starts at 0"' : ''}></td>
          </tr>`).join('')}</tbody>
      </table></div>
      <button class="btn btn-sm mt1" type="submit">Save ladder</button>
    </form>`;

  $('#rk-form', host).addEventListener('submit', async (e) => {
    e.preventDefault();
    const rows = $$('tr[data-id]', host).map((tr) => ({
      id: tr.dataset.id,
      label: $('[data-label]', tr).value.trim(),
      min_points: parseInt($('[data-min]', tr).value, 10),
    }));
    if (rows.some((r) => !r.label || !Number.isInteger(r.min_points) || r.min_points < 0)) {
      return ctx.flash('Every rank needs a name and a whole number of points.', 'flag');
    }
    // The ladder has to climb: each rank needs more points than the one before.
    const ordered = [...rows].sort((a, b) => a.min_points - b.min_points);
    if (ordered[0].min_points !== 0) return ctx.flash('The first rank has to start at 0 points.', 'flag');
    if (new Set(rows.map((r) => r.min_points)).size !== rows.length) return ctx.flash('Two ranks cannot start at the same number of points.', 'flag');
    const byCode = data.map((d) => rows.find((r) => r.id === d.id));
    for (let i = 1; i < byCode.length; i++) {
      if (byCode[i].min_points <= byCode[i - 1].min_points) {
        return ctx.flash('Each rank must need more points than the rank below it (E < D < C < B < A < S).', 'flag');
      }
    }

    for (const r of rows) {
      const { error: err } = await sb.from('ranks').update({ label: r.label, min_points: r.min_points }).eq('id', r.id);
      if (err) return ctx.flash(err.message, 'flag');
    }
    ctx.flash('Rank ladder saved.', 'good');
    paintRanks();
  });

}

/* ---------- point values (super-admin) ---------- */
async function paintRules() {
  const host = $('#st-rules', panel);
  const { data, error } = await sb.from('point_rules').select('id, code, label, points, is_auto, is_active').order('sort_order');
  if (error) { host.innerHTML = `<p class="muted">Could not load point values.</p>`; return; }

  host.innerHTML = `
    <form method="post" id="pr-form" novalidate>
      <div class="table-scroll"><table class="table">
        <thead><tr><th scope="col">For</th><th scope="col" class="num">Points</th><th scope="col">On</th></tr></thead>
        <tbody>${data.map((r) => `
          <tr data-id="${esc(r.id)}">
            <td>${esc(r.label)}<br><span class="small muted">${r.is_auto ? 'Given automatically' : 'Given by a coach'}</span></td>
            <td class="num"><label class="sr" for="pp-${esc(r.id)}">Points for ${esc(r.label)}</label>
              <input id="pp-${esc(r.id)}" data-points type="number" min="0" max="1000" step="1" value="${r.points}" style="max-width:6rem;text-align:right"></td>
            <td><label class="sr" for="pa-${esc(r.id)}">${esc(r.label)} switched on</label>
              <input id="pa-${esc(r.id)}" data-active type="checkbox"${r.is_active ? ' checked' : ''} style="width:1.1rem;height:1.1rem;min-height:0;accent-color:var(--brass)"></td>
          </tr>`).join('')}</tbody>
      </table></div>
      <button class="btn btn-sm mt1" type="submit">Save point values</button>
    </form>`;

  $('#pr-form', host).addEventListener('submit', async (e) => {
    e.preventDefault();
    for (const tr of $$('tr[data-id]', host)) {
      const points = parseInt($('[data-points]', tr).value, 10);
      if (!Number.isInteger(points) || points < 0 || points > 1000) return ctx.flash('Point values must be whole numbers from 0 to 1000.', 'flag');
      const { error: err } = await sb.from('point_rules')
        .update({ points, is_active: $('[data-active]', tr).checked }).eq('id', tr.dataset.id);
      if (err) return ctx.flash(err.message, 'flag');
    }
    ctx.flash('Point values saved.', 'good');
    paintRules();
  });
}

/* ---------- add a branch (super-admin) ---------- */
async function addBranch(e) {
  e.preventDefault();
  const name = $('#nb-name', panel).value.trim();
  if (!name) return ctx.flash('Give the branch a name.', 'flag');
  const slug = slugify(name);
  const { error } = await sb.from('branches').insert({
    slug, name,
    city: $('#nb-city', panel).value.trim() || name,
    is_active: false,
    sort_order: 100,
  });
  if (error) return ctx.flash(error.code === '23505' ? `There is already a branch called ${name}.` : error.message, 'flag');
  ctx.flash(`${name} added (not live yet). Reload the page, pick it under Managing, and fill in its details and timetable.`, 'good');
}
