/* Admin — club news and announcements. */
import { $, $$, esc, sb, busy, dateShort, slugify } from '../core.js';
import { uploadImage } from './upload.js';

let ctx, panel, posts = [], editing = null;

export async function init(c, p) {
  ctx = c; panel = p;
  panel.innerHTML = `
    <div class="split">
      <div>
        <h2 class="h3 mb1">Posts</h2>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th scope="col">Post</th><th scope="col">Status</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
            <tbody id="up-list"><tr><td colspan="3" class="load">Loading…</td></tr></tbody>
          </table>
        </div>
      </div>
      <div>
        <h2 class="h3 mb1" id="up-heading">New post</h2>
        <form method="post" class="panel" id="up-form" novalidate>
          <div class="field">
            <label for="up-title">Title</label>
            <input id="up-title" type="text" maxlength="140" required>
          </div>
          <div class="field">
            <label for="up-body">Post</label>
            <textarea id="up-body" maxlength="10000" required style="min-height:12rem" aria-describedby="up-body-hint"></textarea>
            <p class="hint" id="up-body-hint">Plain text. Leave a blank line between paragraphs.</p>
          </div>
          <div class="field">
            <label for="up-excerpt">Summary <span class="muted">(optional)</span></label>
            <input id="up-excerpt" type="text" maxlength="240" aria-describedby="up-excerpt-hint">
            <p class="hint" id="up-excerpt-hint">Shown in the list of updates. The first paragraph is used if left empty.</p>
          </div>
          <div class="field">
            <label for="up-img">Image <span class="muted">(optional)</span></label>
            <input id="up-img" type="file" accept="image/jpeg,image/png,image/webp">
            <div id="up-img-now" class="mt1"></div>
          </div>
          <div class="field">
            <label for="up-alt">Describe the image</label>
            <input id="up-alt" type="text" maxlength="200" aria-describedby="up-alt-hint">
            <p class="hint" id="up-alt-hint">Needed if the post has an image. Read aloud to people using a screen reader.</p>
          </div>
          <div class="row-2">
            <div class="field">
              <label for="up-branch">Branch tag</label>
              <select id="up-branch"></select>
            </div>
            <div class="field">
              <label for="up-date">Date</label>
              <input id="up-date" type="date" required>
            </div>
          </div>
          <div class="check">
            <input id="up-pub" type="checkbox" checked>
            <label for="up-pub">Publish on the site</label>
          </div>
          <div class="btn-row mt1">
            <button class="btn btn-sm" type="submit" id="up-save">Publish</button>
            <button class="btn btn-sm btn-ghost" type="button" id="up-cancel" hidden>Cancel</button>
          </div>
        </form>
      </div>
    </div>`;

  $('#up-pub', panel).addEventListener('change', syncButton);
  $('#up-form', panel).addEventListener('submit', save);
  $('#up-cancel', panel).addEventListener('click', resetForm);
  await refresh();
}

function syncButton() {
  $('#up-save', panel).textContent = editing ? 'Save changes' : ($('#up-pub', panel).checked ? 'Publish' : 'Save draft');
}

export async function refresh() {
  $('#up-branch', panel).innerHTML =
    `<option value="${esc(ctx.branch.id)}">${esc(ctx.branch.name)}</option>` +
    (ctx.isSuper ? `<option value="">Club-wide</option>` : '');

  let q = sb.from('updates')
    .select('id, slug, title, excerpt, body, image_url, image_alt, branch_id, is_published, published_at')
    .order('published_at', { ascending: false }).limit(100);
  q = ctx.isSuper ? q.or(`branch_id.eq.${ctx.branch.id},branch_id.is.null`) : q.eq('branch_id', ctx.branch.id);
  const { data, error } = await q;
  if (error) { $('#up-list', panel).innerHTML = `<tr><td colspan="3" class="muted">Could not load posts.</td></tr>`; return; }
  posts = data;
  if (!editing) resetForm();
  paintList();
}

function paintList() {
  const body = $('#up-list', panel);
  if (!posts.length) { body.innerHTML = `<tr><td colspan="3" class="muted">Nothing posted yet.</td></tr>`; return; }
  body.innerHTML = posts.map((u) => `
    <tr data-id="${esc(u.id)}">
      <td><strong>${esc(u.title)}</strong><br>
        <span class="small muted">${esc(dateShort(u.published_at))} &middot; ${u.branch_id ? esc(ctx.branch.name) : 'Club-wide'}</span></td>
      <td>${u.is_published ? '<span class="pill pill-good">Published</span>' : '<span class="pill">Draft</span>'}</td>
      <td class="action-cell">
        ${u.is_published ? `<a class="linkish small" href="updates.html?post=${encodeURIComponent(u.slug)}" target="_blank" rel="noopener">View</a>` : ''}
        <button class="linkish small" type="button" data-edit>Edit</button>
        <button class="linkish small danger" type="button" data-del>Delete</button>
      </td>
    </tr>`).join('');

  $$('[data-edit]', body).forEach((b) => b.addEventListener('click', () => startEdit(b.closest('tr').dataset.id)));
  $$('[data-del]', body).forEach((b) => b.addEventListener('click', async () => {
    const u = posts.find((x) => x.id === b.closest('tr').dataset.id);
    if (!confirm(`Delete “${u.title}”? This cannot be undone. To take it off the site but keep it, edit it and untick Publish.`)) return;
    const { error } = await sb.from('updates').delete().eq('id', u.id);
    if (error) return ctx.flash(error.message, 'flag');
    ctx.flash('Post deleted.', 'good');
    refresh();
  }));
}

