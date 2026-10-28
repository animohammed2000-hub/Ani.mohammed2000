import React, { useState } from 'react';
import { Heart, MessageCircle } from 'lucide-react';

import type { Post } from '../lib/types';
import { supabase, supabaseConfigured } from '../lib/supabase';

export interface PostCardProps {
  post: Post;
  currentUserId: string;
  onRefresh: () => void;
  onOpenComments?: (postId: string) => void;
}

export default function PostCard({ post, currentUserId, onRefresh, onOpenComments }: PostCardProps) {
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

    try {
      if (!supabaseConfigured) {
        setLiked(prevLiked);
        setLikesCount(prevCount);
        return;
      }

      if (prevLiked) {
        const { error } = await supabase
          .from('likes')
          .delete()
          .eq('post_id', post.id)
          .eq('user_id', currentUserId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('likes')
          .insert({ post_id: post.id, user_id: currentUserId });

        if (error) throw error;
      }
    } catch (error) {
      console.error('Failed to toggle like', error);
      setLiked(prevLiked);
      setLikesCount(prevCount);
    } finally {
      setIsLikePending(false);
    }
  };

  const handleOpenComments = () => {
    if (onOpenComments) {
      onOpenComments(post.id);
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-white">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{post.author?.full_name || 'Post'}</div>
        <div className="text-xs text-zinc-400">{post.created_at ? new Date(post.created_at).toLocaleDateString() : ''}</div>
      </div>

      {post.content && <p className="mt-3 text-sm leading-6 text-zinc-200">{post.content}</p>}

      <div className="mt-4 flex items-center gap-3 text-zinc-300">
        <button
          type="button"
          onClick={toggleLike}
          disabled={isLikePending}
          className={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs transition ${
            liked ? 'bg-pink-500/15 text-pink-300' : 'bg-zinc-800 text-zinc-300'
          } ${isLikePending ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <Heart size={15} fill={liked ? 'currentColor' : 'none'} className={isAnimating ? 'animate-pulse' : ''} />
          {likesCount}
        </button>

        <button
          type="button"
          onClick={handleOpenComments}
          className="inline-flex items-center gap-2 rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-300 transition hover:bg-zinc-700"
        >
          <MessageCircle size={15} />
          {post.comments_count ?? 0}
        </button>
      </div>
    </div>
  );
}
