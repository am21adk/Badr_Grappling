/* Badr Grappling — shared header and footer.
 * Injected into <div id="masthead"> and <div id="foot"> on every page so the
 * navigation, the branch switcher and the sign-in state stay in one place.
 */
import { $, esc, CLUB, loadBranches, activeBranch, setBranch, currentUser, currentProfile, isAdmin, signOut } from './core.js';

const PUBLIC_NAV = [
  ['index.html',        'Home'],
  ['branches.html',     'Branches'],
  ['updates.html',      'Updates'],
  ['donate.html',       'Support us'],
];

// Only worth showing to someone who has not got an account yet.
const JOIN_NAV = [
  ['join.html',         'Join'],
];

const MEMBER_NAV = [
  ['portal.html',       'Portal'],
  ['leaderboard.html',  'Leaderboard'],
];

function here() {
  const f = location.pathname.split('/').pop() || 'index.html';
  return f === '' ? 'index.html' : f;
}

export async function mountChrome() {
  const signedIn = !!(await currentUser());
  const host = $('#masthead');
  if (host) await mountHeader(host, signedIn);
  const foot = $('#foot');
  if (foot) mountFooter(foot, signedIn);
}

async function mountHeader(host, signedIn) {
  const page = here();
  const profile = signedIn ? await currentProfile() : null;

  // The portal and leaderboard are for members whose account is still active.
  const isMember = profile?.status === 'active';
  // Someone signed in has an account already; inviting them to join is noise.
  const links = [...PUBLIC_NAV, ...(signedIn ? [] : JOIN_NAV), ...(isMember ? MEMBER_NAV : [])]
    .map(([href, label]) =>
      `<a href="${href}"${href === page ? ' aria-current="page"' : ''}>${esc(label)}</a>`)
    .join('');

  const adminLink = isMember && isAdmin(profile)
    ? `<a href="admin.html"${page === 'admin.html' ? ' aria-current="page"' : ''}>Admin</a>` : '';

  const account = profile
    ? `<button class="btn btn-ghost btn-sm" data-signout type="button">Sign out</button>`
    : `<a class="btn btn-sm" href="login.html">Sign in</a>`;
  // The same action inside the menu, for narrow screens.
  const accountInMenu = profile
    ? `<a class="nav-account" href="#" data-signout>Sign out</a>`
    : `<a class="nav-account" href="login.html"${page === 'login.html' ? ' aria-current="page"' : ''}>Sign in</a>`;

  host.className = 'masthead';
  host.innerHTML = `
    <div class="wrap masthead-in">
      <a class="brand" href="index.html">
        <img src="assets/brand/badr-mark-disc.png" alt="" width="42" height="42">
        <span class="brand-name">Badr Grappling
          <span class="brand-sub">${esc(CLUB.motto)}</span>
        </span>
      </a>
      <button class="burger" type="button" id="burger"
              aria-label="Menu" aria-expanded="false" aria-controls="sitenav"><span></span></button>
      <nav class="nav" id="sitenav" aria-label="Main">${links}${adminLink}${accountInMenu}</nav>
      <div class="nav-tools">
        <div class="branch-pick">
          <label class="sr" for="branch-select">Branch</label>
          <select id="branch-select"></select>
        </div>
        ${account}
      </div>
    </div>`;

  // Branch switcher — options come from the database. With a single live
  // branch there is nothing to switch, so it shows as a plain label.
  const sel = $('#branch-select', host);
  const list = await loadBranches();
  const active = await activeBranch();
  if (list.length < 2) {
    sel.closest('.branch-pick').outerHTML = `<span class="branch-one">${esc(active.name)}</span>`;
  } else {
    sel.innerHTML = list
      .map((b) => `<option value="${esc(b.slug)}"${b.slug === active.slug ? ' selected' : ''}>${esc(b.name)}</option>`)
      .join('');
    sel.addEventListener('change', () => setBranch(sel.value));
    document.addEventListener('branchchange', (e) => { sel.value = e.detail.slug; });
  }

  const burger = $('#burger', host);
  const nav = $('#sitenav', host);
  burger.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', String(open));
  });
  // Close the mobile menu on Escape, and return focus to the button.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      nav.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
      burger.focus();
    }
  });

  host.querySelectorAll('[data-signout]').forEach((el) => el.addEventListener('click', (e) => {
    e.preventDefault();
    signOut();
  }));
}

function mountFooter(foot, signedIn) {
  const year = new Date().getFullYear();
  foot.className = 'foot';
  foot.innerHTML = `
    <div class="wrap band">
      <div class="foot-grid">
        <div>
          <img src="assets/brand/badr-mark-disc.png" alt="Badr Grappling" width="64" height="64">
          <p class="small mt1">Wrestling with purpose.<br>Faith, resilience, brotherhood.</p>
        </div>
        <div>
          <h4>Club</h4>
          <ul>
            <li><a href="branches.html">Branches &amp; timetable</a></li>
            ${signedIn ? '' : '<li><a href="join.html">Join the club</a></li>'}
            <li><a href="updates.html">Updates</a></li>
            <li><a href="donate.html">Support us</a></li>
          </ul>
        </div>
        <div>
          <h4>Members</h4>
          <ul>
            <li><a href="portal.html">Member portal</a></li>
            <li><a href="leaderboard.html">Leaderboard</a></li>
            <li><a href="open-a-branch.html">Open a branch</a></li>
            <li><a href="terms.html">Membership terms</a></li>
          </ul>
        </div>
        <div>
          <h4>Get in touch</h4>
          <ul>
            <li><a href="mailto:${esc(CLUB.email)}">${esc(CLUB.email)}</a></li>
            <li><a href="${esc(CLUB.phoneHref)}">${esc(CLUB.phone)}</a></li>
            <li><a href="${esc(CLUB.whatsapp)}" rel="noopener">WhatsApp</a></li>
            <li><a href="${esc(CLUB.instagram)}" rel="noopener">Instagram</a></li>
          </ul>
        </div>
      </div>
      <div class="foot-base">
        <span>&copy; ${year} Badr Grappling</span>
        <span>A members&rsquo; wrestling club, run by its members.</span>
      </div>
    </div>`;
}

mountChrome();
