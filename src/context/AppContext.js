// src/context/AppContext.js
// ─────────────────────────────────────────────────────────────
// APS Scheduler — Global State Context
//
// Provides all persistent data to the component tree:
//   - Team members (all 4 teams)
//   - Call center schedule (generated + overrides)
//   - Manual schedules (sales, collections, districts)
//   - Forecast data
//   - Spotlight
//   - App settings
//
// Real-time subscriptions keep all connected clients in sync.
// ─────────────────────────────────────────────────────────────
import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
  useRef,
} from 'react';
import { startOfMonth, endOfMonth, addMonths, format } from 'date-fns';
import { supabase } from '../lib/supabase';
import * as db from '../lib/db';
import { generateSchedule } from '../utils/schedulingEngine';

// ─── Initial state ────────────────────────────────────────────

const initialState = {
  // Loading flags
  loading: {
    members: true,
    schedule: true,
    forecast: false,
    settings: true,
    spotlight: false,
  },
  error: null,

  // Data
  members: {
    callcenter: [],
    sales: [],
    collections: [],
    districts: [],
  },

  // Call center: { "2026-06-10": { "member-uuid": "A", ... }, ... }
  ccSchedule: {},

  // Manual: { "member-uuid": { "2026-06-10": { status, note }, ... }, ... }
  manualSchedule: {},

  // Forecast: { "2026-06-10": { total_calls, agent_calls, hourly_dist, ... }, ... }
  forecast: {},

  // App settings flat object
  settings: {},

  // Spotlight: { month: "2026-06", member_id, headline, body, member_name }
  spotlight: null,

  // Date range currently loaded (2 months: current + next)
  loadedRange: {
    start: startOfMonth(new Date()),
    end: endOfMonth(addMonths(new Date(), 1)),
  },
};

// ─── Reducer ──────────────────────────────────────────────────

