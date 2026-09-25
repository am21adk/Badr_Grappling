/* Badr Grappling — the level-up and rank-up notice.
 *
 * A native <dialog> in the manner of a game's system window, in the club's
 * own ink and brass: the frame opens from its middle, a line of light runs
 * down it once, and the old level ticks over to the new one. Anyone whose
 * device asks for less motion gets the same notice, still.
 *
 * Every level gets a notice of its own. A jump from 4 to 7 shows "Level 5";
 * closing it brings "Level 6", then "Level 7", back to back. Rank-ups arrive
 * the same way, one rank at a time (portal.js hands them over already split,
 * since only it knows the ladder).
 *
 *   await celebrate([
 *     { type: 'rank',  from: { code: 'E', label: 'Rank E' }, to: { code: 'D', label: 'Rank D' } },
 *     { type: 'level', from: 4, to: 7 },
 *   ]);
 */
import { rankPlate } from './core.js';

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let seq = 0;

export async function celebrate(notices = []) {
  for (const n of oneLevelAtATime(notices)) await show(n);
}

// 4 -> 7 becomes 4 -> 5, 5 -> 6, 6 -> 7: one notice for each level reached.
function oneLevelAtATime(notices) {
  return notices.flatMap((n) => {
    if (n.type !== 'level' || !(n.to - n.from > 1)) return [n];
    return Array.from({ length: n.to - n.from }, (_, i) => ({ type: 'level', from: n.from + i, to: n.from + i + 1 }));
  });
}

function show(n) {
  return new Promise((resolve) => {
    const id = `sysnote-${++seq}`;
    const isLevel = n.type === 'level';
    const dlg = document.createElement('dialog');
    dlg.className = 'sysnote';
    dlg.setAttribute('aria-labelledby', `${id}-t`);
    dlg.setAttribute('aria-describedby', `${id}-d`);

    // Numbers and rank codes only; the sentence below goes in as text.
    dlg.innerHTML = `
      <form method="dialog" class="sysnote-frame">
        <h2 class="sysnote-title" id="${id}-t">${isLevel ? 'Level up' : 'Rank up'}</h2>
        ${isLevel
          ? `<p class="sysnote-level"><span class="sysnote-lv">Level</span> <span class="sysnote-num">${Number(n.from) || 0}</span></p>`
          : `<p class="sysnote-ranks">${rankPlate(n.from.code, true)}<span class="sysnote-arrow" aria-hidden="true">&rarr;</span>${rankPlate(n.to.code, true)}</p>`}
        <p class="sysnote-line" id="${id}-d"></p>
        <button class="btn" value="ok">Continue</button>
      </form>`;

    dlg.querySelector('.sysnote-line').textContent = isLevel
      ? `You have reached Level ${n.to}.`
      : `You are now ${n.to.label}.`;

    // Same ways out as the site's other dialogs: the button, Escape, or a
    // click on the dimmed page.
    let downOnBackdrop = false;
    dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg; });
    dlg.addEventListener('click', (e) => { if (e.target === dlg && downOnBackdrop) dlg.close(); });
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); dlg.close(); } });

    let timer = null;
    const opener = document.activeElement;
    dlg.addEventListener('close', () => {
      clearTimeout(timer);
      dlg.remove();
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
      resolve();
    }, { once: true });

    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('button').focus();

    if (!isLevel) return;
    const num = dlg.querySelector('.sysnote-num');
    if (still() || n.to <= n.from) { num.textContent = n.to; return; }
    // The old level first, then it ticks over to the new one once the frame
    // has opened.
    timer = setTimeout(() => {
      num.textContent = n.to;
      num.classList.add('tick');
    }, 450);
  });
}
