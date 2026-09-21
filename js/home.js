/* Badr Grappling — home page. */
import { $, $$, esc, sb, CLUB, onBranch, clockTime, dayName, dateShort } from './core.js';

/* =====================================================
   Carousel

   Built on native overflow scrolling with scroll-snap, so
   a swipe on a phone is the browser's own scroll — there
   is nothing to fight with. The arrows sit on the sides of
   the photo; the caption sits in a bar under it, so no face
   is covered by text.

   It loops. A copy of the last photo sits before the first
   and a copy of the first after the last, so "next" on the
   last photo slides on to the first, and a swipe past either
   end keeps going. Once the track comes to rest on a copy it
   swaps to the real photo, which looks identical. That swap
   waits until scrolling has stopped and no finger is on the
   screen, so it never fights a reader's scroll.

   It also moves on by itself every few seconds — but only
   while nobody is using it. It holds still while the pointer
   is over it, while keyboard focus is in it, while a finger is
   on it, while a swipe or arrow press is still settling, and
   while it is off-screen or the tab is hidden. It never starts
   at all for anyone whose device asks for reduced motion.

   There is deliberately no pause button and no slide counter:
   the club asked for the bar to carry the caption alone. WCAG
   2.2.2 wants a way to stop moving content, so the holds above
   and the reduced-motion check are doing that work instead.
   ===================================================== */
const AUTOPLAY_MS = 6000;

