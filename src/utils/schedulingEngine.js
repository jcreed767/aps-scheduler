import { addDays, format, parseISO, getDay } from 'date-fns';

// ─── Constants ───────────────────────────────────────────────────────────────

export const SHIFTS = {
  A: { id: 'A', label: 'Shift A', hours: '8am–4pm', start: 8, end: 16, color: '#3B82F6' },
  B: { id: 'B', label: 'Shift B', hours: '12pm–8pm', start: 12, end: 20, color: '#8B5CF6' },
  C: { id: 'C', label: 'Shift C', hours: '2pm–10pm', start: 14, end: 22, color: '#F59E0B' },
  OFF: { id: 'OFF', label: 'Off', hours: null, color: '#E5E7EB' },
};

export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Peak days with special rules
export const PEAK_DAYS = {
  '2026-07-01': { label: 'DOM1 Peak', split: { A: 9, B: 0, C: 1 }, forecastCalls: 750 },
  '2026-07-31': { label: 'Month-End Peak', split: { A: 9, B: 0, C: 1 }, forecastCalls: 672 },
};

// High-demand dates (need max coverage but standard split)
export const HIGH_DEMAND_DAYS = {
  '2026-06-29': { forecastCalls: 404 },
  '2026-06-30': { forecastCalls: 454 },
  '2026-07-06': { forecastCalls: 412 },
  '2026-07-20': { forecastCalls: 404 },
  '2026-07-27': { forecastCalls: 408 },
  '2026-07-28': { forecastCalls: 415 },
  '2026-07-30': { forecastCalls: 419 },
};

// Default shift targets by day type
export const DEFAULT_TARGETS = {
  weekday: { A: 7, B: 2, C: 1 },
  saturday: { A: 7, B: 2, C: 1 },
  sunday: { A: 7, B: 2, C: 1 },
};

// Staffing model parameters
export const STAFFING_PARAMS = {
  aht: 6.61,
  serviceLevelTarget: 0.80,
  serviceLevelSeconds: 20,
  shrinkage: 0.18,
  adherence: 0.85,
  effectiveSimultaneous: 6.97,
};

// ─── Date Helpers ─────────────────────────────────────────────────────────────

export function getDayType(date) {
  const dow = getDay(date); // 0=Sun, 1=Mon, ..., 6=Sat
  if (dow === 0) return 'sunday';
  if (dow === 6) return 'saturday';
  return 'weekday';
}

export function getDateKey(date) {
  return format(date, 'yyyy-MM-dd');
}

export function getAllDates(startDate, endDate) {
  const dates = [];
  let current = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  const end = typeof endDate === 'string' ? parseISO(endDate) : endDate;
  while (current <= end) {
    dates.push(new Date(current));
    current = addDays(current, 1);
  }
  return dates;
}

// ─── Target Calculator ────────────────────────────────────────────────────────

export function getTargetSplit(dateKey) {
  if (PEAK_DAYS[dateKey]) return PEAK_DAYS[dateKey].split;
  const date = parseISO(dateKey);
  const dayType = getDayType(date);
  return DEFAULT_TARGETS[dayType];
}

export function getForecastCalls(dateKey, forecastData) {
  if (PEAK_DAYS[dateKey]) return PEAK_DAYS[dateKey].forecastCalls;
  if (HIGH_DEMAND_DAYS[dateKey]) return HIGH_DEMAND_DAYS[dateKey].forecastCalls;
  if (forecastData && forecastData[dateKey]) return forecastData[dateKey];
  return null;
}

// ─── Rotation Engine ─────────────────────────────────────────────────────────

/**
 * Generates a 5-on/2-off rotation for N managers over a date range.
 * Optimizes for smooth daily coverage (target: 10 available/day).
 */
