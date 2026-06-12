// src/utils/schedulingEngine.js
// ─────────────────────────────────────────────────────────────
// APS Scheduler — Call Center Rotation Engine v4.1
// ─────────────────────────────────────────────────────────────
import { eachDayOfInterval, format, getDay } from 'date-fns';

// ─── Constants ───────────────────────────────────────────────

const SHIFTS = ['A', 'B', 'C'];

const DEFAULT_TARGETS = { A: 7, B: 2, C: 1 };
const PEAK_TARGETS    = { A: 9, B: 0, C: 1 };

const HARDCODED_PEAK_DAYS = new Set(['2026-07-01', '2026-07-31']);

const HARDCODED_HIGH_DEMAND = new Set([
  '2026-06-29','2026-06-30','2026-07-06',
  '2026-07-20','2026-07-27','2026-07-28','2026-07-30'
]);

const WORK_PATTERN = [1, 1, 1, 1, 1, 0, 0];

// ─── Exported constants (used by App.js) ─────────────────────

export const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export const PEAK_DAYS = {
  '2026-07-01': true,
  '2026-07-31': true,
};

export const HIGH_DEMAND_DAYS = {
  '2026-06-29': true,
  '2026-06-30': true,
  '2026-07-06': true,
  '2026-07-20': true,
  '2026-07-27': true,
  '2026-07-28': true,
  '2026-07-30': true,
};

// ─── Helpers ─────────────────────────────────────────────────

const TODAY_STR = format(new Date(), 'yyyy-MM-dd');

// Preferred days off lookup — mirrors DAYS_OFF_PAIRS in App.js
// Integer 10–16 encodes consecutive day pairs, safe for Supabase integer column
const PREF_DAYS_OFF = {
  10: [0, 1], // Sun / Mon
  11: [1, 2], // Mon / Tue
  12: [2, 3], // Tue / Wed
  13: [3, 4], // Wed / Thu
  14: [4, 5], // Thu / Fri
  15: [5, 6], // Fri / Sat
  16: [6, 0], // Sat / Sun
};

/**
 * Determines if a manager is scheduled to work on a given date.
 *
 * Supports two offset formats:
 *   - Legacy numeric (0–6): cycle-based 5-on/2-off rotation from EPOCH
 *   - Preferred days off (10–16): two specific days of week always off
 *
 * Rules:
 *   - Past dates (before today): always use legacy cycle behavior
 *   - Today forward with value 10–16: mark the two encoded days as off
 *   - Peak/high-demand override: force work regardless of preference
 */
function isWorkDay(date, rotationOffset, dateStr = null, forceWork = false) {
  // Peak/high-demand override — always work regardless of preference
  if (forceWork) return true;

  const ds = dateStr || format(date, 'yyyy-MM-dd');
  const isPast = ds < TODAY_STR;
  const offset = Number(rotationOffset);

  // New preferred days off format — only apply from today forward
  if (!isPast && PREF_DAYS_OFF[offset]) {
    const [d1, d2] = PREF_DAYS_OFF[offset];
    const dow = getDay(date);
    return dow !== d1 && dow !== d2;
  }

  // Legacy numeric cycle offset (0–6)
  const legacyOffset = (!isNaN(offset) && offset >= 0 && offset <= 6) ? offset : 0;
  const EPOCH = new Date('2026-01-05');
  const diffDays = Math.round((date - EPOCH) / (1000 * 60 * 60 * 24));
  const cyclePos = ((diffDays + legacyOffset) % 7 + 7) % 7;
  return WORK_PATTERN[cyclePos] === 1;
}

function getTargets(dateStr, settings = {}) {
  const peakDays = new Set([
    ...HARDCODED_PEAK_DAYS,
    ...(settings.peak_days || []),
  ]);
  if (peakDays.has(dateStr)) return PEAK_TARGETS;
  return settings.shift_targets_default || DEFAULT_TARGETS;
}

export const getDateKey = (date) => format(new Date(date), 'yyyy-MM-dd');

export const getAllDates = (startDate, endDate) =>
  eachDayOfInterval({ start: new Date(startDate), end: new Date(endDate) });

// ─── Main Generator ──────────────────────────────────────────

