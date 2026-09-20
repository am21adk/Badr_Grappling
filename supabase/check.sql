-- Badr Grappling — is the live database doing what the site says it does?
-- Read-only: run this in the Supabase SQL editor any time. Changes nothing.

select
  -- Should be 'active, inactive'. If 'pending' is still in there, the
  -- schema file has not been pasted over this database yet.
  (select string_agg(e.enumlabel::text, ', ' order by e.enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'member_status')                                as member_statuses,

  -- What a new sign-up is given. Should be 'active'.
  (select column_default from information_schema.columns
    where table_name = 'members' and column_name = 'status')          as new_signups_land_as,

  -- Whether the delete work is present. Should be 1.
  (select count(*) from pg_proc where proname = 'delete_member')      as delete_member_installed,

  -- Sign-ups are wide open if this is high as well. Nothing to fix here,
  -- just worth seeing: it is Authentication -> Providers -> Email.
  (select count(*) from auth.users where email_confirmed_at is null)  as logins_never_confirmed;
