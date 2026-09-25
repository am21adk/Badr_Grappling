-- =====================================================
-- Badr Grappling — functions, triggers and views
-- =====================================================

-- =====================================================
-- Identity helpers
--
-- These are SECURITY DEFINER on purpose. Row-level policies on
-- `members` need to ask "who is this, and what branch are they
-- an admin of?" — and if that question were answered by a plain
-- sub-select against `members`, the policy would re-enter itself
-- and Postgres would raise infinite recursion. Reading the row
-- through a definer function steps outside RLS and breaks the loop.
-- =====================================================

create or replace function current_member_id()
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from members where user_id = auth.uid() limit 1;
$$;

create or replace function current_member_role()
returns member_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from members where user_id = auth.uid() limit 1;
$$;

create or replace function current_member_branch()
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select branch_id from members where user_id = auth.uid() limit 1;
$$;

create or replace function is_active_member()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from members where user_id = auth.uid() and status = 'active');
$$;

create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from members
    where user_id = auth.uid() and status = 'active'
      and role in ('admin', 'super_admin')
  );
$$;

create or replace function is_super_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from members
    where user_id = auth.uid() and status = 'active' and role = 'super_admin'
  );
$$;

-- A branch admin manages exactly one branch. A super-admin manages all.
create or replace function can_manage_branch(p_branch uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from members m
    where m.user_id = auth.uid() and m.status = 'active'
      and (m.role = 'super_admin'
           or (m.role = 'admin' and m.branch_id is not distinct from p_branch))
  );
$$;


