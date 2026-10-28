import React, { useState } from 'react';
import {
  Heart,
  MessageSquare,
  Home,
  Search,
  PlusCircle,
  Bell,
  User,
  Share2,
  Bookmark,
  Sparkles,
  X,
} from 'lucide-react';

import CommentsDrawer from './components/CommentsDrawer';
import AIAssistantModal from './components/AIAssistantModal';

type Story = {
  id: string;
  user_name: string;
  user_avatar?: string;
  media_url?: string;
  has_unseen?: boolean;
};

type Post = {
  id: string;
  content: string;
  created_at?: string;
  comments_count?: number;
  likes_count?: number;
  liked_by_me?: boolean;
  media_url?: string;
  author?: {
    full_name?: string;
    username?: string;
    avatar_url?: string;
  };
};

export default function App() {
  const currentUserId = 'demo-user-id';
  const [activeTab, setActiveTab] = useState<'home' | 'search' | 'notifications' | 'profile'>('home');
  const [selectedPostForComments, setSelectedPostForComments] = useState<string | null>(null);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [activeStory, setActiveStory] = useState<Story | null>(null);

  const stories: Story[] = [
    {
      id: 's-0',
      user_name: 'قصتك',
      user_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      has_unseen: false,
    },
    {
      id: 's-1',
      user_name: 'أماني',
      user_avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
      media_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600',
      has_unseen: true,
    },
    {
      id: 's-2',
      user_name: 'سارة',
      user_avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
      media_url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600',
      has_unseen: true,
    },
    {
      id: 's-3',
      user_name: 'محمد',
      user_avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
      media_url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600',
      has_unseen: false,
    },
  ];

  const [posts, setPosts] = useState<Post[]>([
    {
      id: 'post-1',
      content:
        'مرحباً بكم في شبكة Ani Social! يسعدنا مشاركة اللحظات والتحديثات الجديدة معكم يومياً. 🚀✨',
      created_at: new Date().toISOString(),
      comments_count: 18,
      likes_count: 142,
      liked_by_me: true,
      author: {
        full_name: 'أماني الشمري',
        username: 'amani_sh',
        avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      },
      media_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800',
    },
    {
      id: 'post-2',
      content:
        'تحديث الواجهة أصبح سريعاً ومثمراً للغاية، تم تفنيش نموذج التعليق المباشر وعرض شريط التعليقات المنسدل.',
      created_at: new Date(Date.now() - 7200000).toISOString(),
      comments_count: 6,
      likes_count: 54,
      liked_by_me: false,
      author: {
        full_name: 'سارة أحمد',
        username: 'sara_a',
        avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
      },
    },
  ]);

  const toggleLike = (postId: string) => {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id === postId) {
          const nextLiked = !p.liked_by_me;
          return {
            ...p,
            liked_by_me: nextLiked,
            likes_count: (p.likes_count || 0) + (nextLiked ? 1 : -1),
          };
        }
        return p;
      })
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-white dir-rtl font-sans pb-20">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/90 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-black bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent">
            Ani Social
          </span>
        </div>

        <button
          type="button"
          onClick={() => setIsAiModalOpen(true)}
          className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-pink-500/20 hover:opacity-90"
        >
          <Sparkles size={14} />
          <span>مساعد AI</span>
        </button>
      </header>

      <section className="border-b border-zinc-800/60 bg-zinc-900/40 py-3 px-4 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-4">
          {stories.map((story) => (
            <button
              key={story.id}
              type="button"
              onClick={() => story.media_url && setActiveStory(story)}
              className="flex flex-col items-center gap-1.5 flex-shrink-0 group"
            >
              <div
                className={`relative p-0.5 rounded-full ${
                  story.has_unseen
                    ? 'bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600'
                    : 'bg-zinc-700'
                }`}
              >
                <img
                  src={story.user_avatar}
                  alt={story.user_name}
                  className="w-14 h-14 rounded-full object-cover border-2 border-zinc-950 group-hover:scale-105 transition"
                />
                {story.id === 's-0' && (
                  <div className="absolute bottom-0 left-0 rounded-full bg-pink-500 p-1 text-white border-2 border-zinc-950">
                    <PlusCircle size={12} />
                  </div>
                )}
              </div>
              <span className="text-[11px] text-zinc-300 max-w-[64px] truncate">
                {story.user_name}
              </span>
            </button>
          ))}
        </div>
      </section>

      <main className="flex-1 space-y-4 p-4 mx-auto w-full max-w-2xl">
        {activeTab === 'home' &&
          posts.map((post) => (
            <article
              key={post.id}
              className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 overflow-hidden shadow-md"
            >
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <img
                    src={post.author?.avatar_url || 'https://via.placeholder.com/40'}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  <div>
                    <h4 className="font-semibold text-sm text-zinc-100">
                      {post.author?.full_name}
                    </h4>
                    <p className="text-xs text-zinc-400">@{post.author?.username}</p>
                  </div>
                </div>
              </div>

              {post.content && (
                <p className="px-4 pb-3 text-sm leading-relaxed text-zinc-200">
                  {post.content}
                </p>
              )}

              {post.media_url && (
                <div className="w-full max-h-[420px] overflow-hidden bg-black">
                  <img
                    src={post.media_url}
                    alt="Post content"
                    className="w-full object-cover max-h-[420px]"
                  />
                </div>
              )}

              <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800/50 text-zinc-400 text-xs">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => toggleLike(post.id)}
                    className={`flex items-center gap-1.5 transition ${
                      post.liked_by_me ? 'text-pink-500 font-bold' : 'hover:text-zinc-200'
                    }`}
                  >
                    <Heart size={18} fill={post.liked_by_me ? 'currentColor' : 'none'} />
                    <span>{post.likes_count}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPostForComments(post.id)}
                    className="flex items-center gap-1.5 hover:text-zinc-200 transition"
                  >
                    <MessageSquare size={17} />
                    <span>{post.comments_count ?? 0}</span>
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <button type="button" className="hover:text-zinc-200">
                    <Share2 size={18} />
                  </button>
                  <button type="button" className="hover:text-zinc-200">
                    <Bookmark size={18} />
                  </button>
                </div>
              </div>
            </article>
          ))}

        {activeTab !== 'home' && (
          <div className="py-20 text-center text-zinc-500 text-sm">
            جاري التبديل بين الشاشات...
          </div>
        )}
      </main>

      {activeStory && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4">
          <button
            type="button"
            onClick={() => setActiveStory(null)}
            className="absolute top-4 left-4 p-2 text-white bg-zinc-800 rounded-full"
          >
            <X size={20} />
          </button>

          <div className="max-w-md w-full text-center space-y-4">
            <h3 className="text-lg font-bold">{activeStory.user_name}</h3>
            {activeStory.media_url && (
              <img
                src={activeStory.media_url}
                alt=""
                className="rounded-2xl max-h-[70vh] mx-auto object-cover"
              />
            )}
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-zinc-800/80 bg-zinc-950/95 py-2.5 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className={`flex flex-col items-center text-[11px] ${
            activeTab === 'home' ? 'text-pink-500 font-bold' : 'text-zinc-400'
          }`}
        >
          <Home size={20} />
          <span className="mt-1">الرئيسية</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('search')}
          className={`flex flex-col items-center text-[11px] ${
            activeTab === 'search' ? 'text-pink-500 font-bold' : 'text-zinc-400'
          }`}
        >
          <Search size={20} />
          <span className="mt-1">البحث</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('notifications')}
          className={`flex flex-col items-center text-[11px] ${
            activeTab === 'notifications' ? 'text-pink-500 font-bold' : 'text-zinc-400'
          }`}
        >
          <Bell size={20} />
          <span className="mt-1">الإشعارات</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`flex flex-col items-center text-[11px] ${
            activeTab === 'profile' ? 'text-pink-500 font-bold' : 'text-zinc-400'
          }`}
        >
          <User size={20} />
          <span className="mt-1">حسابي</span>
        </button>
      </nav>

      {selectedPostForComments && (
        <CommentsDrawer
          postId={selectedPostForComments}
          currentUserId={currentUserId}
          isOpen={Boolean(selectedPostForComments)}
          onClose={() => setSelectedPostForComments(null)}
        />
      )}

      {isAiModalOpen && (
        <AIAssistantModal
          isOpen={isAiModalOpen}
          onClose={() => setIsAiModalOpen(false)}
        />
      )}
    </div>
  );
}