export function generateSchedule(members, startDate, endDate, settings = {}) {
  if (!members || members.length === 0) return [];

  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const rows = [];

  days.forEach((date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const targets = getTargets(dateStr, settings);
    const isPeakOrHigh = HARDCODED_PEAK_DAYS.has(dateStr) || HARDCODED_HIGH_DEMAND.has(dateStr);

    const working = [];
    const offMembers = [];

    members.forEach((m) => {
      const offset = m.rotationOffset ?? m.rotation_offset ?? 0;
      // On peak/high-demand days, force all managers to work (soft preference override)
      const forceWork = isPeakOrHigh;
      if (isWorkDay(date, offset, dateStr, forceWork)) {
        working.push(m);
      } else {
        offMembers.push(m);
      }
    });

    const assigned = assignShifts(working, targets);

    assigned.forEach(({ member, shift }) => {
      rows.push({
        member_id: member.id,
        schedule_date: dateStr,
        shift,
        is_override: false,
      });
    });

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

function assignShifts(workingMembers, targets) {
  const assigned = [];
  const unanchored = [];
  const remaining = { ...targets };

  workingMembers.forEach((m) => {
    const anchor = m.shiftAnchor || m.shift_anchor;
    if (anchor && SHIFTS.includes(anchor) && remaining[anchor] > 0) {
      assigned.push({ member: m, shift: anchor });
      remaining[anchor]--;
    } else {
      unanchored.push(m);
    }
  });

  const fillQueue = [];
  SHIFTS.forEach((s) => {
    for (let i = 0; i < (remaining[s] || 0); i++) fillQueue.push(s);
  });

  unanchored.forEach((m, i) => {
    const shift = fillQueue[i] || 'A';
    assigned.push({ member: m, shift });
  });

  const hasC = assigned.some((a) => a.shift === 'C');
  if (!hasC && assigned.length > 0) {
    for (let i = assigned.length - 1; i >= 0; i--) {
      const anchor = assigned[i].member.shiftAnchor || assigned[i].member.shift_anchor;
      if (assigned[i].shift !== 'C' && !anchor) {
        assigned[i].shift = 'C';
        break;
      }
    }
  }

  return assigned;
}

// ─── Coverage Analysis ───────────────────────────────────────

/**
 * Supports both old App.js call signature and new Supabase-based signature.
 * Old: analyzeCoverage(schedule, members, forecastData)
 * New: analyzeCoverage(dateStr, memberIds, ccSchedule, forecast, settings)
 */
export function analyzeCoverage(scheduleOrDateStr, membersOrIds, forecastOrSchedule, forecast, settings = {}) {
  // Detect old signature: first arg is an object (the full schedule)
  if (typeof scheduleOrDateStr === 'object' && !Array.isArray(scheduleOrDateStr) && !(scheduleOrDateStr instanceof String)) {
    const schedule = scheduleOrDateStr;
    const members = membersOrIds;
    const forecastData = forecastOrSchedule || {};

    const result = {};
    Object.keys(schedule).forEach((dk) => {
      const ds = schedule[dk] || {};
      const counts = { A: 0, B: 0, C: 0, OFF: 0 };
      members.forEach((m) => {
        const shift = ds[m.id] || 'OFF';
        counts[shift] = (counts[shift] || 0) + 1;
      });
      const totalWorking = counts.A + counts.B + counts.C;
      const isPeak = HARDCODED_PEAK_DAYS.has(dk);
      const isHighDemand = HARDCODED_HIGH_DEMAND.has(dk);
      const target = isPeak ? PEAK_TARGETS : DEFAULT_TARGETS;
      const gaps = {
        A: counts.A - target.A,
        B: counts.B - target.B,
        C: counts.C - target.C,
      };
      const meetsTarget = gaps.A >= 0 && gaps.B >= 0 && gaps.C >= 0;
      const fc = forecastData[dk];
      result[dk] = {
        counts,
        totalWorking,
        isPeak,
        isHighDemand,
        target,
        gaps,
        meetsTarget,
        forecastCalls: fc?.agent_calls || fc?.totalCalls || fc?.total_calls || null,
      };
    });
    return result;
  }

  // New signature
  const dateStr = scheduleOrDateStr;
  const memberIds = membersOrIds;
  const ccSchedule = forecastOrSchedule;
  const daySchedule = ccSchedule[dateStr] || {};
  const forecastDay = forecast ? forecast[dateStr] : null;

  const shiftCounts = { A: 0, B: 0, C: 0, OFF: 0 };
  memberIds.forEach((id) => {
    const entry = daySchedule[id];
    const shift = entry?.shift || 'OFF';
    shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;
  });

  const isPeak = HARDCODED_PEAK_DAYS.has(dateStr) || (settings.peak_days || []).includes(dateStr);
  const isHighDemand = HARDCODED_HIGH_DEMAND.has(dateStr) || (settings.high_demand_days || []).includes(dateStr);
  const targets = getTargets(dateStr, settings);
  const gaps = [];
  SHIFTS.forEach((s) => {
    if ((shiftCounts[s] || 0) < (targets[s] || 0)) {
      gaps.push({ shift: s, need: targets[s] - shiftCounts[s] });
    }
  });

  return {
    shiftCounts,
    onCount: shiftCounts.A + shiftCounts.B + shiftCounts.C,
    offCount: shiftCounts.OFF,
    forecastCalls: forecastDay?.agent_calls || null,
    isPeak,
    isHighDemand,
    gaps,
    hasGaps: gaps.length > 0,
  };
}

// ─── Legacy exports (App.js compatibility) ───────────────────

export const generateRotation = (members, startDate, endDate, overrides = {}) => {
  const days = getAllDates(startDate, endDate);
  const result = {};

  // DEBUG — remove after validation
  console.log('[generateRotation] members rotation offsets:', members.map(m => ({
    name: m.name,
    rotationOffset: m.rotationOffset,
    rotation_offset: m.rotation_offset,
    resolved: m.rotationOffset ?? m.rotation_offset ?? 0,
  })));

  days.forEach((date) => {
    const dk = getDateKey(date);
    const targets = getTargets(dk);
    const isPeakOrHigh = HARDCODED_PEAK_DAYS.has(dk) || HARDCODED_HIGH_DEMAND.has(dk);
    const working = [];
    const offMembers = [];

    members.forEach((m) => {
      const offset = m.rotationOffset ?? m.rotation_offset ?? 0;
      // On peak/high-demand days, force all managers to work (soft preference override)
      const forceWork = isPeakOrHigh;
      if (isWorkDay(date, offset, dk, forceWork)) {
        working.push(m);
      } else {
        offMembers.push(m);
      }
    });

    const assigned = assignShifts(working, targets);
    result[dk] = {};

    assigned.forEach(({ member, shift }) => {
      result[dk][member.id] = overrides[dk]?.[member.id] || shift;
    });
    offMembers.forEach((m) => {
      result[dk][m.id] = overrides[dk]?.[m.id] || 'OFF';
    });
  });

  return result;
};

export const getManagerSummary = (schedule, members) => {
  return members.map((m) => {
    const counts = { A: 0, B: 0, C: 0, OFF: 0 };
    Object.values(schedule).forEach((day) => {
      const shift = day[m.id] || 'OFF';
      counts[shift] = (counts[shift] || 0) + 1;
    });
    return {
      id: m.id,
      name: m.name,
      A: counts.A,
      B: counts.B,
      C: counts.C,
      OFF: counts.OFF,
      total: counts.A + counts.B + counts.C,
    };
  });
};

export const parseForecastFile = (data) => {
  const result = {};

  // IVR drop-off rates by day-of-month (DOM 1-5 have higher IVR payment rates)
  // Based on APS actuals: DOM 1-5 ~24-30% IVR, rest of month ~13.4%
  const getIvrRate = (date) => {
    const dom = new Date(date).getDate();
    if (dom === 1) return 0.30;
    if (dom <= 5) return 0.27;
    return 0.134;
  };

  data.forEach((row) => {
    // Support both native format and APS export format
    const dateRaw =
      row.date || row.Date || row.DATE ||
      row['Started At: Day'] || row['started_at_day'];

    if (!dateRaw) return;

    let dk;
    const dateStr = String(dateRaw).trim();

    // If already in YYYY-MM-DD format, use directly (avoids timezone shift)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      dk = dateStr;
    } else {
      // Parse natural language dates like "Thursday, January 1, 2026"
      const parsed = new Date(dateStr);
      if (isNaN(parsed)) return;
      dk = getDateKey(parsed);
    }

    const totalCalls =
      parseInt(
        row.total_calls || row['Total Calls'] || row.totalCalls ||
        row['Raw Inbound Calls'] || row.Count || row.count || 0
      );

    // Use provided agent_calls if available, otherwise apply IVR strip
    const agentCalls =
      parseInt(
        row.agent_calls || row['Agent Calls'] || row.agentCalls ||
        row['True Agent Calls'] || 0
      ) ||
      Math.round(totalCalls * (1 - getIvrRate(dk)));

    result[dk] = {
      total_calls: totalCalls,
      totalCalls: totalCalls,
      agent_calls: agentCalls,
    };
  });
  return result;
};

export const parseHourlyFile = (data) => {
  return data.map((row) => ({
    // Support both native format and APS export format
    hour: row.hour || row.Hour || row.TIME || row['Started At: Hour of day'] || '',
    callsPerDay: parseFloat(
      row.callsPerDay || row['Calls Per Day'] || row['Calls per Day'] ||
      row.calls || row.Count || 0
    ),
  })).filter((r) => r.callsPerDay > 0);
};

export default generateSchedule;
