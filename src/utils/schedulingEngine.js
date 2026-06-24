// src/utils/schedulingEngine.js
// ─────────────────────────────────────────────────────────────
// APS Scheduler — Call Center Rotation Engine v5 (demand-aware, 5-day week)
//
// Model:
//   • Every manager works exactly 5 days / 2 days off per Mon→Sun week
//     (preferred pair honored; no-preference managers auto-staggered).
//   • Daily required staff is derived from forecast True Demand and split
//     across shifts by the hourly call curve, floored at >=1 per shift.
//   • On high/peak days the engine may pull an off-member to a 6th day to
//     help cover — never a 7th in the week, never >7 consecutive days.
//   • Days are flagged by variance to staffing: light / normal / high / peak.
// ─────────────────────────────────────────────────────────────
import { eachDayOfInterval, format, getDay, startOfWeek } from 'date-fns';

// ─── Constants ───────────────────────────────────────────────

const SHIFTS = ['A', 'B', 'C'];
const DEFAULT_TARGETS = { A: 7, B: 2, C: 1 }; // fallback when no forecast for a day

// Default intraday split (from APS hourly curve: A 56% / B 26% / C 18%).
// Overridden at runtime by settings.shift_weights derived from the hourly file.
const DEFAULT_SHIFT_WEIGHTS = { A: 0.563, B: 0.258, C: 0.180 };

const CALLS_PER_MANAGER_DAY = 50; // one manager's calls per 8h shift (≈ AHT/util)
const MIN_PER_SHIFT = 1;          // floor: no shift left empty
const LIGHT_MARGIN = 3;           // surplus >= this ⇒ "light" (shift to projects)
const MAX_WEEK_DAYS = 6;          // never a 7th working day in a Mon→Sun week
const MAX_CONSEC = 7;             // never more than 7 consecutive working days

// Preferred days-off pairs (integers 10–16 mirror App.js DAYS_OFF_PAIRS)
const PREF_DAYS_OFF = {
  10: [0, 1], // Sun / Mon
  11: [1, 2], // Mon / Tue
  12: [2, 3], // Tue / Wed
  13: [3, 4], // Wed / Thu
  14: [4, 5], // Thu / Fri
  15: [5, 6], // Fri / Sat
  16: [6, 0], // Sat / Sun
};
const AUTO_PAIR_VALUES = [10, 11, 12, 13, 14, 15, 16];

// ─── Exported constants (used by App.js) ─────────────────────

export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEK_STARTS_ON = 1; // Monday

// Peak/high days are now derived per-day from variance, not hardcoded.
// Kept as empty objects so existing imports don't break.
export const PEAK_DAYS = {};
export const HIGH_DEMAND_DAYS = {};

// ─── Small helpers ───────────────────────────────────────────

export const getDateKey = (date) => format(new Date(date), 'yyyy-MM-dd');
export const getAllDates = (startDate, endDate) =>
  eachDayOfInterval({ start: new Date(startDate), end: new Date(endDate) });

const pad2 = (n) => String(n).padStart(2, '0');
const weekKeyOf = (date) =>
  format(startOfWeek(new Date(date), { weekStartsOn: WEEK_STARTS_ON }), 'yyyy-MM-dd');

// Each member's two days off (day-of-week ints). Preferred pair if set,
// otherwise an auto-assigned staggered pair based on roster position.
function memberDaysOff(member, index) {
  const off = Number(member.rotationOffset ?? member.rotation_offset);
  if (PREF_DAYS_OFF[off]) return PREF_DAYS_OFF[off];
  const val = AUTO_PAIR_VALUES[(index || 0) % AUTO_PAIR_VALUES.length];
  return PREF_DAYS_OFF[val];
}

// ─── Demand → required staffing ──────────────────────────────

function shiftWeights(settings = {}) {
  const w = settings.shift_weights;
  if (w && typeof w === 'object' && (w.A || w.B || w.C)) {
    const tot = (w.A || 0) + (w.B || 0) + (w.C || 0);
    if (tot > 0) return { A: w.A / tot, B: w.B / tot, C: w.C / tot };
  }
  return DEFAULT_SHIFT_WEIGHTS;
}

function splitTotal(total, settings) {
  const w = shiftWeights(settings);
  const minPer = settings.min_per_shift != null ? Number(settings.min_per_shift) : MIN_PER_SHIFT;
  let A = Math.max(minPer, Math.round(total * w.A));
  let C = Math.max(minPer, Math.round(total * w.C));
  let B = Math.max(minPer, total - A - C);
  return { A, B, C };
}

