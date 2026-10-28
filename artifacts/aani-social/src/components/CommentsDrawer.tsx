import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, MessageCircle, Send, X } from 'lucide-react';

import CommentItem from './CommentItem';
import {
  fetchCommentsWithReplies,
  toggleCommentLike,
  uploadCommentImage,
  type CommentWithDetails,
} from '../lib/interactions';
import { supabase } from '../lib/supabase';

interface CommentsDrawerProps {
  postId: string;
  currentUserId: string;
  isOpen: boolean;
  onClose: () => void;
}

const formatCounter = (value: number): string => {
  if (value === 0) return '0';
  return value > 999 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(value);
};

const buildInitials = (fullName?: string | null): string => {
  const source = (fullName ?? '').trim();
  if (!source) return 'آ';

  const initials = source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);

  return initials || 'آ';
};

export const CommentsDrawer: React.FC<CommentsDrawerProps> = ({
  postId,
  currentUserId,
  isOpen,
  onClose,
}) => {
  const [comments, setComments] = useState<CommentWithDetails[]>([]);
  const [content, setContent] = useState('');
  const [replyingTo, setReplyingTo] = useState<CommentWithDetails | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingCommentLikeIds, setPendingCommentLikeIds] = useState<Record<string, boolean>>({});
  const [currentUser, setCurrentUser] = useState<{
    full_name: string;
    username: string;
    avatar_url: string | null;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const loadComments = async () => {
    if (!postId) return;
    setLoading(true);
    try {
      const data = await fetchCommentsWithReplies(postId, currentUserId);
      setComments(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !currentUserId) return;

    void supabase
      .from('profiles')
      .select('full_name, username, avatar_url')
      .eq('id', currentUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setCurrentUser(data as typeof currentUser);
      });

    void loadComments();
  }, [isOpen, postId, currentUserId]);

  useEffect(() => {
    if (!isOpen) return;

    const channel = supabase
      .channel(`comments_drawer_${postId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` },
        () => {
          void loadComments();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comment_likes' },
        () => {
          void loadComments();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isOpen, postId]);

  useEffect(() => {
    if (!selectedImage) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedImage);
    setPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedImage]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '0px';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 130)}px`;
    }
  }, [content]);

  const totalComments = useMemo(() => {
    return comments.reduce((sum, comment) => {
      return sum + 1 + (comment.replies?.length ?? 0);
    }, 0);
  }, [comments]);

  const insertMention = () => {
    if (replyingTo) {
      const mention = `@${replyingTo.profiles?.username || 'user'} `;
      setContent((prev) => `${prev}${prev.trim() ? ' ' : ''}${mention}`);
      return;
    }

    setContent((prev) => `${prev}${prev.trim() ? ' ' : ''}@`);
  };

  const handleSubmit = async () => {
    const nextContent = content.trim();
    if (submitting) return;
    if (!nextContent && !selectedImage) return;

    setSubmitting(true);
    try {
      let imageUrl: string | null = null;

      if (selectedImage) {
        imageUrl = (await uploadCommentImage(selectedImage)) ?? null;
      }

      const payload = {
        post_id: postId,
        user_id: currentUserId,
        content: nextContent || '',
        image_url: imageUrl,
        parent_id: replyingTo?.id ?? null,
      };

      const { error } = await supabase.from('comments').insert(payload);
      if (error) throw error;

      if (replyingTo && replyingTo.user_id !== currentUserId) {
        await supabase.from('notifications').insert({
          user_id: replyingTo.user_id,
          actor_id: currentUserId,
          type: 'reply',
          comment_id: replyingTo.id,
        });
      }

      setContent('');
      setSelectedImage(null);
      setPreviewUrl(null);
      setReplyingTo(null);
      await loadComments();
    } catch (err) {
      console.error('Error posting comment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleLike = async (commentId: string, isLiked: boolean) => {
    if (pendingCommentLikeIds[commentId]) return;

    setPendingCommentLikeIds((prev) => ({ ...prev, [commentId]: true }));

    try {
      const allComments = [...comments, ...comments.flatMap((c) => c.replies || [])];
      const target = allComments.find((c) => c.id === commentId);
      const ownerId = target?.user_id;
      if (!ownerId) return;

      await toggleCommentLike(commentId, currentUserId, ownerId, isLiked);
      await loadComments();
    } finally {
      setPendingCommentLikeIds((prev) => {
        const next = { ...prev };
        delete next[commentId];
        return next;
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm" dir="rtl">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-10 flex h-[82vh] w-full max-w-xl flex-col rounded-t-3xl border-t border-zinc-800 bg-zinc-950 text-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
          >
            <X size={20} />
          </button>

          <div className="flex items-center gap-2">
            <MessageCircle size={18} className="text-pink-500" />
            <span className="font-bold text-base text-zinc-100">
              {formatCounter(totalComments)} تعليقاً
            </span>
          </div>

          <div className="w-8" />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && comments.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-zinc-500">
              جاري تحميل التعليقات...
            </div>
          ) : comments.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-zinc-500">
              <MessageCircle size={32} className="text-zinc-700" />
              <p className="text-sm">لا توجد تعليقات بعد... كن أول من يعلق!</p>
            </div>
          ) : (
            comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                currentUserId={currentUserId}
                onReply={(item) => setReplyingTo(item)}
                onToggleLike={handleToggleLike}
              />
            ))
          )}
        </div>

        <div className="shrink-0 border-t border-zinc-800/80 bg-zinc-950 p-3 space-y-2">
          {replyingTo && (
            <div className="flex items-center justify-between rounded-xl bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 border border-zinc-800">
              <span>
                الرد على <strong className="text-pink-400">@{replyingTo.profiles?.username || 'مستخدم'}</strong>
              </span>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="text-zinc-400 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {previewUrl && (
            <div className="relative inline-block h-16 w-16 overflow-hidden rounded-xl border border-zinc-700">
              <img src={previewUrl} alt="Attachment preview" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                className="absolute right-1 top-1 rounded-full bg-black/80 p-1 text-white hover:bg-black"
              >
                <X size={12} />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="shrink-0 pb-1">
              {currentUser?.avatar_url ? (
                <img
                  src={currentUser.avatar_url}
                  alt={currentUser.full_name}
                  className="h-9 w-9 rounded-full object-cover ring-1 ring-zinc-700"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-violet-600 text-xs font-bold text-white ring-1 ring-zinc-700">
                  {buildInitials(currentUser?.full_name)}
                </div>
              )}
            </div>

            <div className="flex flex-1 items-end rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 focus-within:border-pink-500/50">
              <textarea
                ref={textareaRef}
                rows={1}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={replyingTo ? 'اكتب رداً...' : 'إضافة تعليق...'}
                className="max-h-32 flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
                dir="rtl"
              />

              <div className="flex shrink-0 items-center gap-1.5 text-zinc-400 mr-2 pb-0.5">
                <button
                  type="button"
                  onClick={insertMention}
                  className="rounded-full p-1 hover:bg-zinc-800 hover:text-zinc-200"
                  title="إشارة @"
                >
                  @
                </button>

                <label className="cursor-pointer rounded-full p-1 hover:bg-zinc-800 hover:text-zinc-200">
                  <ImagePlus size={18} />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setSelectedImage(file);
                    }}
                  />
                </label>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || (!content.trim() && !selectedImage)}
              className="shrink-0 rounded-full bg-gradient-to-r from-pink-500 to-violet-600 p-2.5 text-white transition disabled:opacity-40"
            >
              <Send size={18} className="dir-rtl rotate-180" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommentsDrawer;
