/* Admin — the sessions and tutorials library.
 *
 * The form has a single "Video" field. What it accepts, and how it is
 * stored, belongs to js/video-source.js — today an unlisted YouTube link,
 * later a Supabase storage upload — so this form does not change when the
 * source does.
 */
import { $, $$, esc, sb, busy, dateShort } from '../core.js';
import { parseVideoInput, videoThumb, videoLink } from '../video-source.js';
import { ask } from '../dialog.js';

const DEFAULT_CATEGORIES = ['Technique', 'Session recording', 'Drills', 'Conditioning', 'Competition'];

let ctx, panel, videos = [], editing = null;

export async function init(c, p) {
  ctx = c; panel = p;
  panel.innerHTML = `
    <div class="split">
      <div>
        <div class="between mb1">
          <h2 class="h3">Library</h2>
          <label class="check mb0" style="align-items:center">
            <input type="checkbox" id="vd-archived">
            <span class="small">Show archived</span>
          </label>
        </div>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th scope="col"><span class="sr">Thumbnail</span></th><th scope="col">Video</th><th scope="col">Branch</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
            <tbody id="vd-list"><tr><td colspan="4" class="load">Loading…</td></tr></tbody>
          </table>
        </div>
      </div>
      <div>
        <h2 class="h3 mb1" id="vd-heading">Add a video</h2>
        <form method="post" class="panel" id="vd-form" novalidate>
          <div class="field">
            <label for="vd-source">Video</label>
            <input id="vd-source" type="url" inputmode="url" required placeholder="https://youtu.be/…" aria-describedby="vd-source-hint">
            <p class="hint" id="vd-source-hint">Paste the link to an <strong>unlisted</strong> YouTube video.
              Anyone with the link can watch it, so do not use this for anything private.</p>
          </div>
          <div class="field">
            <label for="vd-title">Title</label>
            <input id="vd-title" type="text" maxlength="140" required>
          </div>
          <div class="field">
            <label for="vd-desc">Description</label>
            <textarea id="vd-desc" maxlength="1000" style="min-height:5rem"></textarea>
          </div>
          <div class="row-2">
            <div class="field">
              <label for="vd-branch">Branch</label>
              <select id="vd-branch"></select>
            </div>
            <div class="field">
              <label for="vd-cat">Category</label>
              <input id="vd-cat" type="text" list="vd-cats" maxlength="40" required>
              <datalist id="vd-cats"></datalist>
            </div>
          </div>
          <div class="field">
            <label for="vd-date">Date</label>
            <input id="vd-date" type="date">
          </div>
          <div class="btn-row">
            <button class="btn btn-sm" type="submit" id="vd-save">Add to library</button>
            <button class="btn btn-sm btn-ghost" type="button" id="vd-cancel" hidden>Cancel</button>
          </div>
        </form>
      </div>
    </div>`;

  $('#vd-form', panel).addEventListener('submit', save);
  $('#vd-cancel', panel).addEventListener('click', resetForm);
  $('#vd-archived', panel).addEventListener('change', paintList);
  await refresh();
}

export async function refresh() {
  $('#vd-branch', panel).innerHTML =
    `<option value="${esc(ctx.branch.id)}">${esc(ctx.branch.name)}</option><option value="">All branches</option>`;

  const { data, error } = await sb.from('videos')
    .select('id, title, description, category, branch_id, source_type, source_ref, recorded_on, is_archived, branches(name)')
    .or(`branch_id.eq.${ctx.branch.id},branch_id.is.null`)
    .order('recorded_on', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) { $('#vd-list', panel).innerHTML = `<tr><td colspan="4" class="muted">Could not load videos.</td></tr>`; return; }
  videos = data;

  const cats = [...new Set([...DEFAULT_CATEGORIES, ...videos.map((v) => v.category)])].sort();
  $('#vd-cats', panel).innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join('');
  if (!editing) resetForm();
  paintList();
}

