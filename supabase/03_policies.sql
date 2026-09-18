-- =====================================================
-- Badr Grappling — row level security
--
-- Shape of it:
--   public visitor  — branches, class times, published updates,
--                     active appeals and appeal totals. Nothing else.
--   member          — their own record, their own points, attendance
--                     and claims, plus the video library.
--   branch admin    — everything above, for their own branch only.
--   super admin     — the same, across every branch, plus the
--                     club-wide settings (ranks, point values).
-- =====================================================

alter table branches         enable row level security;
alter table members          enable row level security;
alter table class_times      enable row level security;
alter table sessions         enable row level security;
alter table attendance       enable row level security;
alter table qr_tokens        enable row level security;
alter table ranks            enable row level security;
alter table point_rules      enable row level security;
alter table points_ledger    enable row level security;
alter table training_results enable row level security;
alter table member_claims    enable row level security;
alter table videos           enable row level security;
alter table appeals          enable row level security;
alter table donations        enable row level security;
alter table updates          enable row level security;
alter table branch_enquiries enable row level security;
-- Internal only: RLS on and no policies, so no API role can read or write it.
alter table week_settlements enable row level security;

-- Re-runnable: drop every policy this file defines before creating it.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
     where schemaname = 'public'
       and tablename in ('branches','members','class_times','sessions','attendance',
                         'qr_tokens','ranks','point_rules','points_ledger',
                         'training_results','member_claims','videos','appeals',
                         'donations','updates','branch_enquiries')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;


-- ---------- branches ----------
create policy branches_public_read on branches
  for select using (is_active or is_admin());

create policy branches_admin_write on branches
  for all using (is_super_admin() or can_manage_branch(id))
  with check (is_super_admin() or can_manage_branch(id));


-- ---------- class times ----------
create policy class_times_public_read on class_times
  for select using (true);

create policy class_times_admin_write on class_times
  for all using (can_manage_branch(branch_id))
  with check (can_manage_branch(branch_id));


-- ---------- members ----------
create policy members_read_self on members
  for select using (user_id = auth.uid());

create policy members_read_branch on members
  for select using (is_super_admin() or (is_admin() and branch_id is not distinct from current_member_branch()));

-- Members see other members only through the leaderboard() function,
-- which returns initials, never the rows themselves.
create policy members_update_self on members
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Branch admins can approve, edit and deactivate members of their own
-- branch. Only a super-admin can add rows by hand or delete them;
-- deactivating keeps a member's history intact, deleting does not.
create policy members_admin_update on members
  for update using (is_super_admin() or (is_admin() and branch_id is not distinct from current_member_branch()))
  with check (is_super_admin() or (is_admin() and branch_id is not distinct from current_member_branch()));

create policy members_super_insert on members
  for insert with check (is_super_admin());

create policy members_super_delete on members
  for delete using (is_super_admin());

-- RLS decides which rows someone may touch, but not which columns, so
-- the rules about *what* may change live in this trigger:
--   * a member cannot change their own role, status, branch or join date
--   * only a super-admin can change anyone's role — otherwise a branch
--     admin could promote themselves to super-admin
--   * only a super-admin can edit a super-admin's row
create or replace function guard_member_self_update()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Service-role and SQL-editor sessions have no auth.uid(); let them through.
  if auth.uid() is null or is_super_admin() then
    return new;
  end if;

  if old.role = 'super_admin' then
    raise exception 'Only a super-admin can change a super-admin';
  end if;

  if new.role is distinct from old.role then
    raise exception 'Only a super-admin can change roles';
  end if;

  if is_admin() then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.branch_id is distinct from old.branch_id
     or new.joined_on is distinct from old.joined_on
     or new.referred_by is distinct from old.referred_by
     or new.user_id is distinct from old.user_id then
    raise exception 'Members cannot change their own role, status, branch or join date';
  end if;
  return new;
end $$;

drop trigger if exists members_self_guard on members;
create trigger members_self_guard
  before update on members
  for each row execute function guard_member_self_update();


-- ---------- sessions ----------
create policy sessions_member_read on sessions
  for select using (
    is_admin() or (is_active_member() and branch_id is not distinct from current_member_branch())
  );

create policy sessions_admin_write on sessions
  for all using (can_manage_branch(branch_id))
  with check (can_manage_branch(branch_id));


-- ---------- attendance ----------
create policy attendance_read_own on attendance
  for select using (member_id = current_member_id());

create policy attendance_admin_read on attendance
  for select using (
    exists (select 1 from sessions s where s.id = session_id and can_manage_branch(s.branch_id))
  );

-- The coach's register writes here directly. QR check-ins come through
-- checkin_with_token(), which is SECURITY DEFINER and bypasses this.
create policy attendance_admin_write on attendance
  for all using (
    exists (select 1 from sessions s where s.id = session_id and can_manage_branch(s.branch_id))
  )
  with check (
    exists (select 1 from sessions s where s.id = session_id and can_manage_branch(s.branch_id))
  );


-- ---------- qr tokens ----------
-- Deliberately no public read: a live token is the check-in.
create policy qr_admin_all on qr_tokens
  for all using (can_manage_branch(branch_id))
  with check (can_manage_branch(branch_id));


