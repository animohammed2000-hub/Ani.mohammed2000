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
  media_urls?: string[];
  type: 'text' | 'photo' | 'reel';
  created_at: string;
  author: Profile | null;

  // العدادات الحقيقية المربوطة بـ Supabase Triggers
  likes_count: number;
  comments_count: number;
  reposts_count: number;

  // حالات المستخدم الحالي لحفظ التفاعل بشكل دائم
  liked_by_me?: boolean;
  saved_by_me?: boolean;
  reposted_by_me?: boolean;

  // حقول اختيارية سابقة
  likes?: { user_id: string }[];
  comments?: any[];
};

export const displayName = (profile?: Partial<Profile> | null) =>
  profile?.full_name || (profile?.username ? `@${profile.username}` : 'عضو آني');

export const normalizeProfile = (value: unknown): Profile | null => {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? (row as Profile) : null;
};

export const formatDate = (value: string) =>
  new Intl.DateTimeFormat('ar', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
