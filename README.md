# Badr Grappling

Website and member portal for Badr Grappling, a wrestling club in London.
Plain HTML, CSS and JavaScript on the front end. Supabase for sign-in, the
database and image storage. Stripe Checkout for contributions. Hosted on
Cloudflare Pages.

## What is where

```
*.html               the pages (public, member, admin)
css/                 styles.css (everything) and admin.css (admin extras)
js/                  one script per page, plus:
  core.js              Supabase client, branch selection, sign-in helpers
  chrome.js            the shared header and footer
  config.js            Supabase URL and public key, club contact details
  video-source.js      the only code that knows videos are on YouTube
  gallery-data.js      which photos belong to which branch
  admin/               one file per admin tab
  vendor/qrcode.js     QR code generator (MIT, Kazuhiko Arase)
assets/gallery/      the club's photos, downloaded once from their Instagram and site
assets/brand/        the stamp logo, plus a version on a bone disc for dark backgrounds
functions/api/       Cloudflare Pages Functions: checkout, stripe-webhook, enquiry
supabase/            the database, in six files to run in order
build.sh, _headers   Cloudflare build step and security headers
```

## Setting it up

### 1. Supabase

1. Create a project (London region).
2. In the SQL editor, run the files in `supabase/` **in order**: `01_schema.sql`
   through `05_storage.sql`. Every file is safe to run again.
3. Optional but recommended: enable the `pg_cron` extension (Database →
   Extensions), then run `06_cron.sql`. It issues each week's check-in codes and
   settles the full-week bonuses at midnight on Sunday. Without it both still
   happen, just later: a coach opening the QR tab creates the week's code, and
   the first register activity of a new week settles the one before.
4. Authentication → URL configuration: set the site URL to the live domain and
   add `https://<domain>/**` to the redirect URLs. The confirmation and
   password-reset links land on `login.html` with query parameters, and the
   wildcard lets those through.
5. Put the project URL and **anon** key into `js/config.js`. The anon key is
   meant to be public. Row-level security is what protects the data.
6. Sign up through the site's Join page, then make yourself super-admin:

   ```sql
   update members
      set role = 'super_admin', status = 'active',
          branch_id = (select id from branches where slug = 'london')
    where email = 'you@example.com';
   ```

### 2. Stripe

1. Add a webhook endpoint `https://<domain>/api/stripe-webhook` with these events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `invoice.paid`, `charge.refunded`.
2. Keep the secret key and the webhook signing secret for step 4.

### 3. Email (Resend)

"Open a branch" enquiries are saved to the admin panel and also emailed to the
club. Create a Resend API key and verify the sending domain. If this isn't set
up, enquiries are still saved; only the email is skipped.

### 4. Cloudflare Pages

Connect the GitHub repo, then:

| Setting | Value |
|---|---|
| Build command | `sh build.sh` |
| Build output directory | `dist` |

Environment variables (Settings → Environment variables). None of these go in
the repo:

| Variable | What |
|---|---|
| `SUPABASE_URL` | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key. Server only, never in `config.js` |
| `STRIPE_SECRET_KEY` | `sk_live_…` (or `sk_test_…` while testing) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` |
| `RESEND_API_KEY` | for enquiry emails |
| `EMAIL_FROM` | e.g. `Badr Grappling <noreply@badrgrappling.co.uk>` |
| `CLUB_EMAIL` | where enquiries go; defaults to `badrgrappling@outlook.com` |

The build step copies only the public files into `dist/`, so `supabase/`, this
README and the build script are never served.

## Running it locally

**With sample data, no accounts needed:**

```bash
node preview/server.mjs
```

Then open http://localhost:8788. Sign in as `member@badr.test` or
`admin@badr.test` with any password, or sign up; new accounts wait for approval
like the real site. The members, updates and contributions are made up, and
everything resets when the server stops. `preview/` is never deployed.

**Showing someone else.** Forward port 8788 and send them the address. In VS
Code: open the Ports panel, choose *Forward a Port*, enter `8788`, then
right-click it and set *Port Visibility* to *Public*. It works while your
computer and the preview are running.

**Against a real Supabase project:**

```bash
npx wrangler pages dev . --compatibility-date=2026-09-01
```

Copy `.dev.vars.example` to `.dev.vars` for the functions. It is git-ignored.

## Everyday jobs

**Add a branch.** Admin → Settings → *Add a branch*. It starts hidden. Pick it
under *Managing*, fill in the address and timetable, then tick *Live on the
public site*. The header switcher, timetable, leaderboard and portal all pick it
up from the database. No code changes are needed. To show its photos in the
gallery, add them to `assets/gallery/` and list them under its slug in
`js/gallery-data.js`.

**Add a photo to the home carousel.** Use real photos, not stills from
Instagram reels, which look like paused video. Add a `<figure>` slide to
`index.html` like the others, and give the image a `data-faces` attribute:
where the faces start and end, measured down the photo as fractions of its
height. The carousel then crops from the top of the photo, down to just above
the faces, and only crops the bottom when the frame is too short for that.

| Photo | `data-faces` | `--focus` (fallback without JavaScript) |
|---|---|---|
| `team-line-up.jpg` | `0.40 0.79` | 69% |
| `team-mats.jpg` | `0.28 0.55` | 34% |
| `talk-before-training.jpg` | `0.35 0.70` | 55% |

`--focus` is only used if JavaScript fails: `2 × (middle of the faces) − 50%`.
The carousel never gets thinner than 3:1, so every face fits as long as the
faces take up less than about 45% of the photo's height. Phones show the
whole photo, with the arrows in its bottom corners. The caption sits in a bar
under the photo, so no text covers a face.

**Put Manchester live.** It is already a row, hidden. Do the same as above, or:
`update branches set is_active = true where slug = 'manchester';`

**Change point values or rank thresholds.** Admin → Settings (super-admin).

**Move videos off YouTube.** Everything goes through `js/video-source.js`. Add a
`storage` source type there (private bucket, signed URLs). The notes at the top
of that file list the three steps. No page or table outside it needs to change.

## Decisions worth knowing about

- **Manchester is seeded but hidden.** There was no address, timetable or
  photography for it anywhere, and a half-empty branch reads as broken.
- **The full-week bonus lands the Monday after.** Sessions are opened on the day,
  so mid-week nobody knows about Friday's class yet. A week counts as complete
  when a member attended every session in their age group that week, with more
  than one session held. A branch that trains once a week doesn't hand out a
  bonus for that one class.
- **There is no approval step.** The brief had a coach approving each sign-up;
  the club would rather people got training. So the status `pending` is gone
  from `member_status` altogether, not just defaulted away — a member is
  `active` or `inactive`, nothing else. Pasting `01_schema.sql` over a database
  that still has the old three-value type moves it across and makes anyone who
  was waiting active. Worth knowing: with approvals gone and email confirmation
  off, anyone who finds the site can open an account and see the members' video
  library and the leaderboard. Turning confirmation on needs real SMTP; the
  built-in sender stops at roughly two emails an hour.
- **Deleting an account really deletes it.** *Delete* on the Members tab
  removes the person's sign-in along with
  their attendance, points, claims and results, through `delete_member()`.
  Nobody can delete their own account, only a super-admin can remove another
  super-admin, and a branch admin is held to their own branch. If the database
  is locked down enough that the sign-in itself cannot be removed, the screen
  says so rather than pretending.
- **No self-reporting, coaches included.** Coaches check themselves in by QR
  like everyone else. Another coach has to log their wins, award them points or
  approve their claims. The database enforces all of this, not just the screens.
- **The leaderboard shows "First L." for everyone except you.** The club runs a
  kids' class, and every member can see the leaderboard.
- **Rank thresholds, point values and branch enquiries are super-admin only.**
  They are club-wide, and a branch admin sees only their own branch.
- **QR check-ins match the class running at the time.** On a Friday with a
  kids' and an adults' class, a scan at 7.40pm goes on the adults' register.
- **Videos load when tapped.** The library shows thumbnails, and the YouTube
  player (from `youtube-nocookie.com`) loads when a member presses play. Thirty
  embedded players on one page is too much for a phone on mobile data.
- **The carousel moves on by itself every 6 seconds, and loops.** It never
  overrides someone's own scroll. It holds still while a mouse is over it,
  while keyboard focus is in it, while a finger is on it, while a swipe is
  settling, and while it's off-screen or the tab is hidden, and it never
  starts for anyone whose device is set to reduce motion. There is no pause
  button or slide counter, at the club's request. WCAG 2.2.2 asks for a way to
  stop anything that moves by itself, so those holds are standing in for it.
  The delay is `AUTOPLAY_MS` in `js/home.js`.
- **Fundraising copy says "donate".** The club is not a registered charity,
  so the appeal editor refuses titles or descriptions that mention charity,
  charitable giving, Gift Aid or tax relief. Donating is fine.

## Before launch, check with the club

- **Class times.** Their site says Adults 7.30–9pm, the Instagram bio says
  7.30–8.45pm, and the page description says 7.30–8.30pm. The seed uses the
  Join page (7.30–9pm). Kids are 6.30–7.30pm.
- **Age limits.** The Instagram bio says 16+, but the site sells a kids'
  membership. The seed labels the classes "Under 16" and "16+".
- **Photo credit.** The main team photo is credited to Alex Benyon in its file
  data. Ask whether they want a credit on the site.
- **Excluded images.** The Khabib quote graphic from their Instagram is left
  out, because it uses a real person's likeness. The three stills from their
  Instagram reels are left out too, because they look like paused video. If
  the club has more real photos, the carousel and gallery would benefit from a
  few more.
- **Copy.** Home and join page copy is new, written in their voice. "Beginners
  are welcome" is inferred from their posts, not stated anywhere. The
  participation terms are theirs, word for word.