function startEdit(id) {
  const u = posts.find((x) => x.id === id);
  editing = u;
  $('#up-heading', panel).textContent = 'Edit post';
  $('#up-title', panel).value = u.title;
  $('#up-body', panel).value = u.body || '';
  $('#up-excerpt', panel).value = u.excerpt || '';
  $('#up-alt', panel).value = u.image_alt || '';
  $('#up-branch', panel).value = u.branch_id || '';
  $('#up-date', panel).value = new Date(u.published_at).toLocaleDateString('en-CA');
  $('#up-pub', panel).checked = u.is_published;
  $('#up-img-now', panel).innerHTML = u.image_url
    ? `<img class="thumb-sm" src="${esc(u.image_url)}" alt=""> <span class="small muted">Current image. Choose a file to replace it.</span>
       <button class="linkish small danger" type="button" id="up-img-clear">Remove image</button>` : '';
  $('#up-img-clear', panel)?.addEventListener('click', () => {
    editing.image_url = null;
    $('#up-img-now', panel).innerHTML = '<span class="small muted">Image will be removed when you save.</span>';
  });
  $('#up-cancel', panel).hidden = false;
  syncButton();
  $('#up-title', panel).focus();
}

function resetForm() {
  editing = null;
  $('#up-form', panel).reset();
  $('#up-img-now', panel).innerHTML = '';
  $('#up-heading', panel).textContent = 'New post';
  $('#up-cancel', panel).hidden = true;
  $('#up-branch', panel).value = ctx.branch.id;
  $('#up-date', panel).value = new Date().toLocaleDateString('en-CA');
  $('#up-pub', panel).checked = true;
  syncButton();
}

async function save(e) {
  e.preventDefault();
  const title = $('#up-title', panel).value.trim();
  const bodyText = $('#up-body', panel).value.trim();
  const date = $('#up-date', panel).value;
  if (!title || !bodyText) return ctx.flash('A post needs a title and some text.', 'flag');
  if (!date) return ctx.flash('Pick a date for the post.', 'flag');

  const btn = $('#up-save', panel);
  busy(btn, true, 'Saving…');
  try {
    const file = $('#up-img', panel).files[0];
    const alt = $('#up-alt', panel).value.trim();
    // Checked before uploading, so a missing description never leaves an
    // orphaned file in storage.
    if ((file || editing?.image_url) && !alt) {
      throw new Error('Describe the image in a few words, for people using a screen reader.');
    }
    const image_url = file ? await uploadImage(file, 'updates') : (editing?.image_url ?? null);

    // Keep the time of day when editing an existing post's date, so posts on
    // the same day stay in the order they were written.
    const now = new Date();
    const at = new Date(`${date}T${editing ? new Date(editing.published_at).toTimeString().slice(0, 8) : now.toTimeString().slice(0, 8)}`);

    const row = {
      title,
      image_alt: image_url ? alt : null,
      body: bodyText,
      excerpt: $('#up-excerpt', panel).value.trim() || null,
      image_url,
      branch_id: $('#up-branch', panel).value || null,
      is_published: $('#up-pub', panel).checked,
      published_at: at.toISOString(),
    };

    let error;
    if (editing) {
      ({ error } = await sb.from('updates').update(row).eq('id', editing.id));
    } else {
      // Slugs must be unique; add a short suffix if this title has been used.
      const base = slugify(title) || 'update';
      const { data: clash } = await sb.from('updates').select('slug').like('slug', `${base}%`);
      const slug = clash?.some((c) => c.slug === base) ? `${base}-${Date.now().toString(36).slice(-4)}` : base;
      ({ error } = await sb.from('updates').insert({ ...row, slug, author_id: ctx.me.id }));
    }
    if (error) throw new Error(error.message);

    busy(btn, false);
    ctx.flash(editing ? 'Post updated.' : row.is_published ? `“${title}” is live on the Updates page.` : 'Draft saved.', 'good');
    editing = null;
    await refresh();
  } catch (err) {
    busy(btn, false);
    ctx.flash(err.message, 'flag');
  }
}