-- ---------- ranks & point values ----------
-- Readable by anyone signed in, so members can see what earns points
-- and where the ladder sits. Club-wide settings, so writes are
-- super-admin only: a branch admin changing a threshold would move
-- every other branch's ladder too.
create policy ranks_read on ranks
  for select using (true);

create policy ranks_write on ranks
  for all using (is_super_admin()) with check (is_super_admin());

create policy rules_read on point_rules
  for select using (true);

create policy rules_write on point_rules
  for all using (is_super_admin()) with check (is_super_admin());


-- ---------- points ledger ----------
create policy points_read_own on points_ledger
  for select using (member_id = current_member_id());

create policy points_admin_read on points_ledger
  for select using (
    exists (select 1 from members m where m.id = member_id and can_manage_branch(m.branch_id))
  );

-- No insert/update/delete policy on purpose. Every write goes through
-- award_rule_points() or adjust_points(), which are SECURITY DEFINER and
-- record who did it. Members can never edit their own totals.


-- ---------- training results ----------
create policy training_read_own on training_results
  for select using (
    winner_id = current_member_id() or opponent_id = current_member_id()
  );

create policy training_admin_all on training_results
  for all using (can_manage_branch(branch_id))
  with check (can_manage_branch(branch_id));


-- ---------- claims ----------
create policy claims_insert_own on member_claims
  for insert with check (member_id = current_member_id() and status = 'pending');

create policy claims_read_own on member_claims
  for select using (member_id = current_member_id());

create policy claims_admin_all on member_claims
  for all using (
    exists (select 1 from members m where m.id = member_id and can_manage_branch(m.branch_id))
  )
  with check (
    exists (select 1 from members m where m.id = member_id and can_manage_branch(m.branch_id))
  );


-- ---------- videos ----------
-- Members only. A signed-out visitor sees nothing.
create policy videos_member_read on videos
  for select using (is_active_member() and not is_archived);

create policy videos_admin_all on videos
  for all using (is_admin() and (branch_id is null or can_manage_branch(branch_id)))
  with check (is_admin() and (branch_id is null or can_manage_branch(branch_id)));


-- ---------- appeals ----------
create policy appeals_public_read on appeals
  for select using (is_active or is_admin());

create policy appeals_admin_write on appeals
  for all using (is_super_admin() or can_manage_branch(branch_id))
  with check (is_super_admin() or can_manage_branch(branch_id));


-- ---------- donations ----------
-- Written only by the Stripe webhook, which uses the service-role key and
-- bypasses RLS entirely. Admins can read; the public gets the totals view.
-- Donor names and emails are personal data: a branch admin sees the
-- contributions to their own branch's appeals, a super-admin sees all.
create policy donations_admin_read on donations
  for select using (
    is_super_admin()
    or exists (select 1 from appeals a where a.id = appeal_id and a.branch_id is not null
               and can_manage_branch(a.branch_id))
  );


-- ---------- updates ----------
create policy updates_public_read on updates
  for select using (is_published or is_admin());

create policy updates_admin_write on updates
  for all using (is_super_admin() or can_manage_branch(branch_id))
  with check (is_super_admin() or can_manage_branch(branch_id));


-- ---------- branch enquiries ----------
-- No public insert. Submissions go through /api/enquiry, which uses the
-- service-role key, so the spam trap and the email apply to every one.
-- An enquiry is about a city with no branch yet, so it belongs to no
-- branch admin: super-admins only.
create policy enquiries_admin_read on branch_enquiries
  for select using (is_super_admin());

create policy enquiries_admin_update on branch_enquiries
  for update using (is_super_admin()) with check (is_super_admin());


-- ---------- execute grants ----------
-- Supabase grants EXECUTE on every new function in `public` to anon and
-- authenticated. Left alone, that would let anyone call internal helpers
-- such as award_rule_points() straight through the API and hand out
-- points. So: take execute away from everyone, then give back exactly
-- what each role needs.
revoke execute on all functions in schema public from public, anon, authenticated;

-- Used inside row-level policies. Policies run as the person querying,
-- so these must stay callable by both roles. Each only answers questions
-- about the caller themselves.
grant execute on function current_member_id()      to anon, authenticated;
grant execute on function current_member_role()    to anon, authenticated;
grant execute on function current_member_branch()  to anon, authenticated;
grant execute on function is_active_member()       to anon, authenticated;
grant execute on function is_admin()               to anon, authenticated;
grant execute on function is_super_admin()         to anon, authenticated;
grant execute on function can_manage_branch(uuid)  to anon, authenticated;

-- What the site calls, signed in.
grant execute on function checkin_with_token(text)            to authenticated;
grant execute on function ensure_qr_token(uuid)               to authenticated;
grant execute on function rotate_qr_token(uuid)               to authenticated;
grant execute on function review_claim(uuid, boolean, text)   to authenticated;
grant execute on function adjust_points(uuid, int, text, text) to authenticated;
grant execute on function leaderboard(uuid, date)             to authenticated;
grant execute on function my_summary()                        to authenticated;
grant execute on function my_points_history(int)              to authenticated;
grant execute on function my_attendance(int)                  to authenticated;
grant execute on function my_training_record(int)            to authenticated;

-- Everything else — award_rule_points, check_week_bonus, member_streak,
-- rotate_all_qr_tokens, the trigger functions — runs only from inside
-- the database (triggers, other SECURITY DEFINER functions, pg_cron).