/**
 * Required staffing for a day. Prefers explicit columns from the forecast
 * file (per-shift, or a total), else derives from True Demand.
 * Returns { A, B, C, total, demand }. NOT capped at roster — the raw need,
 * so peak days can be flagged when they exceed the whole team.
 */
function requiredForDay(fc, settings = {}) {
  const minPer = settings.min_per_shift != null ? Number(settings.min_per_shift) : MIN_PER_SHIFT;
  const cpd = Number(settings.calls_per_manager_day) || CALLS_PER_MANAGER_DAY;

  if (fc && fc.required && (fc.required.A != null || fc.required.B != null || fc.required.C != null)) {
    const A = Math.max(minPer, Number(fc.required.A) || 0);
    const B = Math.max(minPer, Number(fc.required.B) || 0);
    const C = Math.max(minPer, Number(fc.required.C) || 0);
    return { A, B, C, total: A + B + C, demand: fc.demand ?? fc.agent_calls ?? null };
  }

  const demand = fc != null
    ? (fc.demand ?? fc.agent_calls ?? fc.agentCalls ?? fc.totalCalls ?? fc.total_calls)
    : null;

  let total;
  if (fc && fc.required_total != null) {
    total = Math.max(SHIFTS.length * minPer, Math.round(Number(fc.required_total)));
  } else if (demand != null) {
    total = Math.max(SHIFTS.length * minPer, Math.ceil((Number(demand) || 0) / cpd));
  } else {
    // No forecast for this day → fixed fallback target.
    const t = settings.shift_targets_default || DEFAULT_TARGETS;
    return { A: t.A, B: t.B, C: t.C, total: t.A + t.B + t.C, demand: null };
  }

  const split = splitTotal(total, settings);
  return { ...split, total: split.A + split.B + split.C, demand: demand != null ? Number(demand) : null };
}

/** Classify a day by variance between required need and scheduled coverage. */
export function classifyDay(requiredTotal, scheduledWorking, rosterSize) {
  if (requiredTotal > rosterSize) return 'peak';
  if (requiredTotal > scheduledWorking) return 'high';
  if (scheduledWorking - requiredTotal >= LIGHT_MARGIN) return 'light';
  return 'normal';
}

// ─── Override ranking (fairness) ─────────────────────────────

/**
 * "Who gets pulled in / changed first when all things are equal."
 * Least-burdened first: fewest days worked, then shortest streak, then
 * name, then id (deterministic regardless of input order).
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
    const ia = String(a.id), ib = String(b.id);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

// ─── Per-shift assignment (soft anchors) ─────────────────────

function assignShifts(workingMembers, targets, minPer = 1) {
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
  SHIFTS.forEach((s) => { for (let i = 0; i < (remaining[s] || 0); i++) fillQueue.push(s); });
  unanchored.forEach((m, i) => { assigned.push({ member: m, shift: fillQueue[i] || 'A' }); });

  const countOf = (s) => assigned.filter((a) => a.shift === s).length;
  const isAnchored = (a) => {
    const anc = a.member.shiftAnchor || a.member.shift_anchor;
    return anc && SHIFTS.includes(anc);
  };
  const moveOne = (from, to) => {
    let idx = assigned.findIndex((a) => a.shift === from && !isAnchored(a));
    if (idx === -1) idx = assigned.findIndex((a) => a.shift === from);
    if (idx === -1) return false;
    assigned[idx].shift = to;
    return true;
  };

  // Rebalance toward targets: cover an under-target shift from an over-target one.
  let guard = assigned.length * SHIFTS.length + 1;
  while (guard-- > 0) {
    const under = SHIFTS.find((s) => countOf(s) < (targets[s] || 0));
    if (!under) break;
    const over = SHIFTS.find((s) => countOf(s) > (targets[s] || 0));
    if (!over) break;
    if (!moveOne(over, under)) break;
  }

  // Floor pass: guarantee >= minPer on every shift when enough people exist,
  // even if the day is understaffed vs target (so no shift is ever empty).
  if (assigned.length >= SHIFTS.length * minPer) {
    guard = assigned.length * SHIFTS.length + 1;
    while (guard-- > 0) {
      const under = SHIFTS.find((s) => countOf(s) < minPer);
      if (!under) break;
      const donor = SHIFTS
        .filter((s) => countOf(s) > minPer)
        .sort((x, y) => countOf(y) - countOf(x))[0];
      if (!donor || !moveOne(donor, under)) break;
    }
  }

  return assigned;
}

// ─── Shared per-day resolution ───────────────────────────────

/**
 * Resolve who works (and which shift) for one date under the 5-day model.
 * `stats[id]` carries { worked, consec, weekWorked, weekKey } as of days
 * BEFORE this date (read-only; caller updates after).
 */
