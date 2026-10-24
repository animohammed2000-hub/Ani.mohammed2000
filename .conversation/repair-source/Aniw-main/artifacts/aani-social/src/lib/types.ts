export type Profile = {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  bio: string;
};

export type Post = {
  id: string;
  user_id: string;
  content: string;
  media_url: string | null;
  type: 'text' | 'photo' | 'reel';
  created_at: string;
  author: Profile | null;
  likes?: { user_id: string }[];
  comments?: { id: string }[];
};

export const displayName = (profile?: Partial<Profile> | null) =>
  profile?.full_name || (profile?.username ? `@${profile.username}` : 'عضو آني');

export const normalizeProfile = (value: unknown): Profile | null => {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? row as Profile : null;
};

export const formatDate = (value: string) => new Intl.DateTimeFormat('ar', {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));