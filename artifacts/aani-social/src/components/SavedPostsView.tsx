import React from 'react';
import { Bookmark, RefreshCw } from 'lucide-react';

import { useSavedPosts } from '../lib/interactions';
import PostCard from './PostCard';

interface SavedPostsViewProps {
  currentUserId: string;
  onOpenComments?: (postId: string, initialCount?: number) => void;
}

export default function SavedPostsView({
  currentUserId,
  onOpenComments,
}: SavedPostsViewProps) {
  const { posts, loading, error, refresh } = useSavedPosts(currentUserId);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4" dir="rtl">
      {/* رأس القسم */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3 px-1">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
            <Bookmark size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-100">العناصر المحفوظة</h2>
            <p className="text-xs text-zinc-400">المنشورات التي قمت بحفظها للرجوع إليها لاحقاً</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="p-2 text-zinc-400 hover:text-white rounded-full bg-zinc-800/60 hover:bg-zinc-800 transition disabled:opacity-50"
          title="تحديث قائمة المحفوظات"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin text-pink-500' : ''} />
        </button>
      </div>

      {/* حالة الخطأ */}
      {error && (
        <div className="p-4 rounded-xl border border-red-900/50 bg-red-950/30 text-red-300 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-xs font-semibold px-3 py-1 bg-red-900/40 rounded-lg hover:bg-red-900/60"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* حالة جلب البيانات */}
      {loading && posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-500 space-y-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" />
          <p className="text-sm">جاري تحميل المنشورات المحفوظة...</p>
        </div>
      ) : !loading && posts.length === 0 ? (
        /* لا توجد عناصر محفوظة */
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 bg-zinc-900/40 rounded-2xl border border-zinc-800/60 p-6">
          <div className="p-4 rounded-full bg-zinc-800 text-zinc-600">
            <Bookmark size={32} />
          </div>
          <h3 className="text-base font-semibold text-zinc-300">لا توجد عناصر محفوظة بعد</h3>
          <p className="text-xs text-zinc-500 max-w-sm">
            يمكنك حفظ المنشورات المهمة بالضغط على أيقونة العلامة المرجعية أسفل أي منشور لتظهر هنا.
          </p>
        </div>
      ) : (
        /* عرض قائمة المنشورات المحفوظة */
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              onOpenComments={onOpenComments}
              onRefresh={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
