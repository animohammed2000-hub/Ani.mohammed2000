import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabasePublicKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  '';

export const supabaseConfigured = Boolean(supabaseUrl && supabasePublicKey);

if (!supabaseConfigured) {
  console.warn('تنبيه: أضف VITE_SUPABASE_URL وVITE_SUPABASE_PUBLISHABLE_KEY أو VITE_SUPABASE_ANON_KEY إلى Replit Secrets.');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabasePublicKey || 'placeholder'
);