function reducer(state, action) {
  switch (action.type) {

    case 'SET_LOADING':
      return { ...state, loading: { ...state.loading, [action.key]: action.value } };

    case 'SET_ERROR':
      return { ...state, error: action.error };

    case 'SET_MEMBERS': {
      const byTeam = { callcenter: [], sales: [], collections: [], districts: [] };
      (action.members || []).forEach((m) => {
        if (byTeam[m.team]) byTeam[m.team].push(m);
      });
      return { ...state, members: byTeam };
    }

    case 'UPSERT_MEMBER': {
      const m = action.member;
      const team = m.team;
      const list = state.members[team] || [];
      const idx = list.findIndex((x) => x.id === m.id);
      const updated = idx >= 0
        ? [...list.slice(0, idx), m, ...list.slice(idx + 1)]
        : [...list, m];
      return { ...state, members: { ...state.members, [team]: updated } };
    }

    case 'REMOVE_MEMBER': {
      const { id, team } = action;
      return {
        ...state,
        members: {
          ...state.members,
          [team]: state.members[team].filter((m) => m.id !== id),
        },
      };
    }

    case 'SET_CC_SCHEDULE': {
      // Merge incoming rows into date → memberId → shift map
      const schedule = { ...state.ccSchedule };
      (action.rows || []).forEach((row) => {
        const d = row.schedule_date;
        if (!schedule[d]) schedule[d] = {};
        schedule[d][row.member_id] = { shift: row.shift, override: row.is_override };
      });
      return { ...state, ccSchedule: schedule };
    }

    case 'SET_CC_CELL': {
      const { date, memberId, shift, override } = action;
      const day = state.ccSchedule[date] || {};
      return {
        ...state,
        ccSchedule: {
          ...state.ccSchedule,
          [date]: { ...day, [memberId]: { shift, override } },
        },
      };
    }

    case 'SET_MANUAL_SCHEDULE': {
      const manual = { ...state.manualSchedule };
      (action.rows || []).forEach((row) => {
        if (!manual[row.member_id]) manual[row.member_id] = {};
        manual[row.member_id][row.schedule_date] = {
          status: row.status,
          note: row.note,
        };
      });
      return { ...state, manualSchedule: manual };
    }

    case 'SET_MANUAL_CELL': {
      const { memberId, date, status, note } = action;
      const memberMap = state.manualSchedule[memberId] || {};
      return {
        ...state,
        manualSchedule: {
          ...state.manualSchedule,
          [memberId]: { ...memberMap, [date]: { status, note } },
        },
      };
    }

    case 'CLEAR_MANUAL_CELL': {
      const { memberId, date } = action;
      const memberMap = { ...(state.manualSchedule[memberId] || {}) };
      delete memberMap[date];
      return {
        ...state,
        manualSchedule: { ...state.manualSchedule, [memberId]: memberMap },
      };
    }

    case 'SET_FORECAST': {
      const forecast = { ...state.forecast };
      (action.rows || []).forEach((row) => {
        forecast[row.forecast_date] = row;
      });
      return { ...state, forecast };
    }

    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.settings } };

    case 'SET_SPOTLIGHT':
      return { ...state, spotlight: action.spotlight };

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const realtimeSubs = useRef([]);

  // ── Initial load ──────────────────────────────────────────

  const loadAll = useCallback(async () => {
    const { start, end } = state.loadedRange;

    try {
      // Members
      dispatch({ type: 'SET_LOADING', key: 'members', value: true });
      const members = await db.getMembers();
      dispatch({ type: 'SET_MEMBERS', members });
      dispatch({ type: 'SET_LOADING', key: 'members', value: false });

      // Settings
      dispatch({ type: 'SET_LOADING', key: 'settings', value: true });
      const settings = await db.getSettings();
      dispatch({ type: 'SET_SETTINGS', settings });
      dispatch({ type: 'SET_LOADING', key: 'settings', value: false });

      // Schedule (CC)
      dispatch({ type: 'SET_LOADING', key: 'schedule', value: true });
      const ccRows = await db.getCCSchedule(start, end);
      dispatch({ type: 'SET_CC_SCHEDULE', rows: ccRows });
      dispatch({ type: 'SET_LOADING', key: 'schedule', value: false });

      // Manual schedules (all non-CC teams)
      const manualRows = await db.getManualSchedule(null, start, end);
      dispatch({ type: 'SET_MANUAL_SCHEDULE', rows: manualRows });

      // Forecast
      const forecastRows = await db.getForecast(start, end);
      dispatch({ type: 'SET_FORECAST', rows: forecastRows });

      // Spotlight (current month)
      const currentMonth = format(new Date(), 'yyyy-MM');
      const spotlight = await db.getSpotlight(currentMonth);
      dispatch({ type: 'SET_SPOTLIGHT', spotlight });

    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Real-time subscriptions ───────────────────────────────

  useEffect(() => {
    // Unsubscribe previous
    realtimeSubs.current.forEach((s) => s.unsubscribe());
    realtimeSubs.current = [];

    // team_members changes
    const memberSub = supabase
      .channel('team_members_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            dispatch({ type: 'REMOVE_MEMBER', id: payload.old.id, team: payload.old.team });
          } else if (payload.new && payload.new.active === false) {
            // Soft-delete: treat inactive members as removed
            dispatch({ type: 'REMOVE_MEMBER', id: payload.new.id, team: payload.new.team });
          } else if (payload.new) {
            dispatch({ type: 'UPSERT_MEMBER', member: payload.new });
          }
        }
      )
      .subscribe();

    // callcenter_schedule changes
    const ccSub = supabase
      .channel('cc_schedule_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'callcenter_schedule' },
        (payload) => {
          if (payload.eventType !== 'DELETE' && payload.new) {
            dispatch({
              type: 'SET_CC_CELL',
              date: payload.new.schedule_date,
              memberId: payload.new.member_id,
              shift: payload.new.shift,
              override: payload.new.is_override,
            });
          }
        }
      )
      .subscribe();

    // manual_schedules changes
    const manualSub = supabase
      .channel('manual_schedules_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manual_schedules' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            dispatch({ type: 'CLEAR_MANUAL_CELL', memberId: payload.old.member_id, date: payload.old.schedule_date });
          } else {
            dispatch({
              type: 'SET_MANUAL_CELL',
              memberId: payload.new.member_id,
              date: payload.new.schedule_date,
              status: payload.new.status,
              note: payload.new.note,
            });
          }
        }
      )
      .subscribe();

    // forecast_data changes
    const forecastSub = supabase
      .channel('forecast_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'forecast_data' },
        (payload) => {
          if (payload.new) {
            dispatch({ type: 'SET_FORECAST', rows: [payload.new] });
          }
        }
      )
      .subscribe();

    // spotlight changes
    const spotlightSub = supabase
      .channel('spotlight_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'spotlight' },
        (payload) => {
          if (payload.new) {
            dispatch({ type: 'SET_SPOTLIGHT', spotlight: payload.new });
          }
        }
      )
      .subscribe();

    realtimeSubs.current = [memberSub, ccSub, manualSub, forecastSub, spotlightSub];

    return () => {
      realtimeSubs.current.forEach((s) => s.unsubscribe());
    };
  }, []);

  // ── Actions (exposed to components) ──────────────────────

  // --- Members ---

  const addMember = useCallback(async (memberData) => {
    const created = await db.addMember(memberData);
    // Real-time will dispatch UPSERT_MEMBER
    return created;
  }, []);

  const updateMember = useCallback(async (id, updates) => {
    await db.updateMember(id, updates);
  }, []);

  const removeMember = useCallback(async (id, team) => {
    await db.removeMember(id);
    dispatch({ type: 'REMOVE_MEMBER', id, team });
  }, []);

  // --- Call Center Schedule ---

  /**
   * Run the rotation engine and persist results.
   * Preserves existing overrides automatically (db layer handles it).
   */
  const regenerateSchedule = useCallback(async (startDate, endDate) => {
    const ccMembers = state.members.callcenter;
    if (!ccMembers.length) return;

    dispatch({ type: 'SET_LOADING', key: 'schedule', value: true });
    try {
      const generated = generateSchedule(ccMembers, startDate, endDate, state.settings);
      await db.upsertGeneratedSchedule(generated);
      const rows = await db.getCCSchedule(startDate, endDate);
      dispatch({ type: 'SET_CC_SCHEDULE', rows });
    } finally {
      dispatch({ type: 'SET_LOADING', key: 'schedule', value: false });
    }
  }, [state.members.callcenter, state.settings]);

  /** Click-to-edit a single cell in the CC grid */
  const setCCCell = useCallback(async (memberId, date, shift) => {
    // Optimistic update
    dispatch({ type: 'SET_CC_CELL', date, memberId, shift, override: true });
    await db.setCCShiftOverride(memberId, date, shift);
  }, []);

  // --- Manual Schedules ---

  const setManualCell = useCallback(async (memberId, date, status, note = null) => {
    // Optimistic update
    dispatch({ type: 'SET_MANUAL_CELL', memberId, date, status, note });
    await db.setManualStatus(memberId, date, status, note);
  }, []);

  const clearManualCell = useCallback(async (memberId, date) => {
    dispatch({ type: 'CLEAR_MANUAL_CELL', memberId, date });
    await db.clearManualStatus(memberId, date);
  }, []);

  // --- Forecast ---

  const uploadForecast = useCallback(async (rows) => {
    await db.upsertForecast(rows);
    dispatch({ type: 'SET_FORECAST', rows });
  }, []);

  // --- Spotlight ---

  const saveSpotlight = useCallback(async (month, memberId, headline, body) => {
    await db.setSpotlight(month, memberId, headline, body);
    // Real-time will update state, but also optimistic:
    dispatch({ type: 'SET_SPOTLIGHT', spotlight: { month, member_id: memberId, headline, body } });
  }, []);

  // --- Settings ---

  const saveSetting = useCallback(async (key, value) => {
    dispatch({ type: 'SET_SETTINGS', settings: { [key]: value } });
    await db.setSetting(key, value);
  }, []);

  const saveSettings = useCallback(async (updates) => {
    dispatch({ type: 'SET_SETTINGS', settings: updates });
    await db.setSettings(updates);
  }, []);

  // ── Context value ─────────────────────────────────────────

  const value = {
    // State
    ...state,

    // Computed helpers
    allMembers: [
      ...state.members.callcenter,
      ...state.members.sales,
      ...state.members.collections,
      ...state.members.districts,
    ],

    // Actions
    addMember,
    updateMember,
    removeMember,
    regenerateSchedule,
    setCCCell,
    setManualCell,
    clearManualCell,
    uploadForecast,
    saveSpotlight,
    saveSetting,
    saveSettings,
    reload: loadAll,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

export default AppContext;
