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

// Work week runs Monday → Sunday across the app. Use this with date-fns
// startOfWeek/endOfWeek for any weekly grouping so the convention stays
// consistent (1 = Monday in date-fns).
export const WEEK_STARTS_ON = 1;

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
  if (forceWork) return true;

  const ds = dateStr || format(date, 'yyyy-MM-dd');
  const isPast = ds < TODAY_STR;
  const offset = Number(rotationOffset);

  if (!isPast && PREF_DAYS_OFF[offset]) {
    const [d1, d2] = PREF_DAYS_OFF[offset];
    const dow = getDay(date);
    return dow !== d1 && dow !== d2;
  }

  const legacyOffset = (!isNaN(offset) && offset >= 0 && offset <= 6) ? offset : 0;
  const EPOCH = new Date('2026-01-05');
  const diffDays = Math.round((date - EPOCH) / (1000 * 60 * 60 * 24));
  const cyclePos = ((diffDays + legacyOffset) % 7 + 7) % 7;
  return WORK_PATTERN[cyclePos] === 1;
}

/**
 * Derive a per-day shift target from forecast call volume.
 * Total headcount scales with demand (agent calls / callsPerAgent), is floored
 * at minStaff and capped at the roster size, then split across shifts.
 *   - peak days: early-heavy (all but one on the early shift, one on late)
 *   - normal days: ~70% early / ~20% mid / ~10% late, always >=1 on late
 */
function targetFromForecast(agentCalls, opts = {}) {
  const callsPerAgent = Number(opts.callsPerAgent) || 30;
  const minStaff = Number.isFinite(opts.minStaff) ? opts.minStaff : 3;
  const rosterSize = Number.isFinite(opts.rosterSize) ? opts.rosterSize : Infinity;
  const peak = opts.peak === true;

  const n = Number(agentCalls) || 0;
  let T = Math.round(n / callsPerAgent);
  T = Math.max(minStaff, T);
  T = Math.min(rosterSize, T);
  if (T < 1) T = Math.min(1, rosterSize);

  if (peak) {
    const C = T >= 1 ? 1 : 0;
    return { A: T - C, B: 0, C };
  }
  const C = Math.min(T, Math.max(1, Math.round(T * 0.1)));
  const A = Math.min(T - C, Math.max(0, Math.round(T * 0.7)));
  const B = T - A - C;
  return { A, B, C };
}

function getTargets(dateStr, settings = {}, forecast = {}, rosterSize = Infinity) {
  const peakDays = new Set([
    ...HARDCODED_PEAK_DAYS,
    ...(settings.peak_days || []),
  ]);
  const isPeak = peakDays.has(dateStr);

  // Forecast-driven targets (default ON; falls back to fixed targets when a
  // day has no forecast data). Disable with settings.forecast_targets = false.
  const useForecast = settings.forecast_targets !== false;
  const fc = forecast && forecast[dateStr];
  const agentCalls = fc
    ? (fc.agent_calls ?? fc.agentCalls ?? fc.totalCalls ?? fc.total_calls)
    : null;

  if (useForecast && agentCalls != null) {
    return targetFromForecast(agentCalls, {
      callsPerAgent: Number(settings.calls_per_agent) || 30,
      minStaff: settings.min_staff != null ? Number(settings.min_staff) : 3,
      rosterSize,
      peak: isPeak,
    });
  }

  if (isPeak) return PEAK_TARGETS;
  return settings.shift_targets_default || DEFAULT_TARGETS;
}

export const getDateKey = (date) => format(new Date(date), 'yyyy-MM-dd');

export const getAllDates = (startDate, endDate) =>
  eachDayOfInterval({ start: new Date(startDate), end: new Date(endDate) });

// ─── Override Ranking ────────────────────────────────────────

/**
 * Override-priority ranking — "who gets their schedule changed first
 * when all things are equal."
 *
 * Used to decide which managers are pulled in from a preferred day off
 * to cover a peak / high-demand day. The LEAST-burdened member ranks
 * first (changed first); the MOST-burdened member ranks last (most
 * likely to keep their preferred day off).
 *
 * Ordering (ascending position = changed first):
 *   1. fewest days worked so far     — load balancing
 *   2. shortest current consecutive streak — fatigue avoidance
 *   3. name A→Z                      — stable, deterministic tie-break
 *   4. id A→Z                        — final deterministic tie-break
 *
 * Pure & deterministic: identical input always yields identical order,
 * independent of the incoming array order.
 *
 * @param {Array}  members  members eligible to be reordered
 * @param {Object} stats    { [memberId]: { worked, consec } } as of "now"
 * @returns {Array} new array, sorted by override priority
 */
