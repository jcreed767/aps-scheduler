// src/hooks/useSchedule.js
// ─────────────────────────────────────────────────────────────
// Convenience hook wrapping call center scheduling operations.
// Auto-regenerates if schedule rows are missing for the loaded range.
// ─────────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react';
import { startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { useApp } from '../context/AppContext';

export function useSchedule() {
  const app = useApp();
  const hasGenerated = useRef(false);

  const {
    members,
    ccSchedule,
    loading,
    settings,
    regenerateSchedule,
    loadedRange,
  } = app;

  const ccMembers = members.callcenter;

  // Auto-generate if we have members but no schedule rows
  useEffect(() => {
    if (hasGenerated.current) return;
    if (loading.members || loading.schedule || loading.settings) return;
    if (!ccMembers.length) return;

    const scheduledDates = Object.keys(ccSchedule);
    if (scheduledDates.length === 0) {
      // No schedule in DB at all — generate for the next 2 months
      hasGenerated.current = true;
      const start = startOfMonth(new Date());
      const end = endOfMonth(addMonths(new Date(), 1));
      regenerateSchedule(start, end);
    }
  }, [loading.members, loading.schedule, loading.settings, ccMembers, ccSchedule, regenerateSchedule]);

  return {
    ccMembers,
    ccSchedule: app.ccSchedule,
    forecast: app.forecast,
    settings: app.settings,
    loading: loading.schedule,
    setCCCell: app.setCCCell,
    regenerateSchedule,
    loadedRange,
  };
}

export default useSchedule;
