/* Badr Grappling — the level-up and rank-up notice.
 *
 * A native <dialog> in the manner of a game's system window, in the club's
 * own ink and brass: the frame opens from its middle, a line of light runs
 * down it once, and the level counts up to its new number, one step for each
 * level gained. Anyone whose device asks for less motion gets the same notice,
 * still.
 *
 *   await celebrate([
 *     { type: 'rank',  from: { code: 'E', label: 'Rank E' }, to: { code: 'D', label: 'Rank D' } },
 *     { type: 'level', from: 4, to: 7 },
 *   ]);
 *
 * Each notice waits for the one before it to be closed.
 */
import { rankPlate } from './core.js';

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let seq = 0;

export async function celebrate(notices = []) {
  for (const n of notices) await show(n);
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
        <p class="sysnote-eyebrow">Notice</p>
        <h2 class="sysnote-title" id="${id}-t">${isLevel ? 'Level up' : 'Rank up'}</h2>
        ${isLevel
          ? `<p class="sysnote-level"><span class="sysnote-lv">Level</span> <span class="sysnote-num">${Number(n.from) || 0}</span></p>`
          : `<p class="sysnote-ranks">${rankPlate(n.from.code, true)}<span class="sysnote-arrow" aria-hidden="true">&rarr;</span>${rankPlate(n.to.code, true)}</p>`}
        <p class="sysnote-line" id="${id}-d"></p>
        <button class="btn" value="ok">Continue</button>
      </form>`;

    const gained = isLevel ? n.to - n.from : 0;
    dlg.querySelector('.sysnote-line').textContent = isLevel
      ? `You have reached Level ${n.to}.${gained > 1 ? ` That is ${gained} levels at once.` : ''}`
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
      clearInterval(timer);
      dlg.remove();
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
      resolve();
    }, { once: true });

    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('button').focus();

    if (!isLevel) return;
    const num = dlg.querySelector('.sysnote-num');
    if (still() || gained < 1) { num.textContent = n.to; return; }
    // Count up one level at a time. A big jump still finishes in about a
    // second and a half.
    let at = n.from;
    const step = Math.max(60, Math.min(320, Math.round(1500 / gained)));
    setTimeout(() => {
      timer = setInterval(() => {
        at += 1;
        num.textContent = at;
        num.classList.remove('tick');
        void num.offsetWidth;                    // restart the tick for each number
        num.classList.add('tick');
        if (at >= n.to) clearInterval(timer);
      }, step);
    }, 450);                                     // after the frame has opened
  });
}