-- =====================================================
-- New auth user -> member row
--
-- Sign-ups are active straight away: the club would rather people got in
-- and started training than waited on a coach. There is no approval step
-- and no pending state. The two gates that remain are 'inactive' (a coach
-- closing someone's access, keeping their history) and delete_member().
-- =====================================================
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_branch uuid;
begin
  select id into v_branch from branches
   where slug = nullif(new.raw_user_meta_data ->> 'branch_slug', '')
   limit 1;

  insert into members (user_id, full_name, email, phone, branch_id, status)
  values (
    new.id,
    -- Cut to the sizes the members table allows, so an over-long name typed
    -- at sign-up shortens instead of failing the whole sign-up.
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)), 120),
    new.email,
    left(nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''), 40),
    v_branch,
    'active'
  )
  on conflict (user_id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- =====================================================
-- Points
-- =====================================================

-- Award a rule's points once for a given source event.
-- Returns the points written (0 if the rule is off or already awarded).
create or replace function award_rule_points(
  p_member uuid,
  p_rule   text,
  p_source_type text,
  p_source_id   uuid,
  p_reason text default null,
  p_by     uuid default null
) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_points int;
begin
  select points into v_points
    from point_rules where code = p_rule and is_active limit 1;

  if v_points is null or v_points = 0 then
    return 0;
  end if;

  insert into points_ledger (member_id, points, rule_code, reason, awarded_by, source_type, source_id)
  values (p_member, v_points, p_rule, p_reason, p_by, p_source_type, p_source_id)
  on conflict do nothing;                       -- one auto-award per event

  return v_points;
end $$;


-- The full-week bonus.
--
-- A week can only be called complete once it is over: sessions are opened
-- on the day, so on a Tuesday nobody yet knows about Friday's class. The
-- bonus is therefore settled after the week ends — by the Monday job
-- (weekly_maintenance), or by the first register activity of the new week
-- if that job is not scheduled — and re-checked whenever a past week's
-- register is corrected.
--
-- "Complete" means: the member attended every session their branch held
-- that week in the age groups they train in (an adult is not expected at
-- the kids' class), and there was more than one such session. A branch
-- running one class a week does not hand out a bonus for that one class.
--
-- The function makes the ledger match the facts in both directions, so
-- calling it again is always safe.
create or replace function check_week_bonus(p_member uuid, p_on date)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_branch   uuid;
  v_week     date := date_trunc('week', p_on)::date;          -- Monday
  v_src      uuid := md5(p_member::text || date_trunc('week', p_on)::date::text)::uuid;
  v_eligible int;
  v_went     int;
begin
  if club_today() < v_week + 7 then
    return;                                                   -- week not over yet
  end if;

  select branch_id into v_branch from members where id = p_member;

  if v_branch is not null then
    with my_groups as (
      select distinct coalesce(ct.age_group, '') as grp
        from attendance a
        join sessions s on s.id = a.session_id
        left join class_times ct on ct.id = s.class_time_id
       where a.member_id = p_member and s.branch_id = v_branch
         and s.held_on >= v_week and s.held_on < v_week + 7
    )
    select count(distinct s.id), count(distinct a.id)
      into v_eligible, v_went
      from sessions s
      left join class_times ct on ct.id = s.class_time_id
      left join attendance a on a.session_id = s.id and a.member_id = p_member
     where s.branch_id = v_branch
       and s.held_on >= v_week and s.held_on < v_week + 7
       and coalesce(ct.age_group, '') in (select grp from my_groups);
  end if;

  if coalesce(v_eligible, 0) > 1 and v_went >= v_eligible then
    perform award_rule_points(
      p_member, 'week_complete', 'week', v_src,
      'Full week of sessions, week beginning ' || to_char(v_week, 'DD Mon YYYY')
    );
  else
    delete from points_ledger where source_type = 'week' and source_id = v_src;
  end if;
end $$;


-- Settle one finished week for everyone who trained at a branch.
create or replace function settle_week(p_branch uuid, p_week date)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_week date := date_trunc('week', p_week)::date;
  r      record;
  n      int := 0;
begin
  if club_today() < v_week + 7 then
    return 0;
  end if;
  for r in
    select distinct a.member_id
      from attendance a join sessions s on s.id = a.session_id
     where s.branch_id = p_branch and s.held_on >= v_week and s.held_on < v_week + 7
  loop
    perform check_week_bonus(r.member_id, v_week);
    n := n + 1;
  end loop;
  insert into week_settlements (branch_id, week_start) values (p_branch, v_week)
  on conflict (branch_id, week_start) do update set settled_at = now();
  return n;
end $$;


-- Attendance -> points, automatically.
create or replace function on_attendance_insert()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_on     date;
  v_branch uuid;
  v_prev   date := date_trunc('week', club_today())::date - 7;
begin
  select held_on, branch_id into v_on, v_branch from sessions where id = new.session_id;

  perform award_rule_points(
    new.member_id, 'attend_session', 'attendance', new.id,
    'Attended ' || to_char(v_on, 'DD Mon YYYY')
  );

  -- A correction to a finished week settles that member's week now.
  perform check_week_bonus(new.member_id, v_on);

  -- The first register activity of a new week settles last week, so the
  -- bonus still arrives if the Monday job has not been scheduled.
  if not exists (select 1 from week_settlements where branch_id = v_branch and week_start = v_prev) then
    perform settle_week(v_branch, v_prev);
  end if;
  return new;
end $$;

drop trigger if exists attendance_points on attendance;
create trigger attendance_points
  after insert on attendance
  for each row execute function on_attendance_insert();


-- Removing an attendance row takes its points back with it, and re-checks
-- a finished week — so a corrected register always leaves a correct total.
create or replace function on_attendance_delete()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_on date;
begin
  delete from points_ledger
   where source_type = 'attendance' and source_id = old.id;

  select held_on into v_on from sessions where id = old.session_id;
  if v_on is not null then
    perform check_week_bonus(old.member_id, v_on);
  end if;
  return old;
end $$;

drop trigger if exists attendance_points_undo on attendance;
create trigger attendance_points_undo
  after delete on attendance
  for each row execute function on_attendance_delete();


-- Deleting a whole session: clear its register first, while the session
-- still exists (a plain cascade would remove it before its children, and
-- the trigger above could no longer see which week it was) ...
create or replace function on_session_delete()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from attendance where session_id = old.id;
  return old;
end $$;

drop trigger if exists session_clear_register on sessions;
create trigger session_clear_register
  before delete on sessions
  for each row execute function on_session_delete();

-- ... then, once it is gone, re-settle that week: with one session fewer,
-- members who made every remaining session may now have a complete week.
create or replace function on_session_deleted()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform settle_week(old.branch_id, old.held_on);
  return old;
end $$;

drop trigger if exists session_resettle_week on sessions;
create trigger session_resettle_week
  after delete on sessions
  for each row execute function on_session_deleted();


-- No self-reporting, for coaches either. A coach checks themselves in
-- with the QR code like everyone else, and another coach logs their wins.
-- (Service-role and SQL-editor sessions have no auth.uid() and pass.)
create or replace function guard_self_record()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  -- Nested on purpose: PL/pgSQL plans a whole condition at once, so a
  -- field that only exists on the other table must sit in its own block.
  if tg_table_name = 'attendance' then
    if new.source = 'coach' and new.member_id = current_member_id() then
      raise exception 'Check yourself in with the QR code, or ask another coach to add you';
    end if;
  elsif tg_table_name = 'training_results' then
    if new.winner_id = current_member_id() then
      raise exception 'Another coach needs to log your own wins';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists attendance_no_self on attendance;
create trigger attendance_no_self
  before insert or update on attendance
  for each row execute function guard_self_record();

drop trigger if exists training_no_self on training_results;
create trigger training_no_self
  before insert or update on training_results
  for each row execute function guard_self_record();


-- Training win -> points.
create or replace function on_training_result_insert()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform award_rule_points(
    new.winner_id, 'training_win', 'training_win', new.id,
    'Training round won ' || to_char(new.held_on, 'DD Mon YYYY'),
    new.logged_by
  );
  return new;
end $$;

drop trigger if exists training_points on training_results;
create trigger training_points
  after insert on training_results
  for each row execute function on_training_result_insert();

create or replace function on_training_result_delete()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from points_ledger where source_type = 'training_win' and source_id = old.id;
  return old;
end $$;

drop trigger if exists training_points_undo on training_results;
create trigger training_points_undo
  after delete on training_results
  for each row execute function on_training_result_delete();


-- The club's calendar day. Supabase runs in UTC; a Friday evening in
-- London should count as Friday in London, and a week should turn over
-- at midnight on Sunday UK time.
create or replace function club_today()
returns date
language sql stable as $$
  select (now() at time zone 'Europe/London')::date;
$$;

-- Monday 00:00 London time, as an absolute timestamp.
create or replace function club_week_end(p_week_start date)
returns timestamptz
language sql immutable as $$
  select ((p_week_start + 7)::timestamp at time zone 'Europe/London');
$$;


-- =====================================================
-- QR check-in
--
-- The whole check-in is one round trip so the member cannot
-- be half-registered, and so the token is never trusted by
-- the browser: it is resolved here.
-- =====================================================
create or replace function checkin_with_token(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tok    qr_tokens%rowtype;
  v_member members%rowtype;
  v_branch branches%rowtype;
  v_session sessions%rowtype;
  v_class  class_times%rowtype;
  v_label  text;
  v_now    time := (now() at time zone 'Europe/London')::time;
  v_rows   int := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('status', 'signed_out');
  end if;

  select * into v_member from members where user_id = auth.uid();
  if not found then
    return jsonb_build_object('status', 'no_member');
  end if;
  if v_member.status <> 'active' then
    return jsonb_build_object('status', 'not_active');
  end if;

  select * into v_tok from qr_tokens where token = p_token;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if now() > v_tok.expires_at then
    return jsonb_build_object('status', 'expired');
  end if;

  select * into v_branch from branches where id = v_tok.branch_id;

  -- Which class is this? On a day with more than one (London Fridays run
  -- kids then adults), use the one running now — or starting within 45
  -- minutes — and otherwise the one nearest to now.
  select ct.* into v_class
    from class_times ct
   where ct.branch_id = v_tok.branch_id
     and ct.is_active
     and ct.weekday = extract(dow from club_today())::int
   order by
     case when v_now between ct.starts_at - interval '45 minutes' and ct.ends_at then 0 else 1 end,
     abs(extract(epoch from (v_now - ct.starts_at)))
   limit 1;

  v_label := coalesce(v_class.label, 'Training');

  -- That class's session today, opened if this is the first scan.
  select * into v_session
    from sessions
   where branch_id = v_tok.branch_id and held_on = club_today() and label = v_label;

  if not found then
    insert into sessions (branch_id, class_time_id, held_on, label)
    values (v_tok.branch_id, v_class.id, club_today(), v_label)
    on conflict (branch_id, held_on, label) do nothing
    returning * into v_session;

    if v_session.id is null then          -- opened by someone else a moment ago
      select * into v_session from sessions
       where branch_id = v_tok.branch_id and held_on = club_today() and label = v_label;
    end if;
  end if;

  -- One check-in per member per session. A repeat scan is a no-op.
  insert into attendance (session_id, member_id, source)
  values (v_session.id, v_member.id, 'qr')
  on conflict (session_id, member_id) do nothing;

  get diagnostics v_rows = row_count;

  return jsonb_build_object(
    'status',  case when v_rows > 0 then 'ok' else 'already' end,
    'branch',  v_branch.name,
    'date',    club_today(),
    'session', v_session.label
  );
end $$;


-- This week's token for a branch, created if it does not exist yet.
-- Admin only. Opening the QR tab calls this, so there is always a code.
create or replace function ensure_qr_token(p_branch uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_week date := date_trunc('week', club_today())::date;    -- Monday
  v_row  qr_tokens%rowtype;
begin
  if not can_manage_branch(p_branch) then
    raise exception 'Not permitted to manage this branch';
  end if;

  insert into qr_tokens (branch_id, token, week_start, expires_at, created_by)
  values (p_branch, replace(gen_random_uuid()::text, '-', ''), v_week, club_week_end(v_week), current_member_id())
  on conflict (branch_id, week_start) do nothing;

  select * into v_row from qr_tokens where branch_id = p_branch and week_start = v_week;
  return jsonb_build_object('token', v_row.token, 'week_start', v_row.week_start, 'expires_at', v_row.expires_at);
end $$;


-- Replace this week's token now — for when a code has been shared
-- outside the room. The old one stops working immediately. Admin only.
create or replace function rotate_qr_token(p_branch uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_week date := date_trunc('week', club_today())::date;
  v_row  qr_tokens%rowtype;
begin
  if not can_manage_branch(p_branch) then
    raise exception 'Not permitted to manage this branch';
  end if;

  insert into qr_tokens (branch_id, token, week_start, expires_at, created_by)
  values (p_branch, replace(gen_random_uuid()::text, '-', ''), v_week, club_week_end(v_week), current_member_id())
  on conflict (branch_id, week_start)
    do update set token = excluded.token,
                  expires_at = excluded.expires_at,
                  created_by = excluded.created_by,
                  created_at = now()
  returning * into v_row;

  return jsonb_build_object('token', v_row.token, 'week_start', v_row.week_start, 'expires_at', v_row.expires_at);
end $$;


-- Weekly job: a fresh check-in code for every live branch, and last
-- week's full-week bonuses settled. Scheduled in 06_cron.sql.
-- Not callable from the browser.
create or replace function rotate_all_qr_tokens()
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_week date := date_trunc('week', club_today())::date;
  v_n    int;
begin
  insert into qr_tokens (branch_id, token, week_start, expires_at)
  select b.id, replace(gen_random_uuid()::text, '-', ''), v_week, club_week_end(v_week)
    from branches b
   where b.is_active
  on conflict (branch_id, week_start) do nothing;
  get diagnostics v_n = row_count;

  -- Old tokens are expired anyway; keep a few weeks for the record.
  delete from qr_tokens where week_start < v_week - 56;
  return v_n;
end $$;

create or replace function weekly_maintenance()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev    date := date_trunc('week', club_today())::date - 7;
  v_codes   int;
  v_members int := 0;
  b record;
begin
  v_codes := rotate_all_qr_tokens();
  for b in select id from branches loop
    v_members := v_members + settle_week(b.id, v_prev);
  end loop;
  return jsonb_build_object('codes_issued', v_codes, 'members_settled', v_members, 'week', v_prev);
end $$;


-- =====================================================
-- Claims: referrals, social tags, logged home workouts.
-- Points are granted on approval, never on submission.
-- =====================================================
create or replace function review_claim(p_claim uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_claim member_claims%rowtype;
  v_branch uuid;
  v_rule  text;
  v_pts   int := 0;
begin
  select * into v_claim from member_claims where id = p_claim;
  if not found then raise exception 'Claim not found'; end if;

  select branch_id into v_branch from members where id = v_claim.member_id;
  if not can_manage_branch(v_branch) then
    raise exception 'Not permitted to review this claim';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'Claim has already been reviewed';
  end if;
  if v_claim.member_id = current_member_id() then
    raise exception 'Another coach needs to review your own claim';
  end if;

  update member_claims
     set status      = case when p_approve then 'approved' else 'rejected' end::claim_status,
         reviewed_by = current_member_id(),
         reviewed_at = now(),
         review_note = p_note
   where id = p_claim;

  if p_approve then
    v_rule := case v_claim.kind
                when 'referral'     then 'referral'
                when 'social_tag'   then 'social_tag'
                when 'home_workout' then 'home_workout'
              end;
    v_pts := award_rule_points(
      v_claim.member_id, v_rule, 'claim', v_claim.id,
      coalesce(p_note, initcap(replace(v_claim.kind::text, '_', ' ')) || ' approved'),
      current_member_id()
    );
  end if;

  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'points', v_pts);
end $$;


-- Admin-entered award or correction, with a reason. Positive or negative.
-- `p_rule` records which point value it was for, when it was one.
drop function if exists adjust_points(uuid, int, text);
create or replace function adjust_points(p_member uuid, p_points int, p_reason text, p_rule text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from members where id = p_member;
  if not can_manage_branch(v_branch) then
    raise exception 'Not permitted to adjust points for this member';
  end if;
  if p_member = current_member_id() then
    raise exception 'Admins cannot award points to themselves';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required';
  end if;
  if p_points = 0 or abs(p_points) > 1000 then
    raise exception 'Points must be between -1000 and 1000, and not zero';
  end if;

  insert into points_ledger (member_id, points, rule_code, reason, awarded_by, source_type)
  values (p_member, p_points,
          (select code from point_rules where code = p_rule),
          trim(p_reason), current_member_id(), 'manual');

  return jsonb_build_object('ok', true);
end $$;


-- Remove a member and their sign-in.
--
-- The login lives in auth.users; the member row and everything hanging off
-- it — attendance, points, claims, wins — follows through the foreign keys.
-- This is for sign-ups that a coach turns away, and for people who ask to be
-- removed. Deactivating is the gentler option and keeps someone's history.
--
-- Deleting the auth user needs rights this function may not have on a
-- locked-down project, so that part is attempted and reported on rather than
-- assumed: the answer says whether the sign-in went too.
create or replace function delete_member(p_member uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member members%rowtype;
  v_login_removed boolean := false;
begin
  select * into v_member from members where id = p_member;
  if not found then
    raise exception 'That member no longer exists';
  end if;
  if not can_manage_branch(v_member.branch_id) then
    raise exception 'Not permitted to remove this member';
  end if;
  if v_member.id = current_member_id() then
    raise exception 'You cannot delete your own account';
  end if;
  if v_member.role = 'super_admin' and not is_super_admin() then
    raise exception 'Only a super-admin can remove a super-admin';
  end if;

  if v_member.user_id is not null then
    begin
      delete from auth.users where id = v_member.user_id;    -- the member row follows
      v_login_removed := true;
    exception when insufficient_privilege or undefined_table then
      v_login_removed := false;
    end;
  end if;

  delete from members where id = p_member;                   -- no-op if it already went

  return jsonb_build_object(
    'ok', true,
    'name', v_member.full_name,
    'login_removed', v_login_removed
  );
end $$;


-- =====================================================
-- Reporting
-- =====================================================

-- Consecutive weeks with at least one attendance, counting back
-- from the current week (or the one before, so a member is not
-- shown as broken-streak on a Monday).
create or replace function member_streak(p_member uuid)
returns int
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_weeks date[];
  v_cursor date := date_trunc('week', club_today())::date;
  v_streak int := 0;
begin
  select array_agg(distinct date_trunc('week', s.held_on)::date order by date_trunc('week', s.held_on)::date desc)
    into v_weeks
    from attendance a join sessions s on s.id = a.session_id
   where a.member_id = p_member;

  if v_weeks is null then return 0; end if;

  -- Allow the current week to be empty without breaking the run.
  if not (v_cursor = any (v_weeks)) then
    v_cursor := v_cursor - 7;
  end if;

  while v_cursor = any (v_weeks) loop
    v_streak := v_streak + 1;
    v_cursor := v_cursor - 7;
  end loop;

  return v_streak;
end $$;


-- The leaderboard. Every figure here is admin-entered or
-- admin-approved; nothing is self-reported.
--
-- Names come back as "First L." for everyone but the viewer. The club
-- runs an under-16s class, and every member can see this table, so
-- children's full names are never sent to other members' browsers.
drop function if exists leaderboard(uuid, date);
create or replace function leaderboard(p_branch uuid default null, p_since date default null)
returns table (
  member_id   uuid,
  display_name text,
  is_me       boolean,
  branch_id   uuid,
  branch_name text,
  total_points bigint,
  sessions_attended bigint,
  training_wins bigint,
  rank_code   text,
  rank_label  text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with scoped as (
    select m.id, m.full_name, m.branch_id, b.name as branch_name
      from members m
      left join branches b on b.id = m.branch_id
     where m.status = 'active'
       and (p_branch is null or m.branch_id = p_branch)
       and is_active_member()          -- deactivated accounts see nothing
  ),
  pts as (
    select l.member_id, sum(l.points)::bigint as total
      from points_ledger l
     where p_since is null or l.created_at >= p_since
     group by l.member_id
  ),
  att as (
    select a.member_id, count(*)::bigint as n
      from attendance a join sessions s on s.id = a.session_id
     where p_since is null or s.held_on >= p_since
     group by a.member_id
  ),
  wins as (
    select t.winner_id as member_id, count(*)::bigint as n
      from training_results t
     where p_since is null or t.held_on >= p_since
     group by t.winner_id
  )
  select s.id,
         case when s.id = current_member_id() then s.full_name
              else split_part(trim(s.full_name), ' ', 1)
                   || coalesce(' ' || left(nullif(regexp_replace(trim(s.full_name), '^\S+\s*(.*\s)?', ''), ''), 1) || '.', '')
         end,
         s.id = current_member_id(),
         s.branch_id, s.branch_name,
         coalesce(pts.total, 0),
         coalesce(att.n, 0),
         coalesce(wins.n, 0),
         r.code, r.label
    from scoped s
    left join pts  on pts.member_id  = s.id
    left join att  on att.member_id  = s.id
    left join wins on wins.member_id = s.id
    left join lateral (
      select code, label from ranks
       where min_points <= coalesce(pts.total, 0)
       order by min_points desc limit 1
    ) r on true
   order by coalesce(pts.total, 0) desc, s.full_name asc;
$$;


-- What an appeal has raised. Readable by the public so the
-- progress bar works without exposing individual donations.
create or replace view appeal_totals
with (security_invoker = false) as
  select a.id as appeal_id,
         a.slug,
         coalesce(sum(d.amount_pence) filter (where d.status = 'paid'), 0)::bigint as raised_pence,
         count(d.id) filter (where d.status = 'paid')::bigint as donation_count
    from appeals a
    left join donations d on d.appeal_id = a.id
   -- Same rule as the appeals themselves: the public sees live appeals only,
   -- admins see hidden ones too. Without it, a hidden draft's web address
   -- and totals were readable by anyone.
   where a.is_active or is_admin()
   group by a.id, a.slug;

grant select on appeal_totals to anon, authenticated;

-- Donations point at their appeal with `on delete set null`, so deleting an
-- appeal would quietly cut its money records loose, and a checkout still in
-- progress would land on nothing. An appeal with any donation at all (paid,
-- pending or refunded) can be hidden, never deleted.
create or replace function guard_appeal_delete()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from donations where appeal_id = old.id) then
    raise exception 'This appeal has donations recorded against it, so it cannot be deleted. To take it off the site, edit it and untick Live on the site.';
  end if;
  return old;
end $$;

drop trigger if exists appeals_keep_donations on appeals;
create trigger appeals_keep_donations
  before delete on appeals
  for each row execute function guard_appeal_delete();


-- =====================================================
-- A member's own record, with names resolved.
--
-- Members can only read their own `members` row, so a plain join
-- from their ledger to the coach who awarded the points would come
-- back empty. These functions return the signed-in member's own
-- history with the other names filled in — and nothing else.
-- =====================================================

create or replace function my_summary()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me     uuid := current_member_id();
  v_points bigint;
  v_month  bigint;
  v_sess   bigint;
  v_wins   bigint;
  v_losses bigint;
begin
  if v_me is null then return null; end if;

  select coalesce(sum(points), 0) into v_points from points_ledger where member_id = v_me;
  select coalesce(sum(points), 0) into v_month  from points_ledger
   where member_id = v_me and created_at >= date_trunc('month', now());
  select count(*) into v_sess   from attendance where member_id = v_me;
  select count(*) into v_wins   from training_results where winner_id = v_me;
  select count(*) into v_losses from training_results where opponent_id = v_me;

  return jsonb_build_object(
    'points',        v_points,
    'points_month',  v_month,
    'sessions',      v_sess,
    'wins',          v_wins,
    'losses',        v_losses,
    'streak_weeks',  member_streak(v_me)
  );
end $$;

create or replace function my_points_history(p_limit int default 100)
returns table (id uuid, points int, reason text, rule_label text, awarded_by_name text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.id, l.points, l.reason, r.label,
         coalesce(a.full_name, case when l.source_type in ('attendance', 'week') then 'Automatic' end),
         l.created_at
    from points_ledger l
    left join point_rules r on r.code = l.rule_code
    left join members a on a.id = l.awarded_by
   where l.member_id = current_member_id()
   order by l.created_at desc
   limit least(greatest(p_limit, 1), 500);
$$;

create or replace function my_attendance(p_limit int default 100)
returns table (held_on date, label text, branch_name text, source attend_source)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.held_on, s.label, b.name, a.source
    from attendance a
    join sessions s on s.id = a.session_id
    left join branches b on b.id = s.branch_id
   where a.member_id = current_member_id()
   order by s.held_on desc
   limit least(greatest(p_limit, 1), 500);
$$;

create or replace function my_training_record(p_limit int default 100)
returns table (held_on date, result text, opponent_name text, notes text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.held_on,
         case when t.winner_id = current_member_id() then 'win' else 'loss' end,
         case when t.winner_id = current_member_id() then o.full_name else w.full_name end,
         t.notes
    from training_results t
    left join members w on w.id = t.winner_id
    left join members o on o.id = t.opponent_id
   where t.winner_id = current_member_id() or t.opponent_id = current_member_id()
   order by t.held_on desc, t.created_at desc
   limit least(greatest(p_limit, 1), 500);
$$;

-- Execute grants for all of the above live in 03_policies.sql.


-- =====================================================
-- Levelling
-- =====================================================

-- The level curve, and the only place its shape lives. Its numbers are in
-- levelling_settings (set by levelling_config.sql).
--   EXP needed to reach level n = round(curve_base × n ^ curve_power)
-- Everyone starts at level 0. With the curve as set, level 1 is 50 EXP and
-- each level after needs more than the one before: 50, 91, 119, 140, 159...
create or replace function exp_for_level(p_level int)
returns bigint
language sql stable set search_path = public, pg_temp as $$
  select case when p_level <= 0 then 0
              else round(s.curve_base * power(p_level::numeric, s.curve_power))::bigint end
    from levelling_settings s;
$$;

-- The level a total of EXP is worth. No top level: it keeps counting.
create or replace function level_for_exp(p_exp bigint)
returns int
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_exp bigint := greatest(coalesce(p_exp, 0), 0);
  s     levelling_settings%rowtype;
  n     int;
begin
  select * into s from levelling_settings;
  -- Start from the curve run backwards, then step to the exact level, since
  -- rounding can leave the estimate one either side.
  n := greatest(0, floor(power(v_exp::numeric / s.curve_base, 1 / s.curve_power))::int);
  while exp_for_level(n + 1) <= v_exp loop n := n + 1; end loop;
  while n > 0 and exp_for_level(n) > v_exp loop n := n - 1; end loop;
  return n;
end $$;

-- A member's EXP: every point they have been given, plus what their
-- training log earned. Internal: it takes any member's id.
create or replace function member_exp(p_member uuid)
returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(
    coalesce((select sum(points) from points_ledger where member_id = p_member), 0)
    + coalesce((select sum(exp) from training_logs where member_id = p_member), 0),
    0)::bigint;
$$;

create or replace function my_level()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me       uuid := current_member_id();
  v_points   bigint;
  v_training bigint;
  v_total    bigint;
  v_level    int;
begin
  if v_me is null then return null; end if;
  select coalesce(sum(points), 0) into v_points   from points_ledger where member_id = v_me;
  select coalesce(sum(exp), 0)    into v_training from training_logs where member_id = v_me;
  v_total := greatest(v_points + v_training, 0);
  v_level := level_for_exp(v_total);
  return jsonb_build_object(
    'total_exp',         v_total,
    'exp_from_points',   v_points,
    'exp_from_training', v_training,
    'level',             v_level,
    'level_starts_at',   exp_for_level(v_level),
    'next_level_at',     exp_for_level(v_level + 1)
  );
end $$;

-- Logging training. The page sends what was done; this works out the EXP,
-- since a member could edit anything the page sends, and applies the daily
-- cap for that kind of training.
create or replace function log_training(
  p_date     date,
  p_kind     training_kind,
  p_minutes  int     default null,
  p_miles    numeric default null,
  p_exercise text    default null,
  p_reps     int     default null,
  p_notes    text    default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me     uuid := current_member_id();
  s        levelling_settings%rowtype;
  v_raw    int;
  v_cap    int;
  v_used   int;
  v_exp    int;
  v_count  int;
  v_before bigint;
  v_id     uuid;
begin
  if v_me is null or not is_active_member() then
    raise exception 'Only active members can log training.';
  end if;
  select * into s from levelling_settings;

  if p_date is null or p_date > club_today() then
    raise exception 'Pick the day you trained: today or an earlier day.';
  end if;
  if p_date < club_today() - s.backdate_days then
    raise exception 'Training can be logged up to % days back.', s.backdate_days;
  end if;

  p_exercise := nullif(btrim(p_exercise), '');
  p_notes    := nullif(btrim(p_notes), '');
  p_miles    := round(p_miles, 2);
  if p_minutes is not null and (p_minutes < 1 or p_minutes > 600) then
    raise exception 'Minutes should be between 1 and 600.';
  end if;
  if p_miles is not null and (p_miles <= 0 or p_miles > 100) then
    raise exception 'Miles should be more than 0 and no more than 100.';
  end if;
  if p_reps is not null and (p_reps < 1 or p_reps > 10000) then
    raise exception 'Reps should be between 1 and 10,000.';
  end if;
  if char_length(p_exercise) > 80 then raise exception 'Keep the exercise name to 80 characters.'; end if;
  if char_length(p_notes) > 500 then raise exception 'Keep notes to 500 characters.'; end if;

  -- What each kind of training is measured in, and nothing it isn't.
  case p_kind
    when 'running' then
      if p_minutes is null and p_miles is null then
        raise exception 'For a run, give the distance, the time, or both.';
      end if;
      p_exercise := null; p_reps := null;
      v_raw := floor(coalesce(p_minutes, 0) * s.exp_per_minute + coalesce(p_miles, 0) * s.exp_per_mile);
    when 'calisthenics', 'strength' then
      if p_exercise is null or p_reps is null then
        raise exception 'Give the exercise and the total reps.';
      end if;
      p_minutes := null; p_miles := null;
      v_raw := floor(p_reps / s.reps_per_exp);
    else  -- wrestling, general
      if p_minutes is null then
        raise exception 'Give how many minutes you trained.';
      end if;
      p_miles := null; p_exercise := null; p_reps := null;
      v_raw := floor(p_minutes * s.exp_per_minute);
  end case;

  -- One log at a time per member, so two quick taps can't both slip under
  -- the cap.
  perform pg_advisory_xact_lock(hashtext('training_log:' || v_me::text));

  select count(*) into v_count from training_logs where member_id = v_me and trained_on = p_date;
  if v_count >= s.max_logs_per_day then
    raise exception 'One day can hold % entries, and that day is full.', s.max_logs_per_day;
  end if;

  v_cap := case p_kind
             when 'running'      then s.cap_running
             when 'calisthenics' then s.cap_calisthenics
             when 'wrestling'    then s.cap_wrestling
             when 'strength'     then s.cap_strength
             else                     s.cap_general
           end;
  select coalesce(sum(exp), 0) into v_used
    from training_logs where member_id = v_me and trained_on = p_date and kind = p_kind;
  v_exp := greatest(0, least(v_raw, v_cap - v_used));

  v_before := member_exp(v_me);
  insert into training_logs (member_id, trained_on, kind, minutes, miles, exercise, reps, notes, exp, exp_before_cap)
  values (v_me, p_date, p_kind, p_minutes, p_miles, p_exercise, p_reps, p_notes, v_exp, v_raw)
  returning id into v_id;

  return jsonb_build_object(
    'id',             v_id,
    'exp',            v_exp,
    'exp_before_cap', v_raw,
    'capped',         v_exp < v_raw,
    'daily_cap',      v_cap,
    'level_before',   level_for_exp(v_before),
    'level_after',    level_for_exp(v_before + v_exp),
    'total_exp',      v_before + v_exp
  );
end $$;
