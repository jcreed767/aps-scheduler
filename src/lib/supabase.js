// src/lib/supabase.js
// ─────────────────────────────────────────────────────────────
// Supabase client singleton
// ─────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    '[APS] Missing Supabase env vars. Add REACT_APP_SUPABASE_URL and ' +
    'REACT_APP_SUPABASE_ANON_KEY to your .env file and Netlify environment.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
});

export default supabase;
