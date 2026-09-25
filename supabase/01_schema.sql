-- =====================================================
-- Badr Grappling — schema
-- Run in the Supabase SQL editor, in file order (01 → 06).
-- Safe to re-run.
-- =====================================================

-- gen_random_uuid() is built into Postgres 13+, so no extension is needed.

-- ---------- enums ----------
do $$ begin
  create type member_role   as enum ('member', 'admin', 'super_admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type member_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attend_source as enum ('coach', 'qr');
exception when duplicate_object then null; end $$;

do $$ begin
  create type claim_kind    as enum ('referral', 'social_tag', 'home_workout');
exception when duplicate_object then null; end $$;

do $$ begin
  create type claim_status  as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type donation_status as enum ('pending', 'paid', 'refunded', 'failed');
exception when duplicate_object then null; end $$;


-- =====================================================
-- Branches
-- A new branch is a row here. Nothing in the front-end
-- or in any policy names a specific branch.
-- =====================================================
create table if not exists branches (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  city        text,
  address     text,
  postcode    text,
  maps_url    text,
  intro       text,
  contact_email text,
  is_active   boolean not null default true,
  sort_order  int not null default 100,
  created_at  timestamptz not null default now()
);


-- =====================================================
-- Members
-- One row per person. `user_id` links to Supabase auth.
-- =====================================================
create table if not exists members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text,
  phone       text,
  branch_id   uuid references branches(id) on delete set null,
  role        member_role   not null default 'member',
  status      member_status not null default 'active',
  joined_on   date not null default current_date,
  referred_by uuid references members(id) on delete set null,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists members_branch_idx on members(branch_id);
create index if not exists members_user_idx   on members(user_id);
create index if not exists members_status_idx on members(status);

-- There used to be a third status, 'pending': a sign-up waited for a coach
-- to approve it. That step is gone — people sign up and are in. This moves
-- a database built before the change over, and does nothing on a new one.
do $$ begin
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
              where t.typname = 'member_status' and e.enumlabel = 'pending') then
    update members set status = 'active' where status = 'pending';
    alter type member_status rename to member_status_old;
    create type member_status as enum ('active', 'inactive');
    alter table members
      alter column status drop default,
      alter column status type member_status using status::text::member_status,
      alter column status set default 'active';
    drop type member_status_old;
  end if;
end $$;


