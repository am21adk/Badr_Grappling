/* Badr Grappling — the member's own training log.
 *
 * The page only says what was done. log_training() in the database works out
 * the EXP and applies the daily cap, so nothing a member does to this page can
 * change what an entry earns. The rates shown here are read from the same
 * settings row the database uses (supabase/levelling_config.sql), so they
 * can't drift apart.
 */
import { $, $$, esc, sb, say, busy, dateShort } from './core.js';
import { ask } from './dialog.js';

export const KINDS = {
  running:      'Running',
  calisthenics: 'Calisthenics',
  wrestling:    'Wrestling / mat work',
  strength:     'Strength',
  general:      'General training',
};

let me, settings = null, onChange = () => {};

/** Set up the form. `changed(result)` runs after an entry is logged or deleted. */
export async function initTraining(member, changed) {
  me = member;
  onChange = changed || onChange;
  const form = $('#training-form');
  const kind = $('#t-kind');

  const { data } = await sb.from('levelling_settings').select('*').maybeSingle();
  settings = data;

  // Today, and how far back the database allows.
  const today = new Date().toLocaleDateString('en-CA');
  const date = $('#t-date');
  date.value = today;
  date.max = today;
  if (settings) {
    const earliest = new Date();
    earliest.setDate(earliest.getDate() - Number(settings.backdate_days));
    date.min = earliest.toLocaleDateString('en-CA');
    $('#t-rates').textContent = `Every entry earns EXP straight away: ${num(settings.exp_per_minute)} a minute `
      + `of training, ${num(settings.exp_per_mile)} a mile run, and 1 for every ${num(settings.reps_per_exp)} reps. `
      + `You can log up to ${settings.backdate_days} days back.`;
  }

  const showFields = () => {
    $$('[data-for]', form).forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(kind.value); });
    const cap = settings?.[`cap_${kind.value}`];
    $('#t-cap').textContent = cap != null ? `${KINDS[kind.value]} can earn up to ${num(cap)} EXP a day.` : '';
  };
  kind.addEventListener('change', showFields);
  showFields();

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
}

async function submit() {
  const msg = $('#t-msg');
  const btn = $('#t-submit');
  const k = $('#t-kind').value;
  const n = (sel) => { const v = $(sel).value.trim(); return v === '' ? null : Number(v); };
  const args = {
    p_date: $('#t-date').value || null,
    p_kind: k,
    p_notes: $('#t-notes').value.trim() || null,
  };
  if (k === 'running') { args.p_miles = n('#t-miles'); args.p_minutes = n('#t-run-min'); }
  else if (k === 'calisthenics' || k === 'strength') { args.p_exercise = $('#t-exercise').value.trim() || null; args.p_reps = n('#t-reps'); }
  else { args.p_minutes = n('#t-minutes'); }

  say(msg, '');
  busy(btn, true, 'Logging…');
  const { data, error } = await sb.rpc('log_training', args);
  busy(btn, false);
  // Disabling the button while it worked dropped focus to the page; give it
  // back, so keyboard users (and a level-up notice closing) land somewhere.
  if (document.activeElement === document.body) btn.focus();
  if (error) return say(msg, error.message, 'flag');

  say(msg, data.capped
    ? (data.exp > 0
      ? `Logged. +${data.exp} EXP, which reaches today's ${KINDS[k].toLowerCase()} cap of ${data.daily_cap}.`
      : `Logged, but today's ${KINDS[k].toLowerCase()} cap of ${data.daily_cap} EXP is already reached, so this one earns nothing.`)
    : `Logged. +${data.exp} EXP.`, 'good');

  // Keep the date and kind, clear the measurements, ready for the next one.
  ['#t-miles', '#t-run-min', '#t-exercise', '#t-reps', '#t-minutes', '#t-notes'].forEach((s) => { $(s).value = ''; });
  await loadTraining();
  onChange(data);
}

/** The member's own entries, newest first, with what each one earned. */
export async function loadTraining() {
  const body = $('#t-list');
  const { data, error } = await sb.from('training_logs')
    .select('id, trained_on, kind, minutes, miles, exercise, reps, notes, exp, exp_before_cap, created_at')
    .eq('member_id', me.id)
    .order('trained_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) { body.innerHTML = `<tr><td colspan="4" class="muted">Could not load your training.</td></tr>`; return; }
  if (!data.length) { body.innerHTML = `<tr><td colspan="4" class="muted">Nothing logged yet. Your first entry will show here with the EXP it earned.</td></tr>`; return; }

  body.innerHTML = data.map((t) => `
    <tr data-id="${esc(t.id)}">
      <td class="nowrap small">${esc(dateShort(t.trained_on))}</td>
      <td><strong>${esc(KINDS[t.kind] || t.kind)}</strong> <span class="small muted">${esc(measure(t))}</span>
        ${t.notes ? `<br><span class="small muted">${esc(t.notes)}</span>` : ''}</td>
      <td class="num"><span class="ledger-pts">+${esc(t.exp)}</span>${t.exp < t.exp_before_cap
        ? `<br><span class="small muted">daily cap</span>` : ''}</td>
      <td class="action-cell"><button class="linkish danger small" type="button" data-del>Delete</button></td>
    </tr>`).join('');

  $$('[data-del]', body).forEach((b) => b.addEventListener('click', async () => {
    const t = data.find((x) => x.id === b.closest('tr').dataset.id);
    if (!(await ask({
      title: 'Delete this entry?',
      body: `${KINDS[t.kind]} on ${dateShort(t.trained_on)}. The ${t.exp} EXP it earned comes off your total.`,
      confirm: 'Delete entry', danger: true,
    }))) return;
    const { error: e } = await sb.from('training_logs').delete().eq('id', t.id);
    if (e) return say($('#t-msg'), e.message, 'flag');
    say($('#t-msg'), 'Entry deleted.', 'good');
    await loadTraining();
    onChange(null);
  }));
}

function measure(t) {
  if (t.kind === 'running') {
    return [t.miles != null ? `${Number(t.miles)} mi` : '', t.minutes ? `${t.minutes} min` : ''].filter(Boolean).join(' · ');
  }
  if (t.kind === 'calisthenics' || t.kind === 'strength') return `${t.exercise} · ${t.reps} reps`;
  return `${t.minutes} min`;
}

const num = (v) => Number(v).toLocaleString('en-GB');
