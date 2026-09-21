/* Badr Grappling — a confirm box in the site's own design.
 *
 * Stands in for window.confirm(), which the browser draws itself: it can't
 * be styled, and it opens with "am21adk.github.io says". This one is a
 * native <dialog> opened with showModal(), so the browser still does the
 * hard parts — centring it, dimming the page behind it, keeping focus
 * inside it, and closing it on Escape.
 *
 *   if (!(await ask({ title: 'Delete this?', body: '…', confirm: 'Delete', danger: true }))) return;
 *
 * Resolves true only for the confirm button. Cancel, Escape and a click on
 * the dimmed page all resolve false. For anything destructive (danger),
 * focus starts on Cancel, so a stray Enter never deletes anything.
 */

let seq = 0;

export function ask({ title, body = '', confirm = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const id = `ask-${++seq}`;
    const dlg = document.createElement('dialog');
    dlg.className = danger ? 'ask ask-danger' : 'ask';
    dlg.setAttribute('aria-labelledby', `${id}-title`);

    const form = document.createElement('form');
    form.method = 'dialog';

    const h = document.createElement('h2');
    h.className = 'ask-title';
    h.id = `${id}-title`;
    h.textContent = title;            // names come from the database: text, never HTML
    form.append(h);

    const paras = String(body).split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
    if (paras.length) {
      const b = document.createElement('div');
      b.className = 'ask-body';
      b.id = `${id}-body`;
      for (const t of paras) {
        const p = document.createElement('p');
        p.textContent = t;
        b.append(p);
      }
      form.append(b);
      dlg.setAttribute('aria-describedby', b.id);
    }

    const row = document.createElement('div');
    row.className = 'ask-actions';
    const no = document.createElement('button');
    no.className = 'btn btn-ghost';
    no.value = 'cancel';
    no.textContent = cancel;
    const yes = document.createElement('button');
    yes.className = danger ? 'btn btn-flag' : 'btn';
    yes.value = 'ok';
    yes.textContent = confirm;
    row.append(no, yes);
    form.append(row);
    dlg.append(form);

    // The dimmed page is the dialog element itself, outside the form. Only a
    // press that starts and ends there counts, so dragging a text selection
    // out of the box does not close it.
    let downOnBackdrop = false;
    dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg; });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg && downOnBackdrop) dlg.close('cancel');
    });
    // The browser closes a modal on Escape by itself, but only when the key
    // arrives with its keycode. Some remote-desktop and assistive tools send
    // the key name alone, so handle it here as well.
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); dlg.close('cancel'); }
    });

    const opener = document.activeElement;
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
      // Back to whatever was pressed to open it, if it is still on the page.
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    }, { once: true });

    document.body.append(dlg);
    dlg.showModal();
    (danger ? no : yes).focus();
  });
}
