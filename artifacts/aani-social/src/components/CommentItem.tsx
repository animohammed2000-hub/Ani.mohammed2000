
import React, { useState } from 'react';
import { Heart, Reply, Sparkles, X } from 'lucide-react';
import type { CommentWithDetails } from '../lib/interactions';

interface CommentItemProps {
  comment: CommentWithDetails;
  currentUserId?: string;
  depth?: number;
  onReply: (comment: CommentWithDetails) => void;
  onToggleLike: (commentId: string, isLiked: boolean) => void;
}

const formatRelativeTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'الآن';

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} س`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ي`;
  const months = Math.floor(days / 30);
  return `${months} ش`;
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

/**
 * ترجمة نص التعليق إلى العربية.
 * لا تغيّر نص التعليق الأصلي ولا تحفظ الترجمة في قاعدة البيانات.
 */
async function translateCommentToArabic(text: string): Promise<string> {
  const sourceText = text.trim();

  if (!sourceText) {
    throw new Error('لا يوجد نص لترجمته');
  }

  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', sourceText);
  url.searchParams.set('langpair', 'autodetect|ar');

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error('تعذر الاتصال بخدمة الترجمة');
  }

  const data: {
    responseStatus?: number;
    responseDetails?: string;
    responseData?: {
      translatedText?: string;
    };
  } = await response.json();

  const translated = data.responseData?.translatedText?.trim();

  if (
    data.responseStatus !== 200 ||
    !translated ||
    translated.toLowerCase() === 'error'
  ) {
    throw new Error(data.responseDetails || 'تعذرت ترجمة التعليق');
  }

  return translated;
}

export const CommentItem: React.FC<CommentItemProps> = ({
  comment,
  depth = 0,
  onReply,
  onToggleLike,
}) => {
  const [showTranslated, setShowTranslated] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [showReplies, setShowReplies] = useState(true);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  const replyCount = comment.replies?.length ?? 0;
  const author = comment.profiles;
  const displayName = author?.full_name || 'مستخدم آني';
  const username = author?.username ? `@${author.username}` : '@user';

  const handleTranslation = async () => {
    if (isTranslating) return;

    if (showTranslated) {
      setShowTranslated(false);
      setTranslationError(null);
      return;
    }

    if (translatedText !== null) {
      setShowTranslated(true);
      setTranslationError(null);
      return;
    }

    setIsTranslating(true);
    setTranslationError(null);

    try {
      const result = await translateCommentToArabic(comment.content);
      setTranslatedText(result);
      setShowTranslated(true);
    } catch (error) {
      console.error('Comment translation failed:', error);
      setTranslationError(
        error instanceof Error
          ? error.message
          : 'تعذرت الترجمة، حاول مرة أخرى',
      );
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div className="relative">
      <div
        className="relative flex gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3 shadow-sm"
        style={{ marginRight: `${depth * 12}px` }}
      >
        {depth > 0 && (
          <div className="absolute bottom-0 top-0 right-[-6px] w-px bg-zinc-700/80" />
        )}

        <div className="flex shrink-0">
          {author?.avatar_url ? (
            <img
              src={author.avatar_url}
              alt={displayName}
              className="h-10 w-10 rounded-full object-cover ring-2 ring-zinc-800"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-violet-600 text-sm font-bold text-white ring-2 ring-zinc-800">
              {buildInitials(displayName)}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">
                {displayName}
              </p>
              <p className="text-[11px] text-zinc-400" dir="ltr">
                {username}
              </p>
            </div>

            <span className="shrink-0 text-[10px] text-zinc-500">
              {formatRelativeTime(comment.created_at)}
            </span>
          </div>

          <div className="mt-2 text-sm leading-7 text-zinc-200" dir="rtl">
            {showTranslated && translatedText !== null
              ? translatedText
              : comment.content}
          </div>

          {translationError && (
            <p
              role="status"
              className="mt-2 text-xs text-amber-400"
              dir="rtl"
            >
              {translationError}
            </p>
          )}

          {comment.image_url && (
            <button
              type="button"
              onClick={() => setExpandedImage(comment.image_url || null)}
              className="mt-3 block overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900"
            >
              <img
                src={comment.image_url}
                alt="مرفق التعليق"
                className="max-h-64 w-full object-cover transition hover:scale-[1.01]"
              />
            </button>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
            <button
              type="button"
              onClick={() => onToggleLike(comment.id, !!comment.is_liked)}
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition ${
                comment.is_liked
                  ? 'bg-pink-500/15 text-pink-300'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              <Heart
                size={14}
                fill={comment.is_liked ? 'currentColor' : 'none'}
              />
              {comment.likes_count ?? 0}
            </button>

            <button
              type="button"
              onClick={() => onReply(comment)}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-2 py-1 text-zinc-300 transition hover:bg-zinc-700"
            >
              <Reply size={14} />
              رد
            </button>

            <button
              type="button"
              onClick={handleTranslation}
              disabled={isTranslating}
              aria-busy={isTranslating}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-2 py-1 text-zinc-300 transition hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60"
            >
              <Sparkles size={14} />
              {isTranslating
                ? 'جارٍ الترجمة...'
                : showTranslated
                  ? 'نص أصلي'
                  : 'ترجمة'}
            </button>
          </div>
        </div>
      </div>

      {replyCount > 0 && (
        <div className="px-2 pt-2 text-right">
          <button
            type="button"
            onClick={() => setShowReplies((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-full bg-zinc-800/90 px-2.5 py-1 text-[10px] text-zinc-300"
          >
            {showReplies ? 'إخفاء' : 'عرض'} {replyCount} ردود
          </button>
        </div>
      )}

      {showReplies && replyCount > 0 && (
        <div className="relative mt-2 space-y-2 border-r border-zinc-700/80 pl-2">
          {comment.replies?.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              onReply={onReply}
              onToggleLike={onToggleLike}
            />
          ))}
        </div>
      )}

      {expandedImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setExpandedImage(null)}
        >
          <div className="relative max-h-[80vh] max-w-3xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-2">
            <button
              type="button"
              onClick={() => setExpandedImage(null)}
              className="absolute right-3 top-3 z-10 rounded-full bg-black/70 p-2 text-white"
              aria-label="إغلاق الصورة"
            >
              <X size={16} />
            </button>

            <img
              src={expandedImage}
              alt="صورة مكبرة"
              className="max-h-[80vh] max-w-full rounded-xl object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default CommentItem;