export function resolveDayAssignments(members, date, dateStr, settings = {}, stats = {}, forecast = {}) {
  const roster = members || [];
  const rosterSize = roster.length;
  const dow = getDay(date);

  // Baseline 5-day week: off iff today is one of the member's two days off.
  const workingBase = [];
  const offBase = [];
  roster.forEach((m, i) => {
    const [d1, d2] = memberDaysOff(m, i);
    if (dow === d1 || dow === d2) offBase.push(m);
    else workingBase.push(m);
  });

  const fc = forecast ? forecast[dateStr] : null;
  const req = requiredForDay(fc, settings);
  const requiredTotal = req.A + req.B + req.C;

  let working = [...workingBase];
  let offMembers = [...offBase];

  // High/peak: pull eligible off-members to a 6th day to help cover.
  if (requiredTotal > working.length && offMembers.length > 0) {
    const eligible = offMembers.filter((m) => {
      const st = stats[m.id] || {};
      return (st.weekWorked || 0) < MAX_WEEK_DAYS && (st.consec || 0) < MAX_CONSEC;
    });
    const need = requiredTotal - working.length;
    const pulled = rankMembers(eligible, stats).slice(0, need);
    const ids = new Set(pulled.map((m) => m.id));
    working = working.concat(pulled);
    offMembers = offMembers.filter((m) => !ids.has(m.id));
  }

  const minPer = settings.min_per_shift != null ? Number(settings.min_per_shift) : MIN_PER_SHIFT;
  const assignments = assignShifts(working, req, minPer);
  return { assignments, offMembers, required: req };
}

// ─── Generators ──────────────────────────────────────────────

function makeStats(members) {
  const stats = {};
  (members || []).forEach((m) => {
    stats[m.id] = { worked: 0, consec: 0, weekWorked: 0, weekKey: null };
  });
  return stats;
}

// Roll weekWorked over when a member crosses into a new Mon→Sun week.
function rollWeek(stats, members, wk) {
  (members || []).forEach((m) => {
    const st = stats[m.id] || (stats[m.id] = { worked: 0, consec: 0, weekWorked: 0, weekKey: null });
    if (st.weekKey !== wk) { st.weekKey = wk; st.weekWorked = 0; }
  });
}

function bump(stats, id, didWork) {
  const st = stats[id] || (stats[id] = { worked: 0, consec: 0, weekWorked: 0, weekKey: null });
  if (didWork) { st.worked += 1; st.consec += 1; st.weekWorked += 1; }
  else { st.consec = 0; }
}

export function generateSchedule(members, startDate, endDate, settings = {}, forecast = {}) {
  if (!members || members.length === 0) return [];
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const rows = [];
  const stats = makeStats(members);

  days.forEach((date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    rollWeek(stats, members, weekKeyOf(date));
    const { assignments, offMembers } = resolveDayAssignments(members, date, dateStr, settings, stats, forecast);

    assignments.forEach(({ member, shift }) => {
      rows.push({ member_id: member.id, schedule_date: dateStr, shift, is_override: false });
      bump(stats, member.id, true);
    });
    offMembers.forEach((m) => {
      rows.push({ member_id: m.id, schedule_date: dateStr, shift: 'OFF', is_override: false });
      bump(stats, m.id, false);
    });
  });
  return rows;
}

export const generateRotation = (members, startDate, endDate, overrides = {}, settings = {}, forecast = {}) => {
  const days = getAllDates(startDate, endDate);
  const result = {};
  const stats = makeStats(members);

  days.forEach((date) => {
    const dk = getDateKey(date);
    rollWeek(stats, members, weekKeyOf(date));
    const { assignments, offMembers } = resolveDayAssignments(members, date, dk, settings, stats, forecast);
    result[dk] = {};
    assignments.forEach(({ member, shift }) => {
      result[dk][member.id] = overrides[dk]?.[member.id] || shift;
      bump(stats, member.id, true);
    });
    offMembers.forEach((m) => {
      result[dk][m.id] = overrides[dk]?.[m.id] || 'OFF';
      bump(stats, m.id, false);
    });
  });
  return result;
};

export const getManagerSummary = (schedule, members) =>
  members.map((m) => {
    const counts = { A: 0, B: 0, C: 0, OFF: 0 };
    Object.values(schedule).forEach((day) => {
      const shift = day[m.id] || 'OFF';
      counts[shift] = (counts[shift] || 0) + 1;
    });
    return {
      id: m.id, name: m.name,
      A: counts.A, B: counts.B, C: counts.C, OFF: counts.OFF,
      total: counts.A + counts.B + counts.C,
    };
  });

