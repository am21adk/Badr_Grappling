-- =====================================================
-- Badr Grappling — weekly QR rotation
--
-- Needs the pg_cron extension. In the Supabase dashboard:
--   Database -> Extensions -> enable "pg_cron", then run this file.
--
-- Every Monday at 00:05 UK time:
--   * a fresh check-in code is issued for each live branch (last week's
--     expired at midnight)
--   * last week's full-week bonuses are settled
--
-- Both also happen without this job — the QR tab creates the week's code
-- when a coach opens it, and the first register activity of a new week
-- settles the week before — but with it, nobody has to wait for either.
-- =====================================================

create extension if not exists pg_cron;

-- Remove an earlier schedule of the same name before adding it again.
select cron.unschedule(jobid) from cron.job where jobname in ('badr-rotate-qr', 'badr-weekly');

-- pg_cron runs in UTC. 23:05 UTC Sunday is 00:05 Monday in winter and
-- 00:05 Monday BST is 23:05 UTC Sunday in summer, so run at both and let
-- the functions' idempotence make the second run a no-op.
select cron.schedule('badr-weekly', '5 0,23 * * 0,1', $$ select public.weekly_maintenance(); $$);