-- =====================================================
-- Recurring class times (drives the public timetable)
-- =====================================================
create table if not exists class_times (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branches(id) on delete cascade,
  label      text not null,
  age_group  text,
  weekday    int  not null check (weekday between 0 and 6),   -- 0 = Sunday
  starts_at  time not null,
  ends_at    time not null,
  note       text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists class_times_branch_idx on class_times(branch_id, weekday);


-- =====================================================
-- Sessions — a specific class on a specific date.
-- This is what a coach opens to take the register.
-- =====================================================
create table if not exists sessions (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id) on delete cascade,
  class_time_id uuid references class_times(id) on delete set null,
  held_on       date not null,
  label         text not null default 'Training',
  notes         text,
  created_by    uuid references members(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (branch_id, held_on, label)
);
create index if not exists sessions_branch_date_idx on sessions(branch_id, held_on desc);


-- =====================================================
-- Attendance — one row per member per session.
-- Both the coach's register and a QR scan land here.
-- =====================================================
create table if not exists attendance (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  source      attend_source not null default 'coach',
  recorded_by uuid references members(id) on delete set null,
  recorded_at timestamptz not null default now(),
  unique (session_id, member_id)          -- repeat scans are ignored
);
create index if not exists attendance_member_idx  on attendance(member_id);
create index if not exists attendance_session_idx on attendance(session_id);


-- =====================================================
-- Weekly QR tokens — one per branch per week.
-- =====================================================
create table if not exists qr_tokens (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branches(id) on delete cascade,
  token      text not null unique,
  week_start date not null,                 -- Monday of the week it covers
  expires_at timestamptz not null,          -- end of that week
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (branch_id, week_start)
);
create index if not exists qr_tokens_token_idx on qr_tokens(token);


-- =====================================================
-- Gamification
-- =====================================================

-- Rank ladder. Thresholds are data, editable by an admin.
create table if not exists ranks (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  label      text not null,
  min_points int  not null,
  sort_order int  not null default 100
);

-- Point values. Editable by an admin; nothing hard-codes a number.
create table if not exists point_rules (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  label     text not null,
  points    int  not null,
  is_auto   boolean not null default false,   -- awarded by the system
  is_active boolean not null default true,
  sort_order int not null default 100
);

-- Every award, ever. Append-only in practice: corrections are
-- entered as an opposing row so the history stays readable.
create table if not exists points_ledger (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members(id) on delete cascade,
  points      int  not null,
  rule_code   text references point_rules(code) on update cascade,
  reason      text,
  awarded_by  uuid references members(id) on delete set null,
  source_type text,                        -- 'attendance' | 'claim' | 'training_win' | 'manual'
  source_id   uuid,
  created_at  timestamptz not null default now()
);
create index if not exists points_member_idx on points_ledger(member_id, created_at desc);
create index if not exists points_source_idx on points_ledger(source_type, source_id);

-- One automatic award per source event.
create unique index if not exists points_unique_auto
  on points_ledger(source_type, source_id, rule_code)
  where source_id is not null;


-- Which finished weeks have had their full-week bonuses settled, per branch.
-- Internal bookkeeping for check_week_bonus / settle_week.
create table if not exists week_settlements (
  branch_id  uuid not null references branches(id) on delete cascade,
  week_start date not null,
  settled_at timestamptz not null default now(),
  primary key (branch_id, week_start)
);


-- Training rounds won, logged by a coach.
create table if not exists training_results (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete cascade,
  session_id  uuid references sessions(id) on delete set null,
  winner_id   uuid not null references members(id) on delete cascade,
  opponent_id uuid references members(id) on delete set null,
  held_on     date not null default current_date,
  notes       text,
  logged_by   uuid references members(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (opponent_id is null or opponent_id <> winner_id)
);
create index if not exists training_winner_idx on training_results(winner_id);
create index if not exists training_branch_idx on training_results(branch_id, held_on desc);


-- Referrals, social tags and logged home workouts.
-- These sit here until a coach approves them. Points are
-- granted on approval, never on submission.
create table if not exists member_claims (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references members(id) on delete cascade,
  kind          claim_kind not null,
  detail        text,
  url           text,
  referred_name text,
  status        claim_status not null default 'pending',
  reviewed_by   uuid references members(id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now()
);
create index if not exists claims_status_idx on member_claims(status, created_at desc);
create index if not exists claims_member_idx on member_claims(member_id);


-- =====================================================
-- Video library — unlisted YouTube for now.
--
-- `source_type` + `source_ref` is the single abstraction the
-- portal reads. Swapping to Supabase storage with signed URLs
-- later means adding a source_type and teaching one render
-- function about it — no other page changes.
-- =====================================================
create table if not exists videos (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  branch_id    uuid references branches(id) on delete set null,   -- null = all branches
  category     text not null default 'Technique',
  source_type  text not null default 'youtube',
  source_ref   text not null,             -- YouTube id, or a storage path later
  recorded_on  date,
  is_archived  boolean not null default false,
  created_by   uuid references members(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists videos_branch_idx on videos(branch_id, is_archived);


-- =====================================================
-- Fundraising appeals and donations
-- The club is a membership club, not a registered charity.
-- =====================================================
create table if not exists appeals (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  description  text,
  image_url    text,
  image_alt    text,                    -- read aloud by screen readers
  target_pence int,
  deadline     date,
  branch_id    uuid references branches(id) on delete set null,
  is_active    boolean not null default true,
  sort_order   int not null default 100,
  created_at   timestamptz not null default now()
);

create table if not exists donations (
  id                  uuid primary key default gen_random_uuid(),
  appeal_id           uuid references appeals(id) on delete set null,
  amount_pence        int not null check (amount_pence > 0),
  currency            text not null default 'gbp',
  is_recurring        boolean not null default false,
  donor_name          text,
  donor_email         text,
  message             text,
  is_anonymous        boolean not null default false,
  status              donation_status not null default 'pending',
  stripe_session_id   text unique,          -- first payment, from Checkout
  stripe_invoice_id   text unique,          -- each monthly renewal after that
  stripe_payment_intent text,
  stripe_subscription   text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);
create index if not exists donations_appeal_idx on donations(appeal_id, status);


-- =====================================================
-- Updates (club news)
-- =====================================================
create table if not exists updates (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  excerpt      text,
  body         text,
  image_url    text,
  image_alt    text,                    -- read aloud by screen readers
  branch_id    uuid references branches(id) on delete set null,   -- null = club-wide
  author_id    uuid references members(id) on delete set null,
  is_published boolean not null default false,
  published_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists updates_pub_idx on updates(is_published, published_at desc);


-- =====================================================
-- "Open a branch" enquiries
-- =====================================================
create table if not exists branch_enquiries (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  email               text not null,
  phone               text,
  city                text not null,
  grappling_background text,
  coaching_experience text,
  facility_access     text,
  why                 text,
  status              text not null default 'new',   -- new | reviewing | closed
  admin_note          text,
  created_at          timestamptz not null default now()
);
create index if not exists enquiries_status_idx on branch_enquiries(status, created_at desc);


-- Columns added after the first release. `create table if not exists`
-- skips tables that already exist, so later columns are added here too.
alter table appeals add column if not exists image_alt text;
alter table updates add column if not exists image_alt text;


-- =====================================================
-- Limits on what people type
--
-- Members write their own name and phone, and their claims. Nothing stopped
-- a megabyte of text going in. Links people type are held to web addresses,
-- so a `javascript:` link can never be stored, whatever writes it: the pages
-- check too, but a branch admin can reach the database without them.
-- NOT VALID: the rules apply to every new or changed row, without failing
-- on an older row that happens to break one.
-- =====================================================
do $$ begin
  alter table members add constraint members_text_sizes check (
    char_length(full_name) between 1 and 120
    and (phone is null or char_length(phone) <= 40)
    and (email is null or char_length(email) <= 254)) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table member_claims add constraint member_claims_text_sizes check (
    (detail is null or char_length(detail) <= 2000)
    and (referred_name is null or char_length(referred_name) <= 120)
    and (url is null or (char_length(url) <= 500 and url ~* '^https?://'))) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table branches add constraint branches_maps_url_web check (
    maps_url is null or (char_length(maps_url) <= 500 and maps_url ~* '^https://')) not valid;
exception when duplicate_object then null; end $$;


-- =====================================================
-- Levelling: EXP and levels, alongside ranks and never instead of them
--
-- Ranks come from points, which only coaches and the system give out.
-- Levels come from EXP. Every point a member is given counts as the same
-- amount of EXP, and members earn more by logging their own training.
--
-- A member's EXP is not kept as one running number that could drift. It is
-- the sum of the points ledger and what each training entry earned, so
-- taking points back takes their EXP back too. The level is worked out from
-- that total whenever it is read (level_for_exp), which is why retuning the
-- curve never touches anyone's stored data.
-- =====================================================
do $$ begin
  create type training_kind as enum ('running', 'calisthenics', 'wrestling', 'strength', 'general');
exception when duplicate_object then null; end $$;

-- Every number that shapes levelling, in one row. The values are set in
-- supabase/levelling_config.sql, the one file to edit.
create table if not exists levelling_settings (
  id               boolean primary key default true check (id),   -- only ever one row
  exp_per_minute   numeric not null check (exp_per_minute >= 0),
  exp_per_mile     numeric not null check (exp_per_mile >= 0),
  reps_per_exp     numeric not null check (reps_per_exp > 0),
  cap_running      int not null check (cap_running >= 0),
  cap_calisthenics int not null check (cap_calisthenics >= 0),
  cap_wrestling    int not null check (cap_wrestling >= 0),
  cap_strength     int not null check (cap_strength >= 0),
  cap_general      int not null check (cap_general >= 0),
  max_logs_per_day int not null check (max_logs_per_day > 0),
  backdate_days    int not null check (backdate_days >= 0),
  curve_base       numeric not null check (curve_base > 0),
  curve_power      numeric not null check (curve_power > 0)
);

-- Training members log themselves. `exp` is what the entry earned after the
-- daily cap, worked out by log_training() in the database, never by the page.
create table if not exists training_logs (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references members(id) on delete cascade,
  trained_on     date not null,
  kind           training_kind not null,
  minutes        int,
  miles          numeric(5,2),
  exercise       text,
  reps           int,
  notes          text,
  exp            int not null default 0,
  exp_before_cap int not null default 0,     -- what it would have earned with no cap
  created_at     timestamptz not null default now(),
  constraint training_logs_sizes check (
    (minutes is null or minutes between 1 and 600)
    and (miles is null or (miles > 0 and miles <= 100))
    and (reps is null or reps between 1 and 10000)
    and (exercise is null or char_length(exercise) between 1 and 80)
    and (notes is null or char_length(notes) <= 500)
    and exp >= 0 and exp_before_cap >= 0)
);
create index if not exists training_logs_member_idx on training_logs(member_id, trained_on desc);
