import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabasePublicKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  '';

export const supabaseConfigured = Boolean(supabaseUrl && supabasePublicKey);
export const storageBucket =
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET?.trim() || 'aani-media';

if (!supabaseConfigured) {
  console.warn(
    'Supabase is not configured. Set VITE_SUPABASE_URL and either VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY.',
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabasePublicKey || 'placeholder',
);
