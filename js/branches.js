/* Badr Grappling — branches page. */
import { $, esc, sb, qp, CLUB, onBranch, setBranch, loadBranches, clockTime, dayName } from './core.js';
import { galleryFor } from './gallery-data.js';

// ?branch=slug deep links (used by the home page cards) set the site-wide branch.
const wanted = qp('branch');
if (wanted) await setBranch(wanted);

function paintDetail(branch) {
  const host = $('#branch-detail');
  if (!host) return;

  const addr = [branch.address, branch.postcode].filter(Boolean).join(', ');
  // Settings only saves https:// links, but a branch admin can write to the
  // database directly. A saved link is used only if it is a web address, so a
  // `javascript:` one can never become a link a visitor clicks.
  const saved = /^https:\/\//i.test(branch.maps_url || '') ? branch.maps_url : null;
  const maps = saved
    || (addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null);

  host.innerHTML = `
    <div class="grid g2" style="align-items:start">
      <div>
        <h2 class="h1">${esc(branch.name)}</h2>
        ${branch.intro ? `<p class="lede mt1">${esc(branch.intro)}</p>` : ''}
        ${addr ? `<p class="mt2"><span class="meta">Address</span><br>${esc(addr)}</p>` : ''}
        ${maps ? `<p><a class="link" href="${esc(maps)}" rel="noopener">Open in maps</a></p>` : ''}
        <p class="mt2">
          <span class="meta">Contact</span><br>
          <a class="link" href="mailto:${esc(branch.contact_email || CLUB.email)}">${esc(branch.contact_email || CLUB.email)}</a><br>
          <a class="link" href="${esc(CLUB.phoneHref)}">${esc(CLUB.phone)}</a>
        </p>
        <div class="btn-row mt2">
          <a class="btn" href="join.html">Join this branch</a>
          <a class="btn btn-ghost" href="${esc(CLUB.whatsapp)}" rel="noopener">Message us</a>
        </div>
      </div>
      <div>
        <h3 class="h3 mb1">Class times</h3>
        <div class="table-scroll">
          <table class="timetable">
            <thead><tr><th scope="col">Class</th><th scope="col">Day</th><th scope="col">Time</th></tr></thead>
            <tbody id="bt-body"><tr><td colspan="3" class="load">Loading…</td></tr></tbody>
          </table>
        </div>
        <p class="hint" id="bt-note"></p>
      </div>
    </div>`;

  const body = $('#bt-body');
  const note = $('#bt-note');
  if (!branch.id) {
    body.innerHTML = `<tr><td colspan="3" class="muted">Class times are unavailable right now.</td></tr>`;
    return;
  }

  sb.from('class_times')
    .select('label, age_group, weekday, starts_at, ends_at, note')
    .eq('branch_id', branch.id).eq('is_active', true)
    .order('weekday').order('starts_at')
    .then(({ data, error }) => {
      if (error || !data?.length) {
        body.innerHTML = `<tr><td colspan="3" class="muted">No classes listed for ${esc(branch.name)} yet.</td></tr>`;
        note.textContent = '';
        return;
      }
      body.innerHTML = data.map((c) => `
        <tr>
          <td>${esc(c.label)}${c.age_group ? ` <span class="pill">${esc(c.age_group)}</span>` : ''}</td>
          <td>${esc(dayName(c.weekday))}</td>
          <td class="time">${esc(clockTime(c.starts_at))}–${esc(clockTime(c.ends_at))}</td>
        </tr>`).join('');
      note.textContent = data.map((c) => c.note).filter(Boolean).join(' ');
    });
}

function paintGallery(branch) {
  const host = $('#gallery');
  if (!host) return;
  const shots = galleryFor(branch.slug);
  if (!shots.length) {
    host.innerHTML = `<p class="empty">No photos from ${esc(branch.name)} yet.</p>`;
    return;
  }
  host.innerHTML = shots.map((p) => `
    <figure style="margin:0">
      <div class="tile-img" style="aspect-ratio:${p.w} / ${p.h}">
        <img src="${esc(p.src)}" width="${p.w}" height="${p.h}" loading="lazy" alt="${esc(p.alt)}">
      </div>
      <figcaption class="meta mt1">${esc(p.caption)}</figcaption>
    </figure>`).join('');
}

async function paintAll(active) {
  const host = $('#all-branches');
  if (!host) return;
  const list = await loadBranches();
  host.innerHTML = list.map((b) => `
    <article class="panel${b.slug === active.slug ? ' panel-bone' : ''}">
      <h3 class="h3">${esc(b.name)}</h3>
      <p class="small muted mt1">${esc([b.address, b.postcode].filter(Boolean).join(', ') || 'Details coming soon')}</p>
      ${b.slug === active.slug
        ? `<p class="mt1"><span class="pill pill-brass">Showing now</span></p>`
        : `<p class="mt1"><button class="btn btn-sm btn-ghost" type="button" data-slug="${esc(b.slug)}">Show this branch</button></p>`}
    </article>`).join('');

  host.querySelectorAll('button[data-slug]').forEach((b) =>
    b.addEventListener('click', () => setBranch(b.dataset.slug)));
}

onBranch((branch) => {
  paintDetail(branch);
  paintGallery(branch);
  paintAll(branch);
  document.title = `${branch.name} — Badr Grappling`;
});
