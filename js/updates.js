/* Badr Grappling — updates list and single post. */
import { $, $$, esc, sb, qp, onBranch, dateLong, paragraphs } from './core.js';

const slug = qp('post');
let scope = 'all';
let branch = null;

async function paintList() {
  const host = $('#u-list');
  host.innerHTML = `<p class="load">Loading updates…</p>`;

  let q = sb.from('updates')
    .select('slug, title, excerpt, body, image_url, published_at, branches(name)')
    .eq('is_published', true)
    .order('published_at', { ascending: false })
    .limit(50);

  if (scope === 'branch' && branch?.id) {
    q = q.or(`branch_id.eq.${branch.id},branch_id.is.null`);
  }

  const { data, error } = await q;
  if (error) {
    host.innerHTML = `<p class="empty">Updates are unavailable right now.</p>`;
    return;
  }
  if (!data.length) {
    host.innerHTML = `<p class="empty">Nothing posted yet.</p>`;
    return;
  }

  host.innerHTML = data.map((u) => {
    const summary = u.excerpt || String(u.body || '').split(/\n\s*\n/)[0].slice(0, 240);
    return `
      <a class="post-row${u.image_url ? ' has-img' : ''}" href="updates.html?post=${encodeURIComponent(u.slug)}">
        ${u.image_url ? `<div class="tile-img"><img src="${esc(u.image_url)}" alt="" loading="lazy"></div>` : ''}
        <div>
          <p class="meta">${esc(dateLong(u.published_at))}
            &nbsp;<span class="pill">${esc(u.branches?.name || 'Club-wide')}</span></p>
          <h2 class="tile-title mt1" style="font-size:1.5rem">${esc(u.title)}</h2>
          <p class="muted">${esc(summary)}</p>
        </div>
      </a>`;
  }).join('');
}

async function paintPost() {
  $('#u-list-view').hidden = true;
  const view = $('#u-post-view');
  view.hidden = false;
  view.innerHTML = `<p class="load">Loading…</p>`;

  const { data: u, error } = await sb.from('updates')
    .select('title, body, image_url, image_alt, published_at, branches(name)')
    .eq('slug', slug).eq('is_published', true)
    .maybeSingle();

  if (error || !u) {
    view.innerHTML = `<p class="empty">That update could not be found.
      <a class="link" href="updates.html">See all updates</a>.</p>`;
    return;
  }

  document.title = `${u.title} — Badr Grappling`;
  $('#u-title').textContent = u.title;
  view.innerHTML = `
    <p class="meta mb2">${esc(dateLong(u.published_at))}
      &nbsp;<span class="pill">${esc(u.branches?.name || 'Club-wide')}</span></p>
    ${u.image_url ? `<div class="post-hero"><img src="${esc(u.image_url)}" alt="${esc(u.image_alt || '')}"></div>` : ''}
    <div class="post-body">${paragraphs(u.body)}</div>
    <p class="mt3"><a class="link" href="updates.html">All updates</a></p>`;
}

if (slug) {
  paintPost();
} else {
  $$('.chip[data-scope]').forEach((chip) => chip.addEventListener('click', () => {
    scope = chip.dataset.scope;
    $$('.chip[data-scope]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    paintList();
  }));

  onBranch((b) => {
    branch = b;
    $('#u-branch-chip').textContent = `${b.name} + club-wide`;
    paintList();
  });
}
