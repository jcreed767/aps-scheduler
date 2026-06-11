// src/lib/db.js
// ─────────────────────────────────────────────────────────────
// APS Scheduler — Database Service Layer
// All Supabase CRUD lives here. Components never call supabase directly.
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase';
import { format } from 'date-fns';

// ─── Helpers ─────────────────────────────────────────────────

const dateStr = (d) => (d instanceof Date ? format(d, 'yyyy-MM-dd') : d);

function handleError(context, error) {
  if (error) {
    console.error(`[APS DB] ${context}:`, error.message);
    throw new Error(`${context}: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// TEAM MEMBERS
// ─────────────────────────────────────────────────────────────

/** Fetch all active members, optionally filtered by team */
export async function getMembers(team = null) {
  let q = supabase
    .from('team_members')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (team) q = q.eq('team', team);

  const { data, error } = await q;
  handleError('getMembers', error);
  return data;
}

/** Insert a new team member */
export async function addMember(member) {
  const { data, error } = await supabase
    .from('team_members')
    .insert([member])
    .select()
    .single();
  handleError('addMember', error);
  return data;
}

/** Update an existing team member by id */
export async function updateMember(id, updates) {
  const { data, error } = await supabase
    .from('team_members')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  handleError('updateMember', error);
  return data;
}

/** Soft-delete: set active = false */
export async function removeMember(id) {
  const { error } = await supabase
    .from('team_members')
    .update({ active: false })
    .eq('id', id);
  handleError('removeMember', error);
}

/** Reorder members (pass array of {id, sort_order}) */
export async function reorderMembers(updates) {
  const { error } = await supabase
    .from('team_members')
    .upsert(updates, { onConflict: 'id' });
  handleError('reorderMembers', error);
}

// ─────────────────────────────────────────────────────────────
// CALL CENTER SCHEDULE
// ─────────────────────────────────────────────────────────────

/**
 * Load call center schedule entries for a date range.
 * Returns array of { id, member_id, schedule_date, shift, is_override }
 */
export async function getCCSchedule(startDate, endDate) {
  const { data, error } = await supabase
    .from('callcenter_schedule')
    .select('*, team_members(name, shift_anchor, rotation_offset)')
    .gte('schedule_date', dateStr(startDate))
    .lte('schedule_date', dateStr(endDate))
    .order('schedule_date', { ascending: true });
  handleError('getCCSchedule', error);
  return data;
}

/**
 * Upsert a batch of generated schedule entries (non-override).
 * Skips any row already marked is_override = true so manual edits survive.
 */
export async function upsertGeneratedSchedule(entries) {
  if (!entries.length) return;

  // Only upsert rows that aren't already overridden
  const { data: existing } = await supabase
    .from('callcenter_schedule')
    .select('member_id, schedule_date, is_override')
    .in('schedule_date', [...new Set(entries.map((e) => e.schedule_date))]);

  const overriddenKeys = new Set(
    (existing || [])
      .filter((r) => r.is_override)
      .map((r) => `${r.member_id}__${r.schedule_date}`)
  );

  const safeEntries = entries.filter(
    (e) => !overriddenKeys.has(`${e.member_id}__${e.schedule_date}`)
  );

  if (!safeEntries.length) return;

  const { error } = await supabase
    .from('callcenter_schedule')
    .upsert(safeEntries, { onConflict: 'member_id,schedule_date' });
  handleError('upsertGeneratedSchedule', error);
}

/**
 * Set a single cell override (manual edit in the grid).
 * Always sets is_override = true so generated re-runs won't clobber it.
 */
export async function setCCShiftOverride(memberId, date, shift) {
  const { error } = await supabase
    .from('callcenter_schedule')
    .upsert(
      {
        member_id: memberId,
        schedule_date: dateStr(date),
        shift,
        is_override: true,
      },
      { onConflict: 'member_id,schedule_date' }
    );
  handleError('setCCShiftOverride', error);
}

/** Clear all override entries for a given date range (reset to generated) */
export async function clearCCOverrides(startDate, endDate) {
  const { error } = await supabase
    .from('callcenter_schedule')
    .delete()
    .gte('schedule_date', dateStr(startDate))
    .lte('schedule_date', dateStr(endDate))
    .eq('is_override', true);
  handleError('clearCCOverrides', error);
}

// ─────────────────────────────────────────────────────────────
// MANUAL SCHEDULES (Sales, Collections, Districts)
// ─────────────────────────────────────────────────────────────

/**
 * Load manual schedule entries for a team within a date range.
 */
export async function getManualSchedule(teamOrMemberIds, startDate, endDate) {
  let q = supabase
    .from('manual_schedules')
    .select('*, team_members(name, team, role)')
    .gte('schedule_date', dateStr(startDate))
    .lte('schedule_date', dateStr(endDate))
    .order('schedule_date', { ascending: true });

  if (Array.isArray(teamOrMemberIds)) {
    q = q.in('member_id', teamOrMemberIds);
  }

  const { data, error } = await q;
  handleError('getManualSchedule', error);
  return data;
}

/**
 * Upsert a manual schedule cell (status + optional note).
 */
export async function setManualStatus(memberId, date, status, note = null) {
  const { error } = await supabase
    .from('manual_schedules')
    .upsert(
      {
        member_id: memberId,
        schedule_date: dateStr(date),
        status,
        note,
      },
      { onConflict: 'member_id,schedule_date' }
    );
  handleError('setManualStatus', error);
}

/** Delete a manual schedule entry (revert to empty/default) */
export async function clearManualStatus(memberId, date) {
  const { error } = await supabase
    .from('manual_schedules')
    .delete()
    .eq('member_id', memberId)
    .eq('schedule_date', dateStr(date));
  handleError('clearManualStatus', error);
}

// ─────────────────────────────────────────────────────────────
// FORECAST DATA
// ─────────────────────────────────────────────────────────────

/** Load forecast entries for a date range */
export async function getForecast(startDate, endDate) {
  const { data, error } = await supabase
    .from('forecast_data')
    .select('*')
    .gte('forecast_date', dateStr(startDate))
    .lte('forecast_date', dateStr(endDate))
    .order('forecast_date', { ascending: true });
  handleError('getForecast', error);
  return data;
}

/** Upsert forecast data rows (from CSV/Excel upload) */
export async function upsertForecast(rows) {
  if (!rows.length) return;
  const { error } = await supabase
    .from('forecast_data')
    .upsert(rows, { onConflict: 'forecast_date' });
  handleError('upsertForecast', error);
}

/** Delete forecast rows for a date range (allows clean re-upload) */
export async function clearForecast(startDate, endDate) {
  const { error } = await supabase
    .from('forecast_data')
    .delete()
    .gte('forecast_date', dateStr(startDate))
    .lte('forecast_date', dateStr(endDate));
  handleError('clearForecast', error);
}

// ─────────────────────────────────────────────────────────────
// SPOTLIGHT
// ─────────────────────────────────────────────────────────────

/** Get spotlight for a given month string, e.g. "2026-06" */
export async function getSpotlight(month) {
  const { data, error } = await supabase
    .from('spotlight')
    .select('*, team_members(name, role)')
    .eq('month', month)
    .maybeSingle();
  handleError('getSpotlight', error);
  return data;
}

/** Get all spotlights (for history view) */
export async function getAllSpotlights() {
  const { data, error } = await supabase
    .from('spotlight')
    .select('*, team_members(name, role)')
    .order('month', { ascending: false });
  handleError('getAllSpotlights', error);
  return data;
}

/** Upsert spotlight for a month */
export async function setSpotlight(month, memberId, headline, body) {
  const { error } = await supabase
    .from('spotlight')
    .upsert({ month, member_id: memberId, headline, body }, { onConflict: 'month' });
  handleError('setSpotlight', error);
}

// ─────────────────────────────────────────────────────────────
// APP SETTINGS
// ─────────────────────────────────────────────────────────────

/** Load all app settings as a flat { key: value } object */
export async function getSettings() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value');
  handleError('getSettings', error);
  return Object.fromEntries((data || []).map((r) => [r.key, r.value]));
}

/** Update a single setting by key */
export async function setSetting(key, value) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value }, { onConflict: 'key' });
  handleError('setSetting', error);
}

/** Update multiple settings at once */
export async function setSettings(updates) {
  const rows = Object.entries(updates).map(([key, value]) => ({ key, value }));
  const { error } = await supabase
    .from('app_settings')
    .upsert(rows, { onConflict: 'key' });
  handleError('setSettings', error);
}
