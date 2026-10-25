
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (
  import.meta.env.VITE_SUPABASE_URL || ""
).trim();

const supabasePublicKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  ""
).trim();

export const supabaseConfigured = Boolean(
  supabaseUrl && supabasePublicKey,
);

export const storageBucket =
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET?.trim() ||
  "aani-media";

if (!supabaseConfigured) {
  console.error(
    "Supabase configuration missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY).",
  );
}

if (
  supabaseUrl &&
  !/^https:\/\/[a-zA-Z0-9-]+\.supabase\.co\/?$/.test(supabaseUrl)
) {
  console.error(
    "VITE_SUPABASE_URL must be your valid Supabase project URL.",
  );
}

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabasePublicKey || "placeholder",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
