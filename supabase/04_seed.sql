-- =====================================================
-- Badr Grappling — seed data
--
-- Branch details, class times and pricing are taken from
-- badrgrappling.co.uk and the club's Instagram. Re-runnable.
-- =====================================================

-- ---------- branches ----------
insert into branches (slug, name, city, address, postcode, intro, contact_email, is_active, sort_order)
values
  ('london', 'London', 'London',
   'Imam Hussain Mosque, 14 Brondesbury Road', 'NW6 6AS',
   'Our founding branch. Adults and kids train every Friday evening at the mosque hall on Brondesbury Road.',
   'badrgrappling@outlook.com', true, 10),

  -- Manchester is seeded so the second branch is ready to go, but left
  -- inactive: it has no address, no times and no photography yet, and an
  -- empty branch on the public site reads as broken. Fill the details in,
  -- then run:  update branches set is_active = true where slug = 'manchester';
  ('manchester', 'Manchester', 'Manchester',
   null, null,
   null,
   null, false, 20)
on conflict (slug) do nothing;


-- ---------- London class times ----------
-- Friday is weekday 5. Times from the club's Join us page.
with b as (select id from branches where slug = 'london')
insert into class_times (branch_id, label, age_group, weekday, starts_at, ends_at, note)
select b.id, v.label, v.age_group, v.weekday, v.starts_at::time, v.ends_at::time, v.note
from b, (values
  ('Kids class',   'Under 16', 5, '18:30', '19:30', 'Children must be signed in and out by a parent or approved adult.'),
  ('Adults class', '16+',      5, '19:30', '21:00', null)
) as v(label, age_group, weekday, starts_at, ends_at, note)
where not exists (
  select 1 from class_times c where c.branch_id = b.id and c.label = v.label
);


-- ---------- rank ladder ----------
-- Thresholds are editable by a super-admin in the admin panel.
insert into ranks (code, label, min_points, sort_order) values
  ('E', 'Rank E', 0,    10),
  ('D', 'Rank D', 250,  20),
  ('C', 'Rank C', 600,  30),
  ('B', 'Rank B', 1200, 40),
  ('A', 'Rank A', 2200, 50),
  ('S', 'Rank S', 4000, 60)
on conflict (code) do nothing;


-- ---------- point values ----------
-- `is_auto` marks the ones the system awards without a coach touching it.
insert into point_rules (code, label, points, is_auto, sort_order) values
  ('attend_session', 'Attend a session',                  10, true,  10),
  ('week_complete',  'Full week of sessions attended',    25, true,  20),
  ('home_workout',   'Complete a logged home workout',     5, false, 30),
  ('training_win',   'Win in a training round',           15, false, 40),
  ('referral',       'Refer a friend who signs up and attends', 50, false, 50),
  ('social_tag',     'Tag the club in a social post',      5, false, 60)
on conflict (code) do nothing;


-- =====================================================
-- After running this, promote yourself to super-admin.
-- Sign up through the site first, then run:
--
--   update members
--      set role = 'super_admin',
--          status = 'active',
--          branch_id = (select id from branches where slug = 'london')
--    where email = 'you@example.com';
-- =====================================================
