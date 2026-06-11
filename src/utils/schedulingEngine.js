// src/utils/schedulingEngine.js
// ─────────────────────────────────────────────────────────────
// APS Scheduler — Call Center Rotation Engine v4.1
//
// Generates a 5-on/2-off schedule for all Call Center members
// across a date range, applying:
//   - Individual rotation offsets (stored in team_members.rotation_offset)
//   - Shift anchor assignments (A / B / C)
//   - Peak day overrides (9A/0B/1C)
//   - Weekend defaults (same 7/2/1 split, min 1C enforced)
//
// Returns an array of rows ready for upsertGeneratedSchedule():
//   [{ member_id, schedule_date, shift, is_override: false }, ...]
// ─────────────────────────────────────────────────────────────
import { eachDayOfInterval, format, getDay } from 'date-fns';

// ─── Constants ───────────────────────────────────────────────

const SHIFTS = ['A', 'B', 'C'];

// Default daily targets: { A: 7, B: 2, C: 1 } (10 on, 4 off)
const DEFAULT_TARGETS = { A: 7, B: 2, C: 1 };
const PEAK_TARGETS    = { A: 9, B: 0, C: 1 };

// Hard-coded peak days (also pulled from settings at runtime)
const HARDCODED_PEAK_DAYS = new Set(['2026-07-01', '2026-07-31']);

// 5-on/2-off pattern: 1 = working, 0 = off
// Position in 7-day cycle: Mon=0 … Sun=6 (JS getDay() is Sun=0, so we rotate)
const WORK_PATTERN = [1, 1, 1, 1, 1, 0, 0]; // 5 on, 2 off

// ─── Helpers ─────────────────────────────────────────────────

/** Is day d a working day for a member with the given rotation offset? */
function isWorkDay(date, rotationOffset) {
  // Use a fixed epoch anchor (2026-01-05 = Monday) so offsets are stable
  const EPOCH = new Date('2026-01-05');
  const diffDays = Math.round((date - EPOCH) / (1000 * 60 * 60 * 24));
  const cyclePos = ((diffDays + rotationOffset) % 7 + 7) % 7;
  return WORK_PATTERN[cyclePos] === 1;
}

/** Determine the shift target object for a given date */
function getTargets(dateStr, settings = {}) {
  const peakDays = new Set([
    ...HARDCODED_PEAK_DAYS,
    ...(settings.peak_days || []),
  ]);
  if (peakDays.has(dateStr)) return PEAK_TARGETS;

  // Weekend: same split but enforced downstream
  return settings.shift_targets_default || DEFAULT_TARGETS;
}

// ─── Main Generator ──────────────────────────────────────────

/**
 * Generate a full schedule for all Call Center members across a date range.
 *
 * @param {Array}  members    - Array of team_member rows (team = 'callcenter')
 * @param {Date}   startDate  - First day to generate
 * @param {Date}   endDate    - Last day to generate (inclusive)
 * @param {Object} settings   - App settings object (from Supabase app_settings table)
 * @returns {Array}           - Rows ready for Supabase upsert
 */
export function generateSchedule(members, startDate, endDate, settings = {}) {
  if (!members || members.length === 0) return [];

  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const rows = [];

  days.forEach((date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const targets = getTargets(dateStr, settings);

    // Step 1: Split members into working vs off for this day
    const working = [];
    const offMembers = [];

    members.forEach((m) => {
      const offset = m.rotation_offset ?? 0;
      if (isWorkDay(date, offset)) {
        working.push(m);
      } else {
        offMembers.push(m);
      }
    });

    // Step 2: Assign shifts to working members
    // Priority: respect shift_anchor, then fill to targets
    const assigned = assignShifts(working, targets);

    // Step 3: Push working rows
    assigned.forEach(({ member, shift }) => {
      rows.push({
        member_id: member.id,
        schedule_date: dateStr,
        shift,
        is_override: false,
      });
    });

    // Step 4: Push OFF rows
    offMembers.forEach((m) => {
      rows.push({
        member_id: m.id,
        schedule_date: dateStr,
        shift: 'OFF',
        is_override: false,
      });
    });
  });

  return rows;
}

/**
 * Assign shifts to a pool of working members for one day.
 * Respects shift_anchor where set, fills remaining slots by target counts.
 */
function assignShifts(workingMembers, targets) {
  const assigned = [];
  const unanchored = [];

  // Tally how many slots are consumed by anchored members
  const remaining = { ...targets };

  // Pass 1: honor anchors
  workingMembers.forEach((m) => {
    const anchor = m.shift_anchor;
    if (anchor && SHIFTS.includes(anchor) && remaining[anchor] > 0) {
      assigned.push({ member: m, shift: anchor });
      remaining[anchor]--;
    } else {
      unanchored.push(m);
    }
  });

  // Pass 2: fill unanchored members into remaining slots
  // Build ordered fill queue: A slots first, then B, then C
  const fillQueue = [];
  SHIFTS.forEach((s) => {
    for (let i = 0; i < (remaining[s] || 0); i++) fillQueue.push(s);
  });

  unanchored.forEach((m, i) => {
    const shift = fillQueue[i] || 'A'; // default to A if more workers than slots
    assigned.push({ member: m, shift });
  });

  // Guarantee: at least 1 Shift C per day
  const hasC = assigned.some((a) => a.shift === 'C');
  if (!hasC && assigned.length > 0) {
    // Promote the last non-C, non-anchored assignment to C
    for (let i = assigned.length - 1; i >= 0; i--) {
      if (assigned[i].shift !== 'C' && !assigned[i].member.shift_anchor) {
        assigned[i].shift = 'C';
        break;
      }
    }
  }

  return assigned;
}

// ─── Coverage Analysis ───────────────────────────────────────

/**
 * Analyze coverage for a single date given its schedule and forecast.
 * Returns { shiftCounts, onCount, offCount, forecastCalls, gaps, isPeak }
 */
export function analyzeCoverage(dateStr, memberIds, ccSchedule, forecast, settings = {}) {
  const daySchedule = ccSchedule[dateStr] || {};
  const forecastDay = forecast[dateStr];

  const shiftCounts = { A: 0, B: 0, C: 0, OFF: 0 };
  memberIds.forEach((id) => {
    const entry = daySchedule[id];
    const shift = entry?.shift || 'OFF';
    shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;
  });

  const onCount = shiftCounts.A + shiftCounts.B + shiftCounts.C;
  const offCount = shiftCounts.OFF;

  const isPeak = HARDCODED_PEAK_DAYS.has(dateStr) ||
    (settings.peak_days || []).includes(dateStr);
  const isHighDemand = (settings.high_demand_days || []).includes(dateStr);

  const targets = getTargets(dateStr, settings);
  const gaps = [];
  SHIFTS.forEach((s) => {
    const target = targets[s] || 0;
    const actual = shiftCounts[s] || 0;
    if (actual < target) {
      gaps.push({ shift: s, need: target - actual });
    }
  });

  if (shiftCounts.C === 0) {
    gaps.push({ shift: 'C', need: 1, type: 'minimum' });
  }

  return {
    shiftCounts,
    onCount,
    offCount,
    forecastCalls: forecastDay?.agent_calls || null,
    isPeak,
    isHighDemand,
    gaps,
    hasGaps: gaps.length > 0,
  };
}

export default generateSchedule;