// ─── Coverage analysis (variance flags) ──────────────────────

/**
 * Old signature (used by App.js): analyzeCoverage(scheduleMap, members, forecast, settings)
 * Returns per-day: counts, totalWorking, target (=required), gaps, meetsTarget,
 * forecastCalls, flag ('peak'|'high'|'light'|'normal'), isPeak, isHighDemand,
 * isLight, surplus, shortfall.
 */
export function analyzeCoverage(scheduleOrDateStr, membersOrIds, forecastOrSchedule, forecast, settings = {}) {
  if (typeof scheduleOrDateStr === 'object' && !Array.isArray(scheduleOrDateStr) && !(scheduleOrDateStr instanceof String)) {
    const schedule = scheduleOrDateStr;
    const members = membersOrIds;
    const forecastData = forecastOrSchedule || {};
    const opts = (forecast && typeof forecast === 'object') ? forecast : {};
    const rosterSize = members.length;

    const result = {};
    Object.keys(schedule).forEach((dk) => {
      const ds = schedule[dk] || {};
      const counts = { A: 0, B: 0, C: 0, OFF: 0 };
      members.forEach((m) => { const s = ds[m.id] || 'OFF'; counts[s] = (counts[s] || 0) + 1; });
      const totalWorking = counts.A + counts.B + counts.C;

      const req = requiredForDay(forecastData[dk], opts);
      const requiredTotal = req.A + req.B + req.C;
      const flag = classifyDay(requiredTotal, totalWorking, rosterSize);
      const gaps = { A: counts.A - req.A, B: counts.B - req.B, C: counts.C - req.C };
      const meetsTarget = gaps.A >= 0 && gaps.B >= 0 && gaps.C >= 0;
      const fc = forecastData[dk];

      result[dk] = {
        counts, totalWorking,
        target: { A: req.A, B: req.B, C: req.C },
        required: req,
        requiredTotal,
        gaps, meetsTarget,
        flag,
        isPeak: flag === 'peak',
        isHighDemand: flag === 'high',
        isLight: flag === 'light',
        surplus: Math.max(0, totalWorking - requiredTotal),
        shortfall: Math.max(0, requiredTotal - totalWorking),
        forecastCalls: fc ? (fc.agent_calls ?? fc.demand ?? fc.totalCalls ?? fc.total_calls ?? null) : null,
      };
    });
    return result;
  }

  // New signature: analyzeCoverage(dateStr, memberIds, ccSchedule, forecast, settings)
  const dateStr = scheduleOrDateStr;
  const memberIds = membersOrIds;
  const ccSchedule = forecastOrSchedule;
  const daySchedule = ccSchedule[dateStr] || {};
  const shiftCounts = { A: 0, B: 0, C: 0, OFF: 0 };
  memberIds.forEach((id) => {
    const entry = daySchedule[id];
    const shift = entry?.shift || 'OFF';
    shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;
  });
  const req = requiredForDay(forecast ? forecast[dateStr] : null, settings);
  const requiredTotal = req.A + req.B + req.C;
  const onCount = shiftCounts.A + shiftCounts.B + shiftCounts.C;
  const flag = classifyDay(requiredTotal, onCount, memberIds.length);
  const gaps = [];
  SHIFTS.forEach((s) => { if ((shiftCounts[s] || 0) < (req[s] || 0)) gaps.push({ shift: s, need: req[s] - shiftCounts[s] }); });
  return {
    shiftCounts, onCount, offCount: shiftCounts.OFF,
    required: req, flag,
    isPeak: flag === 'peak', isHighDemand: flag === 'high', isLight: flag === 'light',
    gaps, hasGaps: gaps.length > 0,
  };
}

// ─── Hourly curve → per-shift weights ────────────────────────

function hourOf(h) {
  if (h == null || h === '') return null;
  if (h instanceof Date) return h.getHours();
  if (typeof h === 'number') return Math.floor(h < 1 ? h * 24 + 1e-6 : h);
  const s = String(h);
  const m = s.match(/(\d{1,2}):/);
  if (m) return parseInt(m[1], 10);
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return Math.floor(n < 1 ? n * 24 + 1e-6 : n);
}

/**
 * Derive {A,B,C} shift weights from an hourly distribution
 * ([{hour, callsPerDay}]). Each hour's calls are split equally across the
 * shifts whose window covers it (A 8–16, B 12–20, C 14–22).
 */