export function rankMembers(members, stats = {}) {
  const statOf = (id) => stats[id] || { worked: 0, consec: 0 };
  return [...(members || [])].sort((a, b) => {
    const sa = statOf(a.id);
    const sb = statOf(b.id);
    if ((sa.worked || 0) !== (sb.worked || 0)) return (sa.worked || 0) - (sb.worked || 0);
    if ((sa.consec || 0) !== (sb.consec || 0)) return (sa.consec || 0) - (sb.consec || 0);
    const na = String(a.name || '').toLowerCase();
    const nb = String(b.name || '').toLowerCase();
    if (na !== nb) return na < nb ? -1 : 1;
    const ia = String(a.id);
    const ib = String(b.id);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

// ─── Shared per-day resolution ───────────────────────────────

/**
 * Resolve who works (and on which shift) for a single date.
 *
 * Shared by BOTH generateSchedule (Supabase rows) and generateRotation
 * (legacy display map) so the persisted schedule and the on-screen
 * schedule can never diverge.
 *
 * `stats` reflects days BEFORE this date and is read-only here; the
 * caller is responsible for updating it after the day is resolved.
 *
 * Peak / high-demand behavior:
 *   - settings.smart_peak_override !== true  → legacy: FORCE all to work.
 *   - settings.smart_peak_override === true   → preserve preferred days
 *     off where coverage allows. Pull in only the deficit needed to hit
 *     the day's target, choosing the least-burdened members first
 *     (via rankMembers). The most-burdened keep their day off.
 *
 * @returns {{ assignments: Array<{member, shift}>, offMembers: Array }}
 */
export function resolveDayAssignments(members, date, dateStr, settings = {}, stats = {}, forecast = {}) {
  const rosterSize = (members || []).length;
  const targets = getTargets(dateStr, settings, forecast, rosterSize);
  const totalNeeded = SHIFTS.reduce((sum, s) => sum + (targets[s] || 0), 0);

  const isForcedDay =
    HARDCODED_PEAK_DAYS.has(dateStr) ||
    HARDCODED_HIGH_DEMAND.has(dateStr) ||
    (settings.peak_days || []).includes(dateStr) ||
    (settings.high_demand_days || []).includes(dateStr);

  // Optional: on peak / high-demand days, bring in the ENTIRE team
  // regardless of preferences ("all hands on deck"). Off by default.
  const forceAllPeak = settings.force_all_peak === true;

  // 1. Baseline — honor each member's preferred days off (no force).
  const available = [];
  const prefOff = [];
  (members || []).forEach((m) => {
    const offset = m.rotationOffset ?? m.rotation_offset ?? 0;
    if (isWorkDay(date, offset, dateStr, false)) {
      available.push(m);
    } else {
      prefOff.push(m);
    }
  });

  let working;
  let offMembers;

  if (isForcedDay && forceAllPeak) {
    // All-hands override: everyone works the forced day.
    working = [...(members || [])];
    offMembers = [];
  } else {
    // 2. Demand-driven sizing — staff each day to its target.
    //    Surplus  -> give the most-burdened available members the day off.
    //    Shortfall -> pull in the least-burdened off members to cover.
    //    Either way the LEAST-burdened work and the MOST-burdened rest, which
    //    keeps total days-worked balanced across the team over time. Preferred
    //    days off are kept unless coverage requires pulling someone in.
    working = [...available];
    offMembers = [...prefOff];

    if (working.length > totalNeeded) {
      const ranked = rankMembers(working, stats); // least-burdened first
      working = ranked.slice(0, totalNeeded);      // least-burdened keep working
      offMembers = offMembers.concat(ranked.slice(totalNeeded)); // most-burdened off
    } else if (working.length < totalNeeded && prefOff.length > 0) {
      const deficit = totalNeeded - working.length;
      const ranked = rankMembers(prefOff, stats);  // least-burdened first
      const pulled = ranked.slice(0, deficit);
      const pulledIds = new Set(pulled.map((m) => m.id));
      working = working.concat(pulled);
      offMembers = prefOff.filter((m) => !pulledIds.has(m.id));
    }
  }

  const assignments = assignShifts(working, targets);
  return { assignments, offMembers };
}

// ─── Main Generator ──────────────────────────────────────────

export function generateSchedule(members, startDate, endDate, settings = {}, forecast = {}) {
  if (!members || members.length === 0) return [];

  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const rows = [];

  // Running per-member stats power the override ranking. Seeded to 0 so
  // load-balancing is deterministic and fair from day one of the range.
  const stats = {};
  members.forEach((m) => { stats[m.id] = { worked: 0, consec: 0 }; });
  const bump = (id, didWork) => {
    const st = stats[id] || (stats[id] = { worked: 0, consec: 0 });
    if (didWork) { st.worked += 1; st.consec += 1; }
    else { st.consec = 0; }
  };

  days.forEach((date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const { assignments, offMembers } = resolveDayAssignments(members, date, dateStr, settings, stats, forecast);

    assignments.forEach(({ member, shift }) => {
      rows.push({
        member_id: member.id,
        schedule_date: dateStr,
        shift,
        is_override: false,
      });
      bump(member.id, true);
    });

    offMembers.forEach((m) => {
      rows.push({
        member_id: m.id,
        schedule_date: dateStr,
        shift: 'OFF',
        is_override: false,
      });
      bump(m.id, false);
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

  // Rebalance pass — soft anchors. If a shift is still under target while
  // another is over target, move someone to cover the gap. Prefer moving a
  // non-anchored member; only move an anchored member as a last resort.
  // Guarantees per-shift targets are met whenever enough people are working,
  // so a heavily-anchored roster can't leave a shift uncovered.
  const countOf = (s) => assigned.filter((a) => a.shift === s).length;
  const isAnchored = (a) => {
    const anc = a.member.shiftAnchor || a.member.shift_anchor;
    return anc && SHIFTS.includes(anc);
  };
  let guard = assigned.length * SHIFTS.length + 1;
  while (guard-- > 0) {
    const under = SHIFTS.find((s) => countOf(s) < (targets[s] || 0));
    if (!under) break;
    const over = SHIFTS.find((s) => countOf(s) > (targets[s] || 0));
    if (!over) break; // not enough people overall — best effort
    // Prefer a flexible member on the over-staffed shift; else move anchored.
    let idx = assigned.findIndex((a) => a.shift === over && !isAnchored(a));
    if (idx === -1) idx = assigned.findIndex((a) => a.shift === over);
    if (idx === -1) break;
    assigned[idx].shift = under;
  }

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
    // 4th positional arg is settings in the old signature
    const opts = (forecast && typeof forecast === 'object') ? forecast : {};
    const rosterSize = members.length;

    const result = {};
    Object.keys(schedule).forEach((dk) => {
      const ds = schedule[dk] || {};
      const counts = { A: 0, B: 0, C: 0, OFF: 0 };
      members.forEach((m) => {
        const shift = ds[m.id] || 'OFF';
        counts[shift] = (counts[shift] || 0) + 1;
      });
      const totalWorking = counts.A + counts.B + counts.C;
      const isPeak = HARDCODED_PEAK_DAYS.has(dk) || (opts.peak_days || []).includes(dk);
      const isHighDemand = HARDCODED_HIGH_DEMAND.has(dk) || (opts.high_demand_days || []).includes(dk);
      // Use the SAME target the generator used (forecast-driven when enabled),
      // so light forecast days don't show false gaps.
      const target = getTargets(dk, opts, forecastData, rosterSize);
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

export const generateRotation = (members, startDate, endDate, overrides = {}, settings = {}, forecast = {}) => {
  const days = getAllDates(startDate, endDate);
  const result = {};

  // Mirror generateSchedule's running stats so the displayed schedule
  // makes the SAME override-ranking decisions as the persisted one.
  const stats = {};
  (members || []).forEach((m) => { stats[m.id] = { worked: 0, consec: 0 }; });
  const bump = (id, didWork) => {
    const st = stats[id] || (stats[id] = { worked: 0, consec: 0 });
    if (didWork) { st.worked += 1; st.consec += 1; }
    else { st.consec = 0; }
  };

  days.forEach((date) => {
    const dk = getDateKey(date);
    const { assignments, offMembers } = resolveDayAssignments(members, date, dk, settings, stats, forecast);
    result[dk] = {};

    assignments.forEach(({ member, shift }) => {
      result[dk][member.id] = overrides[dk]?.[member.id] || shift;
      bump(member.id, true);
    });
    offMembers.forEach((m) => {
      result[dk][m.id] = overrides[dk]?.[m.id] || 'OFF';
      bump(m.id, false);
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
    const pad2 = (n) => String(n).padStart(2, '0');

    if (dateRaw instanceof Date && !isNaN(dateRaw)) {
      // Real Date object (from XLSX read with cellDates:true). SheetJS stores
      // dates at UTC midnight, so read UTC parts to avoid a local-timezone
      // off-by-one (e.g. Eastern time rolling 06-05 back to 06-04).
      dk = `${dateRaw.getUTCFullYear()}-${pad2(dateRaw.getUTCMonth() + 1)}-${pad2(dateRaw.getUTCDate())}`;
    } else {
      const dateStr = String(dateRaw).trim();

      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        // Already YYYY-MM-DD (e.g. CSV) — use directly (avoids timezone shift)
        dk = dateStr;
      } else if (/^\d+(\.\d+)?$/.test(dateStr)) {
        // Bare number = Excel serial date (e.g. 46178 = 2026-06-05). Without
        // this branch, String(46178) was parsed as the YEAR 46178. Convert
        // via the Unix epoch in UTC to stay timezone-safe.
        const serial = parseFloat(dateStr);
        const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
        if (isNaN(d)) return;
        dk = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
      } else {
        // Natural-language date like "Thursday, January 1, 2026"
        const parsed = new Date(dateStr);
        if (isNaN(parsed)) return;
        dk = getDateKey(parsed);
      }
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
