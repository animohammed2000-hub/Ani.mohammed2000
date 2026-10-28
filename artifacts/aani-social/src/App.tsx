import React, { useState } from 'react';
import { Heart, MessageSquare, Home, Search, PlusCircle, Bell, User } from 'lucide-react';

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

  const toggleLike = async () => {
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
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-white shadow-sm">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{post.author?.full_name || 'مستخدم'}</div>
        <div className="text-xs text-zinc-400">
          {post.created_at ? new Date(post.created_at).toLocaleDateString() : ''}
        </div>
      </div>

      {post.content && <p className="mt-3 text-sm leading-6 text-zinc-200">{post.content}</p>}

      <div className="mt-4 flex items-center gap-3 text-zinc-300">
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
    </div>
  );
}

export default function App() {
  const currentUserId = 'demo-user-id';
  const [selectedPostForComments, setSelectedPostForComments] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'home' | 'search' | 'notifications' | 'profile'>('home');

  const posts: Post[] = [
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
  ];

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-white dir-rtl">
      {/* 1. الهيدر العلوي للتطبيق */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 backdrop-blur-md">
        <h1 className="text-xl font-bold text-pink-500">Ani Social</h1>
        <button className="rounded-full bg-pink-600 p-2 text-white hover:bg-pink-500">
          <PlusCircle size={20} />
        </button>
      </header>

      {/* 2. محتوى الصفحة بناءً على التبويب النشط */}
      <main className="flex-1 space-y-4 p-4 pb-20 mx-auto w-full max-w-3xl">
        {activeTab === 'home' && (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              onOpenComments={(postId) => setSelectedPostForComments(postId)}
            />
          ))
        )}

        {activeTab === 'search' && (
          <div className="py-12 text-center text-zinc-400">صفحة البحث</div>
        )}

        {activeTab === 'notifications' && (
          <div className="py-12 text-center text-zinc-400">صفحة الإشعارات</div>
        )}

        {activeTab === 'profile' && (
          <div className="py-12 text-center text-zinc-400">الملف الشخصي</div>
        )}
      </main>

      {/* 3. شريط التنقل السفلي */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-zinc-800 bg-zinc-950/90 py-3 backdrop-blur-md">
        <button
          onClick={() => setActiveTab('home')}
          className={`flex flex-col items-center text-xs ${activeTab === 'home' ? 'text-pink-500' : 'text-zinc-400'}`}
        >
          <Home size={22} />
          <span className="mt-1">الرئيسية</span>
        </button>
        <button
          onClick={() => setActiveTab('search')}
          className={`flex flex-col items-center text-xs ${activeTab === 'search' ? 'text-pink-500' : 'text-zinc-400'}`}
        >
          <Search size={22} />
          <span className="mt-1">البحث</span>
        </button>
        <button
          onClick={() => setActiveTab('notifications')}
          className={`flex flex-col items-center text-xs ${activeTab === 'notifications' ? 'text-pink-500' : 'text-zinc-400'}`}
        >
          <Bell size={22} />
          <span className="mt-1">الإشعارات</span>
        </button>
        <button
          onClick={() => setActiveTab('profile')}
          className={`flex flex-col items-center text-xs ${activeTab === 'profile' ? 'text-pink-500' : 'text-zinc-400'}`}
        >
          <User size={22} />
          <span className="mt-1">حسابي</span>
        </button>
      </nav>

      {/* 4. درج التعليقات المنسدل */}
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
