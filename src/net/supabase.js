import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isConfigured = !!(url && key);

// 10 messages/sec matches our broadcast tick rate and keeps a full 6-car
// lobby well under Supabase Free's 100 msg/s project-wide realtime quota.
export const supabase = isConfigured
  ? createClient(url, key, { realtime: { params: { eventsPerSecond: 10 } } })
  : null;
