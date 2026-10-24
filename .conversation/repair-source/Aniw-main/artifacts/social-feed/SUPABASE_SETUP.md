# Supabase setup

The app uses the Supabase project configured with `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. The publishable/anon key is used by the browser; do
not put a Supabase service-role key in the app.

1. In the Supabase dashboard, open the project's **SQL Editor**.
2. Run [`supabase/schema.sql`](./supabase/schema.sql). It safely migrates the
   previous profiles/posts tables, adds `likes`, `comments`, `follows`, and
   `messages`, creates the `aani-media` bucket, and applies row-level security.
3. In **Authentication → Providers → Email**, enable email signups. If email
   confirmation is enabled, members must verify their email before signing in.
4. Confirm the `aani-media` bucket is public for media playback. The SQL creates
   it as public if it does not exist. Uploads remain restricted to each
   authenticated member's own UUID folder.
5. In **Database → Publications**, confirm `messages` is included in
   `supabase_realtime`. The SQL adds it to the default publication when that
   publication exists.
6. Start or refresh the app. Create an account, then follow members from
   Explore to populate the feed.

The migration preserves existing profile and post rows. It backfills
`full_name` and `username` for older profiles, and existing text posts remain
visible. The app uses only the publishable key; row-level security restricts
changes to the signed-in member and allows realtime reads only for messages
they sent or received.

The app validates image and video file types and sizes before upload. Supabase's
project-level Storage upload limit must also allow the selected video size.