function initCarousel() {
  const root = $('#carousel');
  const stage = $('#carousel-stage');
  const track = $('#carousel-track');
  if (!root || !stage || !track) return;

  const slides = $$('.carousel-slide', track);
  const total = slides.length;
  if (!total) return;
  const loops = total > 1;

  const bar = document.createElement('div');
  bar.className = 'carousel-bar';
  // The caption repeats what the slide already says in its figcaption,
  // so screen readers skip the copy.
  bar.innerHTML = `<p class="carousel-caption" aria-hidden="true"></p>`;
  root.append(bar);
  const caption = $('.carousel-caption', bar);

  // Autoplay state. Every one of these is a reason to hold still.
  const playing = loops && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let hovering = false, focused = false, onScreen = true, touching = false, timer = null;
  function schedule() {
    clearTimeout(timer);
    if (!playing || hovering || focused || touching || !onScreen || document.hidden) return;
    // Only ever moves from rest: never mid-swipe or mid-slide.
    timer = setTimeout(() => { if (target === null && !touching) go(aim() + 1); }, AUTOPLAY_MS);
  }

  const arrow = (dir, label, d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'carousel-btn';
    b.dataset.dir = dir;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-controls', 'carousel-track');
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none"
      stroke="currentColor" stroke-width="1.75"><path d="${d}"/></svg>`;
    b.addEventListener('click', () => go(aim() + (dir === 'next' ? 1 : -1)));
    return b;
  };

  if (loops) {
    // The end copies are for looking at only: hidden from screen readers
    // and out of the tab order.
    const copyOf = (slide) => {
      const c = slide.cloneNode(true);
      c.removeAttribute('role');
      c.removeAttribute('aria-roledescription');
      c.removeAttribute('aria-label');
      c.setAttribute('aria-hidden', 'true');
      c.inert = true;
      $('img', c)?.removeAttribute('fetchpriority');
      return c;
    };
    track.prepend(copyOf(slides[total - 1]));
    track.append(copyOf(slides[0]));
    stage.append(arrow('prev', 'Previous photo', 'M10 2 4 8l6 6'));
    stage.append(arrow('next', 'Next photo', 'M6 2l6 6-6 6'));
  }

  const first = loops ? 1 : 0;              // track position of the first real photo
  const last = first + total - 1;           // ... and of the last
  const width = () => track.clientWidth;
  const index = () => Math.round(track.scrollLeft / width());
  const photoAt = (i) => (((i - first) % total) + total) % total;
  let current = 0;                          // the real photo on show, 0-based

  // Where the track is heading. A second press while it is still sliding
  // counts from the destination, not from wherever it happens to be.
  let target = null;
  const aim = () => target ?? index();

  function go(i) {
    // Pressed again while already heading onto an end copy: shift the whole
    // track by one loop — invisible, as the copies match — and carry on.
    if (loops && (i > last + 1 || i < 0)) {
      const shift = i < 0 ? total : -total;
      jump(track.scrollLeft / width() + shift);
      i += shift;
    }
    const k = Math.max(0, Math.min(last + first, i));
    target = k;
    track.scrollTo({ left: k * width(), behavior: 'smooth' });
  }

  // Move without sliding. Used to land on the first photo at load, to swap
  // a copy for its real photo, and to stay put when the window is resized.
  function jump(i) {
    const was = track.style.scrollBehavior;
    track.style.scrollBehavior = 'auto';
    track.scrollLeft = i * width();
    track.style.scrollBehavior = was;
  }

  function paint() {
    current = photoAt(index());
    caption.textContent = $('figcaption', slides[current])?.textContent || '';
  }

  function settle() {
    target = null;                          // a swipe never has a target
    if (touching) return;                   // a finger is still on the photo
    if (loops) {
      const i = index();
      if (i < first) jump(last);            // resting on the copy of the last photo
      else if (i > last) jump(first);       // resting on the copy of the first
    }
    paint();
    schedule();                             // the next move counts from now
  }

  let tick;
  const settleSoon = () => { clearTimeout(tick); tick = setTimeout(settle, 120); };
  track.addEventListener('scroll', () => { clearTimeout(timer); settleSoon(); }, { passive: true });
  track.addEventListener('touchstart', () => { touching = true; clearTimeout(timer); }, { passive: true });
  ['touchend', 'touchcancel'].forEach((type) =>
    track.addEventListener(type, () => { touching = false; settleSoon(); }, { passive: true }));

  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(aim() + 1); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); go(aim() - 1); }
  });

  // Hold still while a mouse is over the carousel. Touch "hovers" never
  // end, so only a real mouse counts.
  root.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hovering = true; schedule(); } });
  root.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hovering = false; schedule(); } });
  // Hold still while keyboard focus is inside (a mouse click on an arrow
  // doesn't count — the hover already covers that).
  root.addEventListener('focusin', (e) => { focused = e.target.matches(':focus-visible'); schedule(); });
  root.addEventListener('focusout', (e) => {
    if (!root.contains(e.relatedTarget)) { focused = false; schedule(); }
  });
  document.addEventListener('visibilitychange', schedule);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      schedule();
    }, { threshold: [0, 0.5, 1] }).observe(root);
  }

  frameFaces();
  jump(first);
  let raf;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { frameFaces(); jump(first + current); paint(); });
  });
  paint();
}

/**
 * Crop each photo from the top rather than the bottom, without cutting a
 * face. Each <img> says where its faces are (data-faces="top bottom", as
 * fractions of the photo's height). When the frame is shorter than the
 * photo, as much as possible comes off the top — down to a small gap above
 * the highest face — and only what is left comes off the bottom.
 */
function frameFaces() {
  $$('.carousel-slide img[data-faces]').forEach((img) => {
    const [top, bottom] = img.dataset.faces.split(/\s+/).map(Number);
    const ratio = +img.getAttribute('width') / +img.getAttribute('height');
    const W = img.clientWidth, H = img.clientHeight;
    if (!W || !H || !(top >= 0) || !(bottom > top)) return;

    const shown = W / ratio;              // the photo's height as drawn
    const spare = shown - H;              // how much has to be cropped
    if (spare <= 0) { img.style.objectPosition = ''; return; }

    const gap = 0.06 * H;                 // breathing room above and below the faces
    let crop = Math.min(spare, Math.max(0, top * shown - gap));
    // A frame too short for every face (the 3:1 floor in the CSS stops that
    // happening) keeps the lowest faces in view rather than the highest.
    crop = Math.max(crop, Math.min(spare, bottom * shown - (H - gap)));
    img.style.objectPosition = `50% ${-Math.round(crop)}px`;
  });
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