function paintList() {
  const body = $('#vd-list', panel);
  const withArchived = $('#vd-archived', panel).checked;
  const shown = videos.filter((v) => withArchived || !v.is_archived);
  if (!shown.length) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No videos yet. Add the first one with the form.</td></tr>`;
    return;
  }
  body.innerHTML = shown.map((v) => `
    <tr data-id="${esc(v.id)}"${v.is_archived ? ' style="opacity:.6"' : ''}>
      <td style="width:80px">${videoThumb(v) ? `<img class="thumb-sm" src="${esc(videoThumb(v))}" alt="" loading="lazy">` : ''}</td>
      <td><strong>${esc(v.title)}</strong>${v.is_archived ? ' <span class="pill">Archived</span>' : ''}<br>
        <span class="small muted">${esc(v.category)}${v.recorded_on ? ` &middot; ${esc(dateShort(v.recorded_on))}` : ''}
        ${videoLink(v) ? ` &middot; <a class="link" href="${esc(videoLink(v))}" target="_blank" rel="noopener noreferrer">Source</a>` : ''}</span></td>
      <td class="small">${esc(v.branches?.name || 'All branches')}</td>
      <td class="action-cell">
        <button class="linkish small" type="button" data-edit>Edit</button>
        <button class="linkish small${v.is_archived ? '' : ' danger'}" type="button" data-archive>${v.is_archived ? 'Restore' : 'Archive'}</button>
        <button class="linkish danger small" type="button" data-del>Delete</button>
      </td>
    </tr>`).join('');

  $$('[data-edit]', body).forEach((b) => b.addEventListener('click', () => startEdit(b.closest('tr').dataset.id)));
  $$('[data-archive]', body).forEach((b) => b.addEventListener('click', async () => {
    const v = videos.find((x) => x.id === b.closest('tr').dataset.id);
    const { error } = await sb.from('videos').update({ is_archived: !v.is_archived }).eq('id', v.id);
    if (error) return ctx.flash(error.message, 'flag');
    ctx.flash(v.is_archived ? `“${v.title}” is back in the library.` : `“${v.title}” archived — members no longer see it.`, 'good');
    refresh();
  }));
  $$('[data-del]', body).forEach((b) => b.addEventListener('click', async () => {
    const v = videos.find((x) => x.id === b.closest('tr').dataset.id);
    if (!(await ask({
      title: `Delete “${v.title}”?`,
      body: 'This removes it from the library for good. Archiving instead hides it from members and keeps it.',
      confirm: 'Delete video', danger: true,
    }))) return;
    const { error } = await sb.from('videos').delete().eq('id', v.id);
    if (error) return ctx.flash(error.message, 'flag');
    if (editing?.id === v.id) resetForm();
    ctx.flash(`“${v.title}” deleted.`, 'good');
    refresh();
  }));
}

function startEdit(id) {
  const v = videos.find((x) => x.id === id);
  editing = v;
  $('#vd-heading', panel).textContent = 'Edit video';
  $('#vd-source', panel).value = videoLink(v) || v.source_ref;
  $('#vd-title', panel).value = v.title;
  $('#vd-desc', panel).value = v.description || '';
  $('#vd-branch', panel).value = v.branch_id || '';
  $('#vd-cat', panel).value = v.category;
  $('#vd-date', panel).value = v.recorded_on || '';
  $('#vd-save', panel).textContent = 'Save changes';
  $('#vd-cancel', panel).hidden = false;
  $('#vd-title', panel).focus();
}

function resetForm() {
  editing = null;
  $('#vd-form', panel).reset();
  $('#vd-heading', panel).textContent = 'Add a video';
  $('#vd-save', panel).textContent = 'Add to library';
  $('#vd-cancel', panel).hidden = true;
  $('#vd-branch', panel).value = ctx.branch.id;
  $('#vd-cat', panel).value = 'Technique';
  $('#vd-date', panel).value = new Date().toLocaleDateString('en-CA');
}

async function save(e) {
  e.preventDefault();
  const source = parseVideoInput($('#vd-source', panel).value);
  const title = $('#vd-title', panel).value.trim();
  const category = $('#vd-cat', panel).value.trim();
  if (!source) return ctx.flash('That does not look like a YouTube link. Paste the video’s share link.', 'flag');
  if (!title) return ctx.flash('Give the video a title.', 'flag');
  if (!category) return ctx.flash('Give the video a category.', 'flag');

  const row = {
    ...source,
    title,
    description: $('#vd-desc', panel).value.trim() || null,
    branch_id: $('#vd-branch', panel).value || null,
    category,
    recorded_on: $('#vd-date', panel).value || null,
  };

  const btn = $('#vd-save', panel);
  busy(btn, true, 'Saving…');
  const q = editing
    ? sb.from('videos').update(row).eq('id', editing.id)
    : sb.from('videos').insert({ ...row, created_by: ctx.me.id });
  const { error } = await q;
  busy(btn, false);
  if (error) return ctx.flash(error.message, 'flag');

  ctx.flash(editing ? 'Video updated.' : `“${title}” added — members can watch it in the portal now.`, 'good');
  editing = null;
  refresh();
}
