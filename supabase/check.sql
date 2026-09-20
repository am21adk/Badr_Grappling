-- Badr Grappling — is the live database doing what the site says it does?
-- Read-only: run this in the Supabase SQL editor any time. Changes nothing.

select
  -- What a new sign-up is given by the trigger.
  (select case
     when prosrc like '%''active''%'  then 'active — no approval needed'
     when prosrc like '%''pending''%' then 'PENDING — a coach still has to approve'
     else 'cannot tell, read handle_new_user by hand'
   end from pg_proc where proname = 'handle_new_user')                as new_signups_land_as,

  -- Whether the delete work is present.
  (select count(*) from pg_proc where proname = 'delete_member')      as delete_member_installed,

  -- Anyone left over from before the change.
  (select count(*) from members where status = 'pending')             as members_still_waiting,

  -- Sign-ups are wide open if this is off as well. Nothing to fix here,
  -- just worth seeing: it is Authentication -> Providers -> Email.
  (select count(*) from auth.users where email_confirmed_at is null)  as logins_never_confirmed;
