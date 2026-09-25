-- =====================================================
-- Badr Grappling — levelling: every number in one place
--
-- Change a number below, then run this file in the Supabase SQL editor.
-- It is also part of _run_all.generated.sql, so a full paste applies it too.
--
-- Levels are worked out from EXP whenever they are read, never stored, so
-- retuning the curve moves everyone to whatever level the new numbers give
-- them and touches nobody's EXP. EXP a training entry has already earned
-- stays as it was earned; new rates apply to entries logged from then on.
--
-- The shape of the curve is in exp_for_level() in 02_functions.sql:
--   EXP needed to reach level n = round(curve_base × n ^ curve_power)
-- Everyone starts at level 0, and there is no top level. As set below,
-- level 1 is 50 EXP, level 2 is 141, level 10 is 1,581, level 100 is 50,000.
-- =====================================================
insert into levelling_settings (
  id,
  exp_per_minute, exp_per_mile, reps_per_exp,
  cap_running, cap_calisthenics, cap_wrestling, cap_strength, cap_general,
  max_logs_per_day, backdate_days,
  curve_base, curve_power
) values (
  true,
  1,     -- exp_per_minute    EXP per minute of running, wrestling/mat work or general training
  10,    -- exp_per_mile      EXP per mile run
  5,     -- reps_per_exp      reps of calisthenics or strength that make 1 EXP
  150,   -- cap_running       the most EXP one day of running can earn
  100,   -- cap_calisthenics  the most EXP one day of calisthenics can earn
  180,   -- cap_wrestling     the most EXP one day of wrestling/mat work can earn
  100,   -- cap_strength      the most EXP one day of strength work can earn
  120,   -- cap_general       the most EXP one day of general training can earn
  10,    -- max_logs_per_day  the most entries a member can log for one day
  7,     -- backdate_days     how many days back training can be logged (0 = today only)
  50,    -- curve_base        EXP to reach level n = round(curve_base × n ^ curve_power)
  1.5    -- curve_power
)
on conflict (id) do update set
  exp_per_minute   = excluded.exp_per_minute,
  exp_per_mile     = excluded.exp_per_mile,
  reps_per_exp     = excluded.reps_per_exp,
  cap_running      = excluded.cap_running,
  cap_calisthenics = excluded.cap_calisthenics,
  cap_wrestling    = excluded.cap_wrestling,
  cap_strength     = excluded.cap_strength,
  cap_general      = excluded.cap_general,
  max_logs_per_day = excluded.max_logs_per_day,
  backdate_days    = excluded.backdate_days,
  curve_base       = excluded.curve_base,
  curve_power      = excluded.curve_power;
