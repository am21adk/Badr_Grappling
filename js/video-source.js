/* Badr Grappling — the video source abstraction.
 *
 * Every video row carries `source_type` and `source_ref`. This module is the
 * only code that knows what those mean. The portal calls renderVideo(); the
 * admin form calls parseVideoInput(). Nothing else looks inside.
 *
 * Today the only source is unlisted YouTube. That is a deliberate, accepted
 * trade-off: anyone with the link can watch, and members can share links
 * outside the portal. To move to Supabase storage with signed URLs later:
 *   1. add a 'storage' branch to parseVideoInput (source_ref = object path)
 *   2. add a 'storage' branch to renderVideo that calls
 *      sb.storage.from('videos').createSignedUrl(ref, 3600) and returns a
 *      <video controls> element
 *   3. make the bucket private, with a policy allowing is_active_member()
 * No page, table or query outside this file needs to change.
 */
import { esc } from './core.js';

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Turn whatever an admin pasted into a { source_type, source_ref } pair.
 * Accepts watch URLs, youtu.be links, /embed/, /shorts/, /live/, or a bare id.
 * Returns null if it cannot find a video in it.
 */
export function parseVideoInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (YT_ID.test(raw)) return { source_type: 'youtube', source_ref: raw };

  let url;
  try { url = new URL(raw.startsWith('http') ? raw : `https://${raw}`); } catch { return null; }
  const host = url.hostname.replace(/^www\.|^m\./, '');

  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  return id && YT_ID.test(id) ? { source_type: 'youtube', source_ref: id } : null;
}

/** A thumbnail for list views, where there is one. */
export function videoThumb(v) {
  if (v.source_type === 'youtube') return `https://i.ytimg.com/vi/${encodeURIComponent(v.source_ref)}/hqdefault.jpg`;
  return null;
}

/** Link back to the source, for the admin panel. */
export function videoLink(v) {
  if (v.source_type === 'youtube') return `https://youtu.be/${encodeURIComponent(v.source_ref)}`;
  return null;
}

/**
 * Markup for a playable video. Returns a string so it can be dropped into a
 * card. Uses youtube-nocookie.com so no tracking cookies are set until the
 * member actually presses play.
 */
export function renderVideo(v) {
  switch (v.source_type) {
    case 'youtube':
      return `<div class="video-frame">
        <iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.source_ref)}?rel=0&modestbranding=1"
                title="${esc(v.title)}" loading="lazy"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
      </div>`;
    default:
      return `<div class="video-frame"><p class="small" style="color:var(--bone);padding:1rem">
        This video cannot be played here.</p></div>`;
  }
}
