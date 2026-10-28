import React, { useMemo, useState } from 'react';
import {
  Bell,
  Compass,
  Heart,
  Home,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Sparkles,
  User,
} from 'lucide-react';

import CommentsDrawer from './components/CommentsDrawer';

type Post = {
  id: string;
  content: string;
  created_at?: string;
  comments_count?: number;
  likes_count?: number;
  liked_by_me?: boolean;
  likes?: Array<{ user_id: string }>;
  author?: {
    full_name?: string;
    username?: string;
  };
};

function PostCard({
  post,
  currentUserId,
  onOpenComments,
}: {
  post: Post;
  currentUserId: string;
  onOpenComments?: (postId: string) => void;
}) {
  const [liked, setLiked] = useState(post.liked_by_me ?? (post.likes || []).some((like) => like.user_id === currentUserId));
  const [likesCount, setLikesCount] = useState(post.likes_count ?? post.likes?.length ?? 0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isLikePending, setIsLikePending] = useState(false);

  const toggleLike = () => {
    if (isLikePending) return;

    const prevLiked = liked;
    const prevCount = likesCount;
    const nextLiked = !prevLiked;

    setIsLikePending(true);
    setLiked(nextLiked);
    setLikesCount(prevCount + (nextLiked ? 1 : -1));
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 450);
    setIsLikePending(false);
  };

  const handleOpenComments = () => {
    onOpenComments?.(post.id);
  };

  return (
    <article className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-4 shadow-[0_12px_38px_rgba(0,0,0,0.28)] backdrop-blur-sm">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-violet-600 text-sm font-bold text-white">
            {post.author?.full_name?.[0] || 'م'}
          </div>
          <div>
            <div className="text-sm font-bold text-white">{post.author?.full_name || 'مستخدم'}</div>
            <div className="text-[11px] text-zinc-400" dir="ltr">
              @{post.author?.username || 'user'}
            </div>
          </div>
        </div>

        <div className="text-[11px] text-zinc-400">
          {post.created_at ? new Date(post.created_at).toLocaleDateString() : 'اليوم'}
        </div>
      </header>

      {post.content && <p className="mb-4 text-sm leading-7 text-zinc-200">{post.content}</p>}

      <div className="mt-2 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
        <div className="mb-3 h-48 rounded-2xl bg-gradient-to-br from-zinc-800 via-zinc-700 to-zinc-900" />
      </div>

      <div className="mt-4 flex items-center justify-between text-zinc-300">
        <button
          type="button"
          onClick={toggleLike}
          disabled={isLikePending}
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition ${
            liked ? 'bg-pink-500/15 text-pink-300' : 'bg-zinc-800 text-zinc-300'
          }`}
        >
          <Heart
            size={15}
            fill={liked ? 'currentColor' : 'none'}
            className={isAnimating ? 'animate-pulse' : ''}
          />
          {likesCount}
        </button>

        <button
          type="button"
          onClick={handleOpenComments}
          className="inline-flex items-center gap-2 rounded-full bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-700"
        >
          <MessageSquare size={15} />
          {post.comments_count ?? 0}
        </button>
      </div>
    </article>
  );
}

function FeedScreen({ posts, onOpenComments }: { posts: Post[]; onOpenComments: (postId: string) => void }) {
  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-violet-600 text-sm font-bold text-white">
              م
            </div>
            <div className="flex-1 rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm text-zinc-500">
              ماذا يحدث اليوم؟
            </div>
          </div>
        </div>

        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUserId="demo-user-id"
            onOpenComments={onOpenComments}
          />
        ))}
      </div>
    </main>
  );
}

function SearchScreen() {
  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-900/80 p-4">
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2">
          <Search size={18} className="text-pink-500" />
          <input
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
            placeholder="ابحث عن الناس أو المنشورات..."
            defaultValue=""
          />
        </div>
        <div className="space-y-3 text-zinc-300">
          <div className="rounded-2xl bg-zinc-800 p-3 text-sm">نتائج البحث ستظهر هنا</div>
          <div className="rounded-2xl bg-zinc-800 p-3 text-sm">مستخدمون بارزون</div>
        </div>
      </div>
    </main>
  );
}

function MessagesScreen() {
  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 text-sm text-zinc-300">
          الرسائل المباشرة ستظهر هنا
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 text-sm text-zinc-400">
          لا توجد محادثات جديدة
        </div>
      </div>
    </main>
  );
}

function ProfileScreen() {
  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
        <div className="mb-4 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-violet-600 text-lg font-bold text-white">
            م
          </div>
          <div>
            <div className="text-lg font-bold text-white">ملفي</div>
            <div className="text-sm text-zinc-400" dir="ltr">@mohammed</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl bg-zinc-800 p-3">
            <div className="text-xl font-bold text-white">142</div>
            <div className="text-xs text-zinc-400">منشورات</div>
          </div>
          <div className="rounded-2xl bg-zinc-800 p-3">
            <div className="text-xl font-bold text-white">4.8k</div>
            <div className="text-xs text-zinc-400">متابعين</div>
          </div>
          <div className="rounded-2xl bg-zinc-800 p-3">
            <div className="text-xl font-bold text-white">285</div>
            <div className="text-xs text-zinc-400">يتابع</div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function App() {
  const currentUserId = 'demo-user-id';
  const [activeView, setActiveView] = useState<'feed' | 'search' | 'messages' | 'profile'>('feed');
  const [selectedPostForComments, setSelectedPostForComments] = useState<string | null>(null);

  const posts: Post[] = useMemo(
    () => [
      {
        id: 'post-1',
        content: 'أول منشور في الخلاصة. هذا هو الإصدار المنقح الذي يفتح الشريط السفلي عند الضغط على التعليقات.',
        created_at: new Date().toISOString(),
        comments_count: 12,
        likes_count: 89,
        author: { full_name: 'أماني', username: 'amani' },
      },
      {
        id: 'post-2',
        content: 'تمت إزالة نموذج التعليق الداخلي وعرض شريط التعليقات العلوي في أسفل الشاشه.',
        created_at: new Date(Date.now() - 3600000).toISOString(),
        comments_count: 4,
        likes_count: 21,
        author: { full_name: 'سارة', username: 'sara' },
      },
      {
        id: 'post-3',
        content: 'الواجهة الآن قريبة من التطبيق الكامل مع شريط تنقل علوي وسفلي، مع عمل شريط التعليقات كـ bottom sheet.',
        created_at: new Date(Date.now() - 7200000).toISOString(),
        comments_count: 7,
        likes_count: 53,
        author: { full_name: 'ليلى', username: 'leila' },
      },
    ],
    []
  );

  const renderView = () => {
    switch (activeView) {
      case 'search':
        return <SearchScreen />;
      case 'messages':
        return <MessagesScreen />;
      case 'profile':
        return <ProfileScreen />;
      case 'feed':
      default:
        return <FeedScreen posts={posts} onOpenComments={(postId) => setSelectedPostForComments(postId)} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#070b12] text-white" dir="rtl">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col bg-zinc-950/90 shadow-[0_0_40px_rgba(0,0,0,0.25)]">
        <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3">
              <button className="rounded-full bg-zinc-800 p-2 text-zinc-200 hover:bg-zinc-700">
                <Bell size={18} />
              </button>
            </div>

            <div className="flex items-center gap-2 text-lg font-bold text-white">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-violet-600">
                <Sparkles size={16} />
              </div>
              آني
            </div>

            <div className="flex items-center gap-2">
              <button className="rounded-full bg-zinc-800 p-2 text-zinc-200 hover:bg-zinc-700">
                <Settings size={18} />
              </button>
              <button className="rounded-full bg-pink-600 p-2 text-white shadow-lg shadow-pink-600/30 hover:bg-pink-500">
                <Plus size={18} />
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col lg:flex-row">
          <aside className="hidden w-72 border-r border-zinc-800 bg-zinc-950/80 p-5 lg:block">
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-violet-600 text-lg font-bold text-white">
                آ
              </div>
              <div>
                <div className="font-bold text-white">آني</div>
                <div className="text-xs text-zinc-400">منشورات عربية</div>
              </div>
            </div>

            <nav className="space-y-2">
              {[
                ['الرئيسية', Home],
                ['استكشاف', Compass],
                ['بحث', Search],
                ['ملفي', User],
              ].map(([label, Icon]) => (
                <button
                  key={label}
                  onClick={() => {
                    if (label === 'الرئيسية') setActiveView('feed');
                    if (label === 'بحث') setActiveView('search');
                    if (label === 'ملفي') setActiveView('profile');
                    if (label === 'استكشاف') setActiveView('feed');
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-right text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </aside>

          {renderView()}
        </div>

        <nav className="sticky bottom-0 z-30 border-t border-zinc-800 bg-zinc-950/90 backdrop-blur-xl lg:hidden">
          <div className="mx-auto grid max-w-lg grid-cols-4 gap-2 px-3 py-2">
            {[Home, Search, MessageSquare, User].map((Icon, idx) => (
              <button
                key={idx}
                onClick={() => {
                  if (idx === 0) setActiveView('feed');
                  if (idx === 1) setActiveView('search');
                  if (idx === 2) setActiveView('messages');
                  if (idx === 3) setActiveView('profile');
                }}
                className="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                <Icon size={18} />
                <span className="text-[10px]">{['الرئيسية', 'بحث', 'رسائل', 'ملفي'][idx]}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>

      {selectedPostForComments && (
        <CommentsDrawer
          postId={selectedPostForComments}
          currentUserId={currentUserId}
          isOpen={Boolean(selectedPostForComments)}
          onClose={() => setSelectedPostForComments(null)}
        />
      )}
    </div>
  );
}
