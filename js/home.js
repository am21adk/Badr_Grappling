/* Badr Grappling — home page. */
import { $, $$, esc, sb, CLUB, onBranch, clockTime, dayName, dateShort } from './core.js';

/* =====================================================
   Carousel

   Built on native overflow scrolling with scroll-snap, so
   a swipe on a phone is the browser's own scroll — there
   is nothing to fight with. The arrows and dots simply
   call scrollTo. Nothing moves on its own: there is no
   autoplay, so a reader's scroll can never be overridden.
   ===================================================== */
function initCarousel() {
  const root = $('#carousel');
  const track = $('#carousel-track');
  if (!root || !track) return;

  const slides = $$('.carousel-slide', track);
  if (slides.length < 2) return;

  const arrow = (dir, label, d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'carousel-btn';
    b.dataset.dir = dir;
    b.setAttribute('aria-label', label);
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none"
      stroke="currentColor" stroke-width="1.75"><path d="${d}"/></svg>`;
    b.addEventListener('click', () => go(aim() + (dir === 'next' ? 1 : -1)));
    return b;
  };

  const dots = document.createElement('div');
  dots.className = 'carousel-dots';
  const list = document.createElement('ol');
  dots.append(list);
  slides.forEach((_, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `Go to photo ${i + 1} of ${slides.length}`);
    b.addEventListener('click', () => go(i));
    li.append(b);
    list.append(li);
  });

  root.append(arrow('prev', 'Previous photo', 'M10 2 4 8l6 6'));
  root.append(arrow('next', 'Next photo', 'M6 2l6 6-6 6'));
  root.append(dots);

  const index = () => Math.round(track.scrollLeft / track.clientWidth);

  // Where the track is heading. A second press while it is still sliding
  // counts from the destination, not from wherever it happens to be.
  let target = null;
  const aim = () => target ?? index();

  function go(i) {
    const n = Math.max(0, Math.min(slides.length - 1, i));
    target = n;
    track.scrollTo({ left: n * track.clientWidth, behavior: 'smooth' });
  }

  function paint() {
    const i = index();
    $$('button', list).forEach((b, n) => b.setAttribute('aria-current', String(n === i)));
    $$('.carousel-btn', root).forEach((b) => {
      const atEnd = b.dataset.dir === 'next' ? i >= slides.length - 1 : i <= 0;
      b.disabled = atEnd;
      b.style.opacity = atEnd ? '.35' : '';
    });
  }

  // Settled: repaint the dots, and hand control back to the reader's own
  // swipes (a swipe never has a target).
  let tick;
  track.addEventListener('scroll', () => {
    clearTimeout(tick);
    tick = setTimeout(() => { target = null; paint(); }, 120);
  }, { passive: true });

  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(aim() + 1); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); go(aim() - 1); }
  });

  window.addEventListener('resize', paint);
  paint();
}

/* =====================================================
   Branch cards
   ===================================================== */
async function loadBranchCards() {
  const host = $('#branch-cards');
  if (!host) return;

  const { data, error } = await sb
    .from('branches')
    .select('slug, name, city, address, postcode, intro, maps_url')
    .eq('is_active', true)
    .order('sort_order');

  if (error) {
    host.innerHTML = `<p class="empty">Branch details are unavailable right now.</p>`;
    return;
  }
  if (!data.length) {
    host.innerHTML = `<p class="empty">No branches listed yet.</p>`;
    return;
  }

  host.innerHTML = data.map((b) => `
    <article class="panel">
      <h3 class="h3">${esc(b.name)}</h3>
      <p class="meta mt1">${esc(b.city || '')}</p>
      <p class="small mt1">${esc(b.intro || '')}</p>
      ${b.address ? `<p class="small muted">${esc(b.address)}${b.postcode ? `, ${esc(b.postcode)}` : ''}</p>` : ''}
      <p class="mt1">
        <a class="link" href="branches.html?branch=${encodeURIComponent(b.slug)}">Times &amp; details</a>
      </p>
    </article>`).join('');
}

/* =====================================================
   Timetable for the active branch
   ===================================================== */
function paintTimetable(branch) {
  const body = $('#timetable-body');
  const label = $('#tt-branch-name');
  const heroBranch = $('#hero-branch');
  const note = $('#tt-note');
  if (label) label.textContent = branch.name;
  if (heroBranch) heroBranch.textContent = branch.name;
  if (!body) return;

  if (!branch.id) {
    body.innerHTML = `<tr><td colspan="3" class="muted">Class times are unavailable right now.</td></tr>`;
    return;
  }

  body.innerHTML = `<tr><td colspan="3" class="load">Loading times…</td></tr>`;

  sb.from('class_times')
    .select('label, age_group, weekday, starts_at, ends_at, note')
    .eq('branch_id', branch.id)
    .eq('is_active', true)
    .order('weekday').order('starts_at')
    .then(({ data, error }) => {
      if (error) {
        body.innerHTML = `<tr><td colspan="3" class="muted">Class times are unavailable right now.</td></tr>`;
        paintCtaDays([]);
        return;
      }
      if (!data.length) {
        paintCtaDays([]);
        body.innerHTML = `<tr><td colspan="3" class="muted">
          No classes listed for ${esc(branch.name)} yet.
          <a class="link" href="mailto:${esc(CLUB.email)}">Ask us what is running</a>.</td></tr>`;
        if (note) note.textContent = '';
        return;
      }
      paintCtaDays(data);
      body.innerHTML = data.map((c) => `
        <tr>
          <td>${esc(c.label)}${c.age_group ? ` <span class="pill">${esc(c.age_group)}</span>` : ''}</td>
          <td>${esc(dayName(c.weekday))}</td>
          <td class="time">${esc(clockTime(c.starts_at))}–${esc(clockTime(c.ends_at))}</td>
        </tr>`).join('');
      const notes = data.map((c) => c.note).filter(Boolean);
      if (note) note.textContent = notes.length ? notes.join(' ') : '';
    });
}

/** "Turn up on Friday." — from the branch's own timetable, never hard-coded. */
function paintCtaDays(classes) {
  const h = $('#cta-heading');
  if (!h) return;
  const days = [...new Set(classes.map((c) => c.weekday))];
  if (!days.length) { h.textContent = 'Come and train.'; return; }
  const names = days.map(dayName);
  const list = names.length === 1 ? names[0]
    : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  h.textContent = `Turn up on ${list}.`;
}

/* =====================================================
   Latest updates strip
   ===================================================== */
function paintUpdates(branch) {
  const host = $('#home-updates');
  if (!host) return;

  let q = sb.from('updates')
    .select('id, slug, title, published_at, branch_id, branches(name)')
    .eq('is_published', true)
    .order('published_at', { ascending: false })
    .limit(3);

  // Branch-tagged posts for this branch, plus club-wide posts.
  if (branch.id) q = q.or(`branch_id.eq.${branch.id},branch_id.is.null`);

  q.then(({ data, error }) => {
    if (error || !data?.length) {
      host.innerHTML = `<p class="small muted">No updates posted yet.</p>`;
      return;
    }
    host.innerHTML = `<ul style="list-style:none;padding:0;margin:0">${data.map((u) => `
      <li style="padding:.7rem 0;border-bottom:1px solid rgba(242,237,227,.14)">
        <a href="updates.html?post=${encodeURIComponent(u.slug)}" style="text-decoration:none">
          <span class="meta">${esc(dateShort(u.published_at))}${u.branches?.name ? ` &middot; ${esc(u.branches.name)}` : ''}</span>
          <span style="display:block;font-family:var(--serif);font-size:1.0625rem;font-weight:600;line-height:1.25;margin-top:.15rem">${esc(u.title)}</span>
        </a>
      </li>`).join('')}</ul>
      <p class="mt1"><a class="link" href="updates.html">All updates</a></p>`;
  });
}

/* ---------- boot ---------- */
initCarousel();
loadBranchCards();
onBranch((branch) => { paintTimetable(branch); paintUpdates(branch); });

const wa = $('#cta-whatsapp');
if (wa) wa.href = CLUB.whatsapp;