export function generateRotation(managers, startDate, endDate, existingSchedule = {}) {
  const dates = getAllDates(startDate, endDate);
  const numManagers = managers.length;

  // Build initial rotation pattern
  // With 14 managers on 5/2, we stagger start offsets to maximize daily coverage
  // Cycle length = 7 days, 14 managers → 2 managers per offset slot
  const cycleLength = 7;
  const workDays = 5;

  // Assign each manager a rotation offset (0–6)
  // 14 managers / 7 slots = 2 per slot
  const managerOffsets = {};
  managers.forEach((m, i) => {
    // Check if manager has an existing offset preference
    if (m.rotationOffset !== undefined) {
      managerOffsets[m.id] = m.rotationOffset;
    } else {
      managerOffsets[m.id] = Math.floor(i * cycleLength / numManagers);
    }
  });

  // Generate base working pattern for each manager
  const schedule = {};

  dates.forEach((date, dayIndex) => {
    const dateKey = getDateKey(date);
    schedule[dateKey] = {};

    managers.forEach(manager => {
      // Check for existing/manual override
      if (existingSchedule[dateKey] && existingSchedule[dateKey][manager.id] !== undefined) {
        schedule[dateKey][manager.id] = existingSchedule[dateKey][manager.id];
        return;
      }

      // Check availability constraints
      if (manager.unavailable && manager.unavailable.includes(dateKey)) {
        schedule[dateKey][manager.id] = 'OFF';
        return;
      }

      const offset = managerOffsets[manager.id];
      const adjustedDay = (dayIndex + offset) % cycleLength;
      const isWorking = adjustedDay < workDays;
      schedule[dateKey][manager.id] = isWorking ? 'UNASSIGNED' : 'OFF';
    });
  });

  // Assign shifts to working managers
  dates.forEach((date) => {
    const dateKey = getDateKey(date);
    const target = getTargetSplit(dateKey);
    const daySchedule = schedule[dateKey];

    // Get working managers for this day
    const working = managers.filter(m => daySchedule[m.id] === 'UNASSIGNED');

    // Sort: shift anchors first, then by shift preference, then by manager index
    const sorted = [...working].sort((a, b) => {
      const aAnchor = a.shiftAnchor ? ['A', 'B', 'C'].indexOf(a.shiftAnchor) : 99;
      const bAnchor = b.shiftAnchor ? ['A', 'B', 'C'].indexOf(b.shiftAnchor) : 99;
      return aAnchor - bAnchor;
    });

    let countA = 0, countB = 0, countC = 0;

    sorted.forEach(manager => {
      // Assign shift anchors first
      if (manager.shiftAnchor && countA + countB + countC < working.length) {
        const anchor = manager.shiftAnchor;
        const limit = target[anchor];
        if (anchor === 'A' && countA < limit) {
          daySchedule[manager.id] = 'A';
          countA++;
          return;
        }
        if (anchor === 'B' && countB < limit) {
          daySchedule[manager.id] = 'B';
          countB++;
          return;
        }
        if (anchor === 'C' && countC < limit) {
          daySchedule[manager.id] = 'C';
          countC++;
          return;
        }
      }

      // Fill targets in order: C first (min 1), then A, then B
      if (countC < target.C) {
        daySchedule[manager.id] = 'C';
        countC++;
      } else if (countA < target.A) {
        daySchedule[manager.id] = 'A';
        countA++;
      } else if (countB < target.B) {
        daySchedule[manager.id] = 'B';
        countB++;
      } else {
        daySchedule[manager.id] = 'A'; // overflow to A
        countA++;
      }
    });
  });

  return schedule;
}

// ─── Coverage Analysis ────────────────────────────────────────────────────────

export function analyzeCoverage(schedule, managers, forecastData = {}) {
  const analysis = {};

  Object.entries(schedule).forEach(([dateKey, daySchedule]) => {
    const target = getTargetSplit(dateKey);
    const counts = { A: 0, B: 0, C: 0, OFF: 0, UNASSIGNED: 0 };

    managers.forEach(m => {
      const shift = daySchedule[m.id];
      if (shift && counts[shift] !== undefined) counts[shift]++;
    });

    const totalWorking = counts.A + counts.B + counts.C;
    const gaps = {
      A: counts.A - target.A,
      B: counts.B - target.B,
      C: counts.C - target.C,
    };

    const isPeak = !!PEAK_DAYS[dateKey];
    const isHighDemand = !!HIGH_DEMAND_DAYS[dateKey];
    const meetsTarget = gaps.A >= 0 && gaps.B >= 0 && gaps.C >= 0;
    const forecastCalls = getForecastCalls(dateKey, forecastData);

    analysis[dateKey] = {
      counts,
      target,
      gaps,
      totalWorking,
      meetsTarget,
      isPeak,
      isHighDemand,
      forecastCalls,
    };
  });

  return analysis;
}

// ─── Manager Summary ──────────────────────────────────────────────────────────

export function getManagerSummary(schedule, managers) {
  return managers.map(manager => {
    const summary = { id: manager.id, name: manager.name, A: 0, B: 0, C: 0, OFF: 0, total: 0 };

    Object.values(schedule).forEach(daySchedule => {
      const shift = daySchedule[manager.id];
      if (shift === 'A') { summary.A++; summary.total++; }
      else if (shift === 'B') { summary.B++; summary.total++; }
      else if (shift === 'C') { summary.C++; summary.total++; }
      else if (shift === 'OFF') summary.OFF++;
    });

    return summary;
  });
}

// ─── Forecast Parser ─────────────────────────────────────────────────────────

export function parseForecastFile(data) {
  // Expects rows with date string + count
  const forecast = {};
  data.forEach(row => {
    const dateStr = row['Started At: Day'] || row['date'] || row['Date'];
    const count = row['Count'] || row['count'] || row['Calls'];
    if (!dateStr || !count) return;

    // Parse "Wednesday, June 3, 2026" style
    try {
      const parsed = new Date(dateStr.replace(/^[A-Za-z]+,\s*/, ''));
      if (!isNaN(parsed)) {
        const key = format(parsed, 'yyyy-MM-dd');
        forecast[key] = Number(count);
      }
    } catch (e) {
      // skip unparseable rows
    }
  });
  return forecast;
}

export function parseHourlyFile(data) {
  // Returns array of { hour, count, percentage }
  return data
    .filter(row => row['Started At: Hour of day'] && row['Count'])
    .map(row => ({
      hour: row['Started At: Hour of day'],
      count: Number(row['Count']),
      percentage: Number(row['Unnamed: 3'] || 0),
      callsPerDay: Number(row['Calls per Day'] || 0),
    }));
}
