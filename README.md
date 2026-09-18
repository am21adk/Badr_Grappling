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
- **The carousel never moves on its own.** The brief allowed autoplay. It's left
  out so nothing can fight a reader's swipe, and so the page has no motion.
- **Contribution copy says "support" and "contribute".** The appeal editor
  refuses titles or descriptions that mention charity, charitable giving, Gift
  Aid or tax relief.

## Before launch, check with the club

- **Class times.** Their site says Adults 7.30–9pm, the Instagram bio says
  7.30–8.45pm, and the page description says 7.30–8.30pm. The seed uses the
  Join page (7.30–9pm). Kids are 6.30–7.30pm.
- **Age limits.** The Instagram bio says 16+, but the site sells a kids'
  membership. The seed labels the classes "Under 16" and "16+".
- **Photo credit.** The main team photo is credited to Alex Benyon in its file
  data. Ask whether they want a credit on the site.
- **Excluded image.** The Khabib quote graphic from their Instagram is left out
  of the gallery. It uses a real person's likeness.
- **Copy.** Home and join page copy is new, written in their voice. "Beginners
  are welcome" is inferred from their posts, not stated anywhere. The
  participation terms are theirs, word for word.