export function deriveShiftWeights(hourlyData) {
  const A = new Set([8, 9, 10, 11, 12, 13, 14, 15]);
  const B = new Set([12, 13, 14, 15, 16, 17, 18, 19]);
  const C = new Set([14, 15, 16, 17, 18, 19, 20, 21]);
  let wA = 0, wB = 0, wC = 0;
  (hourlyData || []).forEach((r) => {
    const h = hourOf(r.hour);
    const calls = Number(r.callsPerDay) || 0;
    if (h == null || calls <= 0) return;
    const active = [];
    if (A.has(h)) active.push('A');
    if (B.has(h)) active.push('B');
    if (C.has(h)) active.push('C');
    if (!active.length) return;
    const share = calls / active.length;
    active.forEach((s) => { if (s === 'A') wA += share; else if (s === 'B') wB += share; else wC += share; });
  });
  const tot = wA + wB + wC;
  if (tot <= 0) return null;
  return { A: wA / tot, B: wB / tot, C: wC / tot };
}

// ─── Parsers ─────────────────────────────────────────────────

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function resolveDateKey(dateRaw) {
  if (dateRaw == null || dateRaw === '') return null;
  if (dateRaw instanceof Date && !isNaN(dateRaw)) {
    return `${dateRaw.getUTCFullYear()}-${pad2(dateRaw.getUTCMonth() + 1)}-${pad2(dateRaw.getUTCDate())}`;
  }
  const s = String(dateRaw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d+(\.\d+)?$/.test(s)) { // Excel serial
    const d = new Date(Math.round((parseFloat(s) - 25569) * 86400 * 1000));
    if (isNaN(d)) return null;
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  // Strip emoji / symbols / flag markers (e.g. "🔴 Jul 1" → "Jul 1")
  const cleaned = s.replace(/[^\w\s,/:.-]/g, '').trim();
  // "Jun 1" / "Jun 1, 2026" / "June 1" — infer year if absent
  const m = cleaned.match(/([A-Za-z]{3,})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo == null) return null;
    const day = parseInt(m[2], 10);
    let year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
    if (!m[3]) {
      const cand = new Date(year, mo, day);
      // if it's far in the past, assume the next occurrence
      if ((new Date() - cand) > 1000 * 60 * 60 * 24 * 200) year += 1;
    }
    return `${year}-${pad2(mo + 1)}-${pad2(day)}`;
  }
  const parsed = new Date(cleaned);
  if (isNaN(parsed)) return null;
  return getDateKey(parsed);
}

const toNum = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? null : n;
};

/**
 * Tolerant forecast parser. Matches columns by normalized name so the file
 * layout can shift. Reads True Demand (preferred) or presented calls, plus
 * optional explicit required-staff columns. Returns { dk: {...} }.
 */
export const parseForecastFile = (data) => {
  const result = {};
  const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
  (data || []).forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const nk = {};
    Object.keys(row).forEach((k) => { nk[norm(k)] = row[k]; });
    const get = (...cands) => {
      for (const c of cands) if (nk[c] != null && nk[c] !== '') return nk[c];
      return undefined;
    };
    const dk = resolveDateKey(get('date', 'day', 'startedatday'));
    if (!dk) return;

    const demand = toNum(get(
      'ivrselectedtruedemand', 'truedemand', 'ivrselected',
      'trueagentcalls', 'agentcalls', 'demand'
    ));
    const presented = toNum(get('presented', 'rawinboundcalls', 'totalcalls', 'count', 'inboundcalls'));
    const reqTotal = toNum(get('reqstaff', 'requiredstaff', 'reqtotal', 'requiredtotal'));
    const reqA = toNum(get('reqa', 'requireda', 'reqashift'));
    const reqB = toNum(get('reqb', 'requiredb', 'reqbshift'));
    const reqC = toNum(get('reqc', 'requiredc', 'reqcshift'));

    const agent = demand != null ? demand : (presented != null ? presented : 0);
    const rec = {
      total_calls: presented != null ? presented : agent,
      totalCalls: presented != null ? presented : agent,
      agent_calls: agent,
      demand: agent,
    };
    if (reqTotal != null) rec.required_total = reqTotal;
    if (reqA != null || reqB != null || reqC != null) {
      rec.required = { A: reqA || 0, B: reqB || 0, C: reqC || 0 };
    }
    result[dk] = rec;
  });
  return result;
};

export const parseHourlyFile = (data) =>
  (data || []).map((row) => ({
    hour: row.hour ?? row.Hour ?? row.TIME ?? row['Started At: Hour of day'] ?? '',
    callsPerDay: parseFloat(
      row.callsPerDay || row['Calls Per Day'] || row['Calls per Day'] ||
      row.calls || row.Count || 0
    ),
  })).filter((r) => r.callsPerDay > 0);

export default generateSchedule;
