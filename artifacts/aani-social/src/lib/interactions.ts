/**
 * Persistent interactions layer (likes, comments, reposts, shares, bookmarks, threaded comments).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";

import { supabase, supabaseConfigured } from "./supabase";
import { displayName, type Post, type Profile } from "./types";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type InteractionSnapshot = {
  likes: number;
  comments: number;
  reposts: number;
  shares: number;
  liked: boolean;
  bookmarked: boolean;
  reposted: boolean;
  shared: boolean;
  /** true once the counters/flags came back from the database */
  hydrated: boolean;
};

export type CommentAuthor = Partial<Profile> | null;

export type PostCommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  author: CommentAuthor;
};

export interface CommentWithDetails {
  id: string;
  post_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  image_url: string | null;
  created_at: string;
  profiles: {
    full_name: string;
    username: string;
    avatar_url: string | null;
  } | null;
  likes_count?: number;
  is_liked?: boolean;
  replies?: CommentWithDetails[];
}

type RawRow = Record<string, any>;

type LocalPostState = {
  liked?: boolean;
  bookmarked?: boolean;
  reposted?: boolean;
  shared?: boolean;
  likes?: number;
  reposts?: number;
  shares?: number;
  comments?: number;
};

type LocalFlags = Record<string, LocalPostState>;

type LocalComment = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  author: Partial<Profile> | null;
};

const EMPTY_SNAPSHOT: InteractionSnapshot = {
  likes: 0,
  comments: 0,
  reposts: 0,
  shares: 0,
  liked: false,
  bookmarked: false,
  reposted: false,
  shared: false,
  hydrated: false,
};

/* ------------------------------------------------------------------ */
/* Shared store                                                        */
/* ------------------------------------------------------------------ */

const cache = new Map<string, InteractionSnapshot>();
const listeners = new Set<() => void>();
const pendingWrites = new Map<string, number>();
const directHydration = new Map<string, number>();
const HYDRATION_TTL_MS = 20_000;
let version = 0;

function keyOf(postId: string, userId: string): string {
  return `${userId}:${postId}`;
}

function emit(): void {
  version += 1;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error("interaction listener failed", error);
    }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isPending(postId: string, userId: string): boolean {
  return (pendingWrites.get(keyOf(postId, userId)) ?? 0) > 0;
}

function markPending(postId: string, userId: string, delta: number): void {
  const key = keyOf(postId, userId);
  const next = (pendingWrites.get(key) ?? 0) + delta;
  if (next <= 0) pendingWrites.delete(key);
  else pendingWrites.set(key, next);
}

function readCache(
  postId: string,
  userId: string,
): InteractionSnapshot | undefined {
  return cache.get(keyOf(postId, userId));
}

function patchCache(
  postId: string,
  userId: string,
  patch: Partial<InteractionSnapshot>,
): void {
  const key = keyOf(postId, userId);
  const current = cache.get(key) ?? { ...EMPTY_SNAPSHOT };
  const next: InteractionSnapshot = { ...current, ...patch };
  if (
    next.likes === current.likes &&
    next.comments === current.comments &&
    next.reposts === current.reposts &&
    next.shares === current.shares &&
    next.liked === current.liked &&
    next.bookmarked === current.bookmarked &&
    next.reposted === current.reposted &&
    next.shared === current.shared &&
    next.hydrated === current.hydrated
  ) {
    return;
  }
  cache.set(key, next);
  emit();
}

export function snapshotFromPost(
  post: Post,
  userId: string,
): InteractionSnapshot {
  const existing = readCache(post.id, userId);
  const local = readLocalFlags(userId)[post.id] ?? {};
  return {
    likes: localNumber(local.likes, post.likes_count, existing?.likes ?? 0),
    comments: localNumber(
      local.comments,
      post.comments_count,
      existing?.comments ?? 0,
    ),
    reposts: localNumber(
      local.reposts,
      post.reposts_count,
      existing?.reposts ?? 0,
    ),
    shares: localNumber(local.shares, post.shares_count, existing?.shares ?? 0),
    liked: local.liked ?? post.liked_by_me ?? existing?.liked ?? false,
    bookmarked:
      local.bookmarked ?? post.saved_by_me ?? existing?.bookmarked ?? false,
    reposted:
      local.reposted ?? post.reposted_by_me ?? existing?.reposted ?? false,
    shared: local.shared ?? existing?.shared ?? false,
    hydrated: existing?.hydrated ?? false,
  };
}

function localNumber(
  local: number | undefined,
  server: number | undefined,
  fallback: number,
): number {
  if (typeof server === "number" && Number.isFinite(server)) return server;
  if (typeof local === "number" && Number.isFinite(local)) return local;
  return fallback;
}

export function readInteractionState(
  post: Post,
  userId: string,
): InteractionSnapshot {
  return readCache(post.id, userId) ?? snapshotFromPost(post, userId);
}

function stateOf(
  postId: string,
  userId: string,
  fallback: Partial<InteractionSnapshot> = {},
): InteractionSnapshot {
  return (
    readCache(postId, userId) ?? {
      ...EMPTY_SNAPSHOT,
      ...fallback,
    }
  );
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

/* ------------------------------------------------------------------ */
/* Local fallback                                                      */
/* ------------------------------------------------------------------ */

const localFlagCache = new Map<string, LocalFlags>();

function localKey(userId: string): string {
  return `aani:interactions:${userId}`;
}

export function readLocalFlags(userId: string): LocalFlags {
  if (!userId) return {};
  const cached = localFlagCache.get(userId);
  if (cached) return cached;

  let parsed: LocalFlags = {};
  try {
    const raw = window.localStorage.getItem(localKey(userId));
    if (raw) {
      const value = JSON.parse(raw) as unknown;
      if (value && typeof value === "object") parsed = value as LocalFlags;
    }
  } catch {
    parsed = {};
  }
  localFlagCache.set(userId, parsed);
  return parsed;
}

function writeLocalFlag(
  userId: string,
  postId: string,
  patch: LocalPostState,
): void {
  const all = { ...readLocalFlags(userId) };
  all[postId] = { ...(all[postId] ?? {}), ...patch };
  localFlagCache.set(userId, all);
  try {
    window.localStorage.setItem(localKey(userId), JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

const LOCAL_COMMENTS_KEY = "aani:comments:v1";

function readLocalComments(postId: string): LocalComment[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_COMMENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, LocalComment[]>;
    return Array.isArray(parsed[postId]) ? parsed[postId] : [];
  } catch {
    return [];
  }
}

function writeLocalComments(postId: string, comments: LocalComment[]): void {
  try {
    const raw = window.localStorage.getItem(LOCAL_COMMENTS_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Record<string, LocalComment[]>)
      : {};
    parsed[postId] = comments;
    window.localStorage.setItem(LOCAL_COMMENTS_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

function isMissingRelation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string; details?: string };
  const code = candidate.code ?? "";
  const message = `${candidate.message ?? ""} ${candidate.details ?? ""}`;
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    code === "42501" ||
    /does not exist|schema cache|could not find the table|permission denied/i.test(
      message,
    )
  );
}

/* ------------------------------------------------------------------ */
/* Hydration & Decorate                                                */
/* ------------------------------------------------------------------ */

type Summary = {
  postId: string;
  likes?: number;
  comments?: number;
  reposts?: number;
  shares?: number;
  liked?: boolean;
  bookmarked?: boolean;
  reposted?: boolean;
  shared?: boolean;
};

function mapSummaryRow(row: RawRow): Summary {
  return {
    postId: String(row.post_id ?? row.postId ?? ""),
    likes: optionalNumber(row.like_count ?? row.likes_count ?? row.likes),
    comments: optionalNumber(
      row.comment_count ?? row.comments_count ?? row.comments,
    ),
    reposts: optionalNumber(
      row.repost_count ?? row.reposts_count ?? row.reposts,
    ),
    shares: optionalNumber(row.share_count ?? row.shares_count ?? row.shares),
    liked: optionalBool(row.liked ?? row.liked_by_me),
    bookmarked: optionalBool(row.bookmarked ?? row.saved_by_me),
    reposted: optionalBool(row.reposted ?? row.reposted_by_me),
    shared: optionalBool(row.shared ?? row.shared_by_me),
  };
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function optionalBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

async function fetchSummaries(
  postIds: string[],
  userId: string,
): Promise<Map<string, Summary> | null> {
  if (!supabaseConfigured || postIds.length === 0) return null;
  try {
    const { data, error } = await supabase.rpc("post_interaction_summaries", {
      post_ids: postIds,
    });
    if (error || !Array.isArray(data)) return null;

    const map = new Map<string, Summary>();
    (data as RawRow[]).forEach((row) => {
      const summary = mapSummaryRow(row);
      if (summary.postId) map.set(summary.postId, summary);
    });

    if (map.size < postIds.length) {
      const fallback = await fetchFallbackSummaries(postIds, userId);
      fallback.forEach((value, key) => {
        if (!map.has(key)) map.set(key, value);
      });
    }
    return map;
  } catch {
    return null;
  }
}

async function fetchFallbackSummaries(
  postIds: string[],
  userId: string,
): Promise<Map<string, Summary>> {
  const summaries = new Map<string, Summary>();
  postIds.forEach((id) => summaries.set(id, { postId: id }));

  if (!supabaseConfigured || postIds.length === 0) return summaries;

  const [likes, comments, reposts, bookmarks, shares, rows] = await Promise.all([
    supabase.from("likes").select("post_id,user_id").in("post_id", postIds).limit(20000),
    supabase.from("comments").select("post_id").in("post_id", postIds).limit(20000),
    supabase.from("reposts").select("post_id,user_id").in("post_id", postIds).limit(20000),
    supabase.from("bookmarks").select("post_id,user_id").in("post_id", postIds).limit(20000),
    supabase.from("post_shares").select("post_id,user_id").in("post_id", postIds).limit(20000),
    supabase.from("posts").select("*").in("id", postIds),
  ]);

  const likeCounts = countByPost(likes.data);
  const commentCounts = countByPost(comments.data);

  const counters = new Map<string, RawRow>();
  ((rows.data ?? []) as RawRow[]).forEach((row) => {
    counters.set(String(row.id), row);
  });

  const likeRows = (likes.data ?? []) as RawRow[];
  const bookmarkRows = (bookmarks.data ?? []) as RawRow[];
  const repostRows = (reposts.data ?? []) as RawRow[];
  const shareRows = (shares.data ?? []) as RawRow[];

  postIds.forEach((postId) => {
    const summary = summaries.get(postId) ?? { postId };
    const row = counters.get(postId);

    summary.likes = toNumber(row?.likes_count, likeCounts.get(postId) ?? 0);
    summary.comments = toNumber(
      row?.comments_count,
      commentCounts.get(postId) ?? 0,
    );
    summary.reposts = toNumber(row?.reposts_count, 0);
    summary.shares = toNumber(row?.shares_count, 0);
    summary.liked = likeRows.some(
      (like) => like.post_id === postId && like.user_id === userId,
    );
    summary.bookmarked = bookmarkRows.some(
      (bookmark) =>
        bookmark.post_id === postId && bookmark.user_id === userId,
    );
    summary.reposted = repostRows.some(
      (repost) => repost.post_id === postId && repost.user_id === userId,
    );
    summary.shared = shareRows.some(
      (share) => share.post_id === postId && share.user_id === userId,
    );
    summaries.set(postId, summary);
  });

  return summaries;
}

function countByPost(rows: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  if (!Array.isArray(rows)) return counts;
  (rows as RawRow[]).forEach((row) => {
    const id = String(row.post_id ?? "");
    if (!id) return;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  });
  return counts;
}

function applySummary(summary: Summary, userId: string): void {
  if (!summary.postId) return;
  if (isPending(summary.postId, userId)) return;

  const local = readLocalFlags(userId)[summary.postId] ?? {};
  const current = stateOf(summary.postId, userId);
  patchCache(summary.postId, userId, {
    likes: summary.likes ?? current.likes,
    comments: summary.comments ?? current.comments,
    reposts: summary.reposts ?? current.reposts,
    shares: summary.shares ?? current.shares,
    liked: summary.liked ?? current.liked,
    bookmarked: summary.bookmarked ?? local.bookmarked ?? current.bookmarked,
    reposted: summary.reposted ?? local.reposted ?? current.reposted,
    shared: summary.shared ?? local.shared ?? current.shared,
    hydrated: true,
  });
}

export async function hydratePosts(
  posts: Post[],
  userId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!userId || posts.length === 0) return;

  const ids = posts
    .map((post) => post.id)
    .filter((id) => {
      if (options.force) return true;
      const hydratedAt = directHydration.get(keyOf(id, userId));
      return !hydratedAt || Date.now() - hydratedAt > HYDRATION_TTL_MS;
    });

  ids.forEach((id) => directHydration.set(keyOf(id, userId), Date.now()));
  const targets = ids.length > 0 ? ids : posts.map((post) => post.id);

  const summaries = await fetchSummaries(targets, userId);
  if (summaries) {
    summaries.forEach((summary) => applySummary(summary, userId));
    return;
  }

  const fallback = await fetchFallbackSummaries(targets, userId);
  fallback.forEach((summary) => applySummary(summary, userId));
}

export async function hydratePostIds(
  postIds: string[],
  userId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!userId || postIds.length === 0) return;
  const ids = Array.from(new Set(postIds)).filter(Boolean);

  const summaries = await fetchSummaries(ids, userId);
  if (summaries) {
    summaries.forEach((summary) => applySummary(summary, userId));
    return;
  }

  const { data } = await supabase.from("posts").select("*").in("id", ids);
  const rows = (data ?? []) as RawRow[];
  const posts = rows.map((row) => ({
    id: String(row.id),
    user_id: String(row.user_id ?? ""),
    content: String(row.content ?? ""),
    media_url: (row.media_url as string | null) ?? null,
    type: (row.type as Post["type"]) ?? "text",
    created_at: String(row.created_at ?? new Date().toISOString()),
    author: null,
    likes_count: optionalNumber(row.likes_count),
    comments_count: optionalNumber(row.comments_count),
    reposts_count: optionalNumber(row.reposts_count),
    shares_count: optionalNumber(row.shares_count),
  })) as Post[];

  if (posts.length > 0) await hydratePosts(posts, userId, options);
}

export async function decoratePosts(
  rows: RawRow[],
  userId: string,
): Promise<Post[]> {
  if (!rows || rows.length === 0) return [];

  const authorIds = Array.from(
    new Set(rows.map((row) => String(row.user_id ?? "")).filter(Boolean)),
  );
  const reposterIds = Array.from(
    new Set(rows.map((row) => String(row.reposter_id ?? "")).filter(Boolean)),
  );
  const profileIds = Array.from(new Set([...authorIds, ...reposterIds]));

  let profiles: Profile[] = [];
  if (supabaseConfigured && profileIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id,username,full_name,display_name,avatar_url,bio")
      .in("id", profileIds);
    profiles = (data ?? []) as Profile[];
  }
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));

  const posts: Post[] = rows.map((row) => ({
    id: String(row.id),
    user_id: String(row.user_id ?? ""),
    content: String(row.content ?? ""),
    media_url: (row.media_url as string | null) ?? null,
    media_urls: (row.media_urls as string[] | null) ?? null,
    type: (row.type as Post["type"]) ?? "text",
    created_at: String(row.created_at ?? new Date().toISOString()),
    author: byId.get(String(row.user_id ?? "")) ?? null,
    likes_count: optionalNumber(row.likes_count),
    comments_count: optionalNumber(row.comments_count),
    reposts_count: optionalNumber(row.reposts_count),
    shares_count: optionalNumber(row.shares_count),
    reposted_at: (row.reposted_at as string | null) ?? null,
    repost_attribution: row.reposter_id
      ? (byId.get(String(row.reposter_id)) ?? null)
      : null,
    comments_disabled: row.comments_disabled === true,
    audio_url: (row.audio_url as string | null) ?? null,
    audio_title: (row.audio_title as string | null) ?? null,
  }));

  await hydratePosts(posts, userId);
  return posts.map((post) => decoratePost(post, userId));
}

export function decoratePost(post: Post, userId: string): Post {
  const state = readCache(post.id, userId) ?? snapshotFromPost(post, userId);
  return {
    ...post,
    likes_count: state.likes,
    comments_count: state.comments,
    reposts_count: state.reposts,
    shares_count: state.shares,
    liked_by_me: state.liked,
    saved_by_me: state.bookmarked,
    reposted_by_me: state.reposted,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export async function toggleLike(post: Post, userId: string): Promise<void> {
  if (isPending(post.id, userId)) return;

  const before = readInteractionState(post, userId);
  const liked = !before.liked;
  const likes = Math.max(0, before.likes + (liked ? 1 : -1));
  markPending(post.id, userId, 1);
  patchCache(post.id, userId, { liked, likes });

  if (!supabaseConfigured) {
    writeLocalFlag(userId, post.id, { liked, likes });
    markPending(post.id, userId, -1);
    return;
  }

  try {
    const { error } = liked
      ? await supabase.from("likes").insert({ post_id: post.id, user_id: userId })
      : await supabase.from("likes").delete().eq("post_id", post.id).eq("user_id", userId);

    if (error && error.code !== "23505") {
      patchCache(post.id, userId, { liked: before.liked, likes: before.likes });
      writeLocalFlag(userId, post.id, { liked: before.liked, likes: before.likes });
      toast.error("تعذر حفظ الإعجاب، تحقق من الاتصال وحاول مجدداً");
      return;
    }

    writeLocalFlag(userId, post.id, { liked, likes });
  } catch {
    patchCache(post.id, userId, { liked: before.liked, likes: before.likes });
    toast.error("تعذر حفظ الإعجاب، تحقق من الاتصال وحاول مجدداً");
    return;
  } finally {
    markPending(post.id, userId, -1);
  }

  await hydratePostIds([post.id], userId, { force: true });
}

export async function toggleBookmark(post: Post, userId: string): Promise<void> {
  const before = readInteractionState(post, userId);
  const bookmarked = !before.bookmarked;
  markPending(post.id, userId, 1);
  patchCache(post.id, userId, { bookmarked });

  try {
    if (!supabaseConfigured) {
      writeLocalFlag(userId, post.id, { bookmarked });
      toast.warning("تم الحفظ على هذا الجهاز فقط (قاعدة البيانات غير مهيأة)");
      return;
    }

    const { error } = bookmarked
      ? await supabase.from("bookmarks").insert({ post_id: post.id, user_id: userId })
      : await supabase.from("bookmarks").delete().eq("post_id", post.id).eq("user_id", userId);

    if (error && error.code !== "23505") {
      if (isMissingRelation(error)) {
        writeLocalFlag(userId, post.id, { bookmarked });
        toast.warning("تم حفظ المنشور على هذا الجهاز.");
        return;
      }
      patchCache(post.id, userId, { bookmarked: before.bookmarked });
      toast.error("تعذر حفظ المنشور، حاول مرة أخرى");
      return;
    }

    writeLocalFlag(userId, post.id, { bookmarked });
    toast.success(bookmarked ? "تم حفظ المنشور في المحفوظات" : "تمت إزالة المنشور من المحفوظات");
  } finally {
    markPending(post.id, userId, -1);
  }

  await hydratePostIds([post.id], userId, { force: true });
}

export async function toggleRepost(post: Post, userId: string): Promise<void> {
  const before = readInteractionState(post, userId);
  const reposted = !before.reposted;
  markPending(post.id, userId, 1);
  patchCache(post.id, userId, {
    reposted,
    reposts: Math.max(0, before.reposts + (reposted ? 1 : -1)),
  });

  let stored = false;
  try {
    if (!supabaseConfigured) {
      writeLocalFlag(userId, post.id, { reposted });
      toast.warning("تم تسجيل إعادة النشر على هذا الجهاز فقط");
      return;
    }

    const { error } = reposted
      ? await supabase.from("reposts").insert({ post_id: post.id, user_id: userId })
      : await supabase.from("reposts").delete().eq("post_id", post.id).eq("user_id", userId);

    if (error && error.code !== "23505") {
      if (isMissingRelation(error)) {
        writeLocalFlag(userId, post.id, { reposted });
        toast.warning("تم تسجيل إعادة النشر على هذا الجهاز.");
        return;
      }
      patchCache(post.id, userId, { reposted: before.reposted, reposts: before.reposts });
      toast.error("تعذر إعادة النشر، حاول مرة أخرى");
      return;
    }

    stored = true;
    writeLocalFlag(userId, post.id, { reposted });
    toast.success(reposted ? "تمت إعادة نشر المنشور" : "تمت إزالة إعادة النشر");
  } finally {
    markPending(post.id, userId, -1);
  }

  if (stored) await hydratePostIds([post.id], userId, { force: true });
}

export function buildPostUrl(postId: string): string {
  if (typeof window === "undefined") return `/post/${postId}`;
  const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  return `${window.location.origin}${base}/post/${postId}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export function postShareUrl(postId: string): string {
  return buildPostUrl(postId);
}

export function postShareText(post: Post): string {
  const excerpt = (post.content ?? "").trim().replace(/\s+/g, " ");
  if (!excerpt) return `منشور ${displayName(post.author)} على آني`;
  return excerpt.length > 140 ? `${excerpt.slice(0, 139)}…` : excerpt;
}

export async function recordShare(post: Post, userId: string): Promise<boolean> {
  const before = readInteractionState(post, userId);

  if (before.shared) {
    patchCache(post.id, userId, { shared: true });
    return true;
  }

  const shares = before.shares + 1;
  patchCache(post.id, userId, { shared: true, shares });
  writeLocalFlag(userId, post.id, { shared: true, shares });

  if (!supabaseConfigured || !userId) return false;

  try {
    const { error } = await supabase
      .from("post_shares")
      .insert({ post_id: post.id, user_id: userId });
    const persisted = !error || error.code === "23505" || isMissingRelation(error);
    if (persisted) {
      void hydratePostIds([post.id], userId, { force: true });
    } else {
      patchCache(post.id, userId, { shares: before.shares });
    }
    return persisted;
  } catch {
    patchCache(post.id, userId, { shares: before.shares });
    return false;
  }
}

export async function createComment(
  post: Post,
  userId: string,
  content: string,
): Promise<PostCommentRow | null> {
  const trimmed = content.trim();
  if (!trimmed) return null;

  markPending(post.id, userId, 1);
  const before = readInteractionState(post, userId);
  patchCache(post.id, userId, { comments: before.comments + 1 });

  if (!supabaseConfigured) {
    const local: LocalComment = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      post_id: post.id,
      user_id: userId,
      content: trimmed,
      created_at: new Date().toISOString(),
      author: null,
    };
    const existing = readLocalComments(post.id);
    writeLocalComments(post.id, [...existing, local]);
    writeLocalFlag(userId, post.id, { comments: before.comments + 1 });
    markPending(post.id, userId, -1);
    return local;
  }

  try {
    const { data, error } = await supabase
      .from("comments")
      .insert({ post_id: post.id, user_id: userId, content: trimmed })
      .select("id, post_id, user_id, content, created_at")
      .maybeSingle();

    if (error || !data) {
      patchCache(post.id, userId, { comments: before.comments });
      toast.error("تعذر نشر التعليق، حاول مرة أخرى");
      return null;
    }

    return normalizeComment(data);
  } catch {
    patchCache(post.id, userId, { comments: before.comments });
    toast.error("تعذر نشر التعليق، حاول مرة أخرى");
    return null;
  } finally {
    markPending(post.id, userId, -1);
    void hydratePostIds([post.id], userId, { force: true });
  }
}

export async function deleteComment(
  post: Post,
  userId: string,
  commentId: string,
): Promise<boolean> {
  if (!supabaseConfigured) {
    const remaining = readLocalComments(post.id).filter(
      (item) => item.id !== commentId,
    );
    writeLocalComments(post.id, remaining);
    const before = readInteractionState(post, userId);
    const comments = Math.max(0, before.comments - 1);
    patchCache(post.id, userId, { comments });
    writeLocalFlag(userId, post.id, { comments });
    return true;
  }
  markPending(post.id, userId, 1);
  const before = readInteractionState(post, userId);
  patchCache(post.id, userId, {
    comments: Math.max(0, before.comments - 1),
  });

  try {
    const { error } = await supabase
      .from("comments")
      .delete()
      .eq("id", commentId)
      .eq("user_id", userId);
    if (error) {
      patchCache(post.id, userId, { comments: before.comments });
      toast.error("تعذر حذف التعليق");
      return false;
    }
    toast.success("تم حذف التعليق");
    return true;
  } catch {
    patchCache(post.id, userId, { comments: before.comments });
    toast.error("تعذر حذف التعليق");
    return false;
  } finally {
    markPending(post.id, userId, -1);
  }
}

/* ------------------------------------------------------------------ */
/* Threaded Comments & Interactions (New Extensions)                  */
/* ------------------------------------------------------------------ */

export async function fetchCommentsWithReplies(
  postId: string,
  currentUserId?: string
): Promise<CommentWithDetails[]> {
  if (!supabaseConfigured || !postId) return [];

  const { data: comments, error } = await supabase
    .from('comments')
    .select(`
      *,
      profiles (
        full_name,
        username,
        avatar_url
      )
    `)
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error || !comments) {
    console.error('Error fetching comments:', error);
    return [];
  }

  const commentIds = comments.map((c) => c.id);

  let likes: { comment_id: string; user_id: string }[] = [];
  if (commentIds.length > 0) {
    const { data: likesData } = await supabase
      .from('comment_likes')
      .select('comment_id, user_id')
      .in('comment_id', commentIds);
    likes = (likesData as { comment_id: string; user_id: string }[]) || [];
  }

  const likesMap = new Map<string, { count: number; isLiked: boolean }>();
  likes.forEach((l) => {
    const current = likesMap.get(l.comment_id) || { count: 0, isLiked: false };
    likesMap.set(l.comment_id, {
      count: current.count + 1,
      isLiked: current.isLiked || (currentUserId ? l.user_id === currentUserId : false),
    });
  });

  const formatted: CommentWithDetails[] = comments.map((c: RawRow) => ({
    id: String(c.id),
    post_id: String(c.post_id),
    user_id: String(c.user_id),
    parent_id: c.parent_id ? String(c.parent_id) : null,
    content: String(c.content ?? ''),
    image_url: c.image_url ? String(c.image_url) : null,
    created_at: String(c.created_at ?? new Date().toISOString()),
    profiles: c.profiles ? {
      full_name: String(c.profiles.full_name ?? ''),
      username: String(c.profiles.username ?? ''),
      avatar_url: c.profiles.avatar_url ? String(c.profiles.avatar_url) : null,
    } : null,
    likes_count: likesMap.get(c.id)?.count || 0,
    is_liked: likesMap.get(c.id)?.isLiked || false,
    replies: [],
  }));

  const rootComments: CommentWithDetails[] = [];
  const map = new Map<string, CommentWithDetails>();

  formatted.forEach((item) => map.set(item.id, item));
  formatted.forEach((item) => {
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id)!.replies!.push(item);
    } else {
      rootComments.push(item);
    }
  });

  return rootComments;
}

export async function toggleCommentLike(
  commentId: string,
  userId: string,
  commentOwnerId: string,
  isLiked: boolean
): Promise<void> {
  if (!supabaseConfigured) return;

  if (isLiked) {
    await supabase
      .from('comment_likes')
      .delete()
      .eq('comment_id', commentId)
      .eq('user_id', userId);
  } else {
    await supabase
      .from('comment_likes')
      .upsert(
        { comment_id: commentId, user_id: userId },
        {
          onConflict: 'comment_id,user_id',
          ignoreDuplicates: true,
        },
      );
  }
}

export async function uploadCommentImage(file: File): Promise<string | null> {
  if (!supabaseConfigured) return null;

  const fileExt = file.name.split('.').pop();
  const filePath = `comment_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;
  const { error } = await supabase.storage
    .from('comment-attachments')
    .upload(filePath, file);

  if (error) {
    console.error('Error uploading comment image:', error);
    return null;
  }

  const { data } = supabase.storage
    .from('comment-attachments')
    .getPublicUrl(filePath);

  return data.publicUrl;
}

export async function translateText(text: string, targetLang = 'ar'): Promise<string> {
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=Autodetect|${targetLang}`
    );
    const data = await res.json();
    return data.responseData?.translatedText || text;
  } catch {
    return text;
  }
}

/* ------------------------------------------------------------------ */
/* Realtime Subscription & Hooks                                       */
/* ------------------------------------------------------------------ */

const dirtyPosts = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleHydration(userId: string): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const ids = Array.from(dirtyPosts);
    dirtyPosts.clear();
    if (ids.length > 0) void hydratePostIds(ids, userId, { force: true });
  }, 450);
}

function handleChange(
  payload: RealtimePostgresChangesPayload<RawRow>,
  userId: string,
): void {
  const record = (payload.new ?? payload.old ?? {}) as RawRow;
  const postId = record.post_id ? String(record.post_id) : "";
  if (!postId) return;
  dirtyPosts.add(postId);
  scheduleHydration(userId);
}

function handlePostUpdate(
  payload: RealtimePostgresChangesPayload<RawRow>,
  userId: string,
): void {
  const row = (payload.new ?? {}) as RawRow;
  const postId = row.id ? String(row.id) : "";
  if (!postId || isPending(postId, userId)) return;

  const likes = optionalNumber(row.likes_count);
  const comments = optionalNumber(row.comments_count);
  const reposts = optionalNumber(row.reposts_count);
  const shares = optionalNumber(row.shares_count);

  if (
    likes === undefined &&
    comments === undefined &&
    reposts === undefined &&
    shares === undefined
  ) {
    return;
  }

  patchCache(postId, userId, {
    likes: likes ?? stateOf(postId, userId).likes,
    comments: comments ?? stateOf(postId, userId).comments,
    reposts: reposts ?? stateOf(postId, userId).reposts,
    shares: shares ?? stateOf(postId, userId).shares,
  });
}

let realtimeChannel: RealtimeChannel | null = null;
let realtimeRefs = 0;
let realtimeUserId: string | null = null;

function buildChannel(userId: string): RealtimeChannel {
  let channel = supabase.channel(`aani-interactions-${userId}`);

  (["likes", "comments", "reposts", "bookmarks", "post_shares", "comment_likes"] as const).forEach(
    (table) => {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => handleChange(payload as RealtimePostgresChangesPayload<RawRow>, userId),
      );
    },
  );

  channel = channel.on(
    "postgres_changes",
    { event: "UPDATE", schema: "public", table: "posts" },
    (payload) =>
      handlePostUpdate(
        payload as RealtimePostgresChangesPayload<RawRow>,
        userId,
      ),
  );

  channel.subscribe((status) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.warn(`[interactions] realtime channel ${status}`);
    }
  });

  return channel;
}

export function useInteractionRealtime(userId: string | null | undefined): void {
  useEffect(() => {
    if (!supabaseConfigured || !userId) return;

    if (realtimeChannel && realtimeUserId !== userId) {
      void supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
      realtimeRefs = 0;
    }

    realtimeRefs += 1;
    if (!realtimeChannel) {
      realtimeUserId = userId;
      realtimeChannel = buildChannel(userId);
    }

    return () => {
      realtimeRefs -= 1;
      if (realtimeRefs <= 0) {
        if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
        realtimeUserId = null;
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        dirtyPosts.clear();
      }
    };
  }, [userId]);
}

export function useInteractionsVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}

export type PostInteractions = InteractionSnapshot & {
  pending: boolean;
  toggleLike: () => Promise<void>;
  toggleBookmark: () => Promise<void>;
  toggleRepost: () => Promise<void>;
  share: () => Promise<void>;
};

export function usePostInteractions(
  post: Post,
  userId: string,
): PostInteractions {
  const key = keyOf(post.id, userId);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => cache.get(key) ?? null,
    () => null,
  );

  const seeded = useRef<string>("");
  useEffect(() => {
    if (seeded.current === key) return;
    seeded.current = key;
    if (!cache.has(key)) {
      patchCache(post.id, userId, snapshotFromPost(post, userId));
    }
    void hydratePosts([post], userId);
  }, [key, post, userId]);

  const state = snapshot ?? snapshotFromPost(post, userId);

  const onLike = useCallback(() => toggleLike(post, userId), [post, userId]);
  const onBookmark = useCallback(
    () => toggleBookmark(post, userId),
    [post, userId],
  );
  const onRepost = useCallback(async () => {
    await toggleRepost(post, userId);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("aani:repost-changed"));
    }
  }, [post, userId]);
  const onShare = useCallback(() => recordShare(post, userId).then(() => {}), [post, userId]);

  return {
    ...state,
    pending: isPending(post.id, userId),
    toggleLike: onLike,
    toggleBookmark: onBookmark,
    toggleRepost: onRepost,
    share: onShare,
  };
}

function normalizeComment(row: RawRow): PostCommentRow {
  return {
    id: String(row.id),
    post_id: String(row.post_id ?? ""),
    user_id: String(row.user_id ?? ""),
    content: String(row.content ?? ""),
    created_at: String(row.created_at ?? new Date().toISOString()),
    author:
      (row.author as CommentAuthor) ??
      (row.profiles as CommentAuthor) ??
      null,
  };
}

const COMMENT_SELECT =
  "id, post_id, user_id, content, created_at, author:profiles(id,username,full_name,display_name,avatar_url,bio)";

export type PostComments = {
  comments: PostCommentRow[] | null;
  loading: boolean;
  sending: boolean;
  error: string | null;
  load: () => Promise<void>;
  add: (content: string) => Promise<boolean>;
  remove: (commentId: string) => Promise<void>;
};

export function usePostComments(
  post: Post,
  userId: string,
  profile: Profile | null,
  enabled: boolean,
): PostComments {
  const [comments, setComments] = useState<PostCommentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!supabaseConfigured) {
      const rows = readLocalComments(post.id).map((row) => ({
        ...row,
        author: row.user_id === userId ? (profile ?? row.author) : row.author,
      }));
      setComments(rows);
      setError(null);
      if (!isPending(post.id, userId)) {
        patchCache(post.id, userId, { comments: rows.length });
      }
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: loadError } = await supabase
        .from("comments")
        .select(COMMENT_SELECT)
        .eq("post_id", post.id)
        .order("created_at", { ascending: true });

      if (loadError) {
        setError("تعذر تحميل التعليقات");
        setComments((previous) => previous ?? []);
        return;
      }

      const rows = ((data ?? []) as RawRow[]).map(normalizeComment);
      setComments(rows);

      if (!isPending(post.id, userId)) {
        patchCache(post.id, userId, { comments: rows.length, hydrated: true });
      }
    } catch {
      setError("تعذر تحميل التعليقات");
    } finally {
      setLoading(false);
    }
  }, [post.id, userId, profile]);

  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    void load();
  }, [enabled, load]);

  useEffect(() => {
    loadedRef.current = false;
    setComments(null);
    setError(null);
  }, [post.id]);

  useEffect(() => {
    if (!enabled || !supabaseConfigured) return;
    const channel = supabase
      .channel(`aani-comments-${post.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "comments",
          filter: `post_id=eq.${post.id}`,
        },
        (payload) => {
          const record = (payload.new ?? payload.old ?? {}) as RawRow;
          const id = record.id ? String(record.id) : "";
          if (!id) return;

          if (payload.eventType === "DELETE") {
            setComments((previous) =>
              previous ? previous.filter((item) => item.id !== id) : previous,
            );
            return;
          }

          if (payload.eventType === "INSERT") {
            setComments((previous) => {
              if (!previous || previous.some((item) => item.id === id)) {
                return previous;
              }
              return [...previous, { ...normalizeComment(record), author: null }];
            });
            void supabase
              .from("comments")
              .select(COMMENT_SELECT)
              .eq("id", id)
              .maybeSingle()
              .then(({ data }) => {
                if (!data) return;
                const withAuthor = normalizeComment(data as RawRow);
                setComments((previous) =>
                  previous
                    ? previous.map((item) =>
                        item.id === id ? withAuthor : item,
                      )
                    : previous,
                );
              });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, post.id]);

  const add = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return false;

      const tempId = `temp-${Date.now()}`;
      const optimistic: PostCommentRow = {
        id: tempId,
        post_id: post.id,
        user_id: userId,
        content: trimmed,
        created_at: new Date().toISOString(),
        author: profile,
      };
      setComments((previous) => [...(previous ?? []), optimistic]);
      setSending(true);

      const row = await createComment(post, userId, trimmed);

      setSending(false);
      if (!row) {
        setComments((previous) =>
          previous ? previous.filter((item) => item.id !== tempId) : previous,
        );
        return false;
      }

      setComments((previous) => {
        const list = previous ?? [];
        const withoutTemp = list.filter((item) => item.id !== tempId);
        return withoutTemp.some((item) => item.id === row.id)
          ? withoutTemp
          : [...withoutTemp, { ...row, author: profile }];
      });
      return true;
    },
    [post, profile, userId],
  );

  const remove = useCallback(
    async (commentId: string) => {
      const previous = comments;
      setComments((current) =>
        current ? current.filter((item) => item.id !== commentId) : current,
      );
      const ok = await deleteComment(post, userId, commentId);
      if (!ok) setComments(previous);
    },
    [comments, post, userId],
  );

  return { comments, loading, sending, error, load, add, remove };
}

/* ------------------------------------------------------------------ */
/* Saved (bookmarks)                                                   */
/* ------------------------------------------------------------------ */

export type SavedPostsState = {
  posts: Post[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useSavedPosts(userId: string): SavedPostsState {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let ids: string[] = [];

      if (supabaseConfigured) {
        const { data, error: bookmarksError } = await supabase
          .from("bookmarks")
          .select("post_id, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (bookmarksError) {
          if (!isMissingRelation(bookmarksError)) {
            setError("تعذر تحميل المحفوظات");
          }
        } else {
          ids = ((data ?? []) as RawRow[]).map((row) => String(row.post_id));
        }
      }

      const local = readLocalFlags(userId);
      Object.entries(local).forEach(([postId, flags]) => {
        if (flags.bookmarked && !ids.includes(postId)) ids.push(postId);
      });

      if (ids.length === 0) {
        setPosts([]);
        return;
      }

      if (!supabaseConfigured) {
        setPosts([]);
        return;
      }

      const { data: rows, error: postsError } = await supabase
        .from("posts")
        .select("*")
        .in("id", ids);

      if (postsError) {
        setError("تعذر تحميل المنشورات المحفوظة");
        setPosts([]);
        return;
      }

      const decorated = await decoratePosts((rows ?? []) as RawRow[], userId);
      const order = new Map(ids.map((id, index) => [id, index]));
      decorated.sort(
        (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
      );
      setPosts(decorated);
    } catch {
      setError("تعذر تحميل المحفوظات");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useInteractionsVersion();
  const visible = posts.filter(
    (post) => readCache(post.id, userId)?.bookmarked !== false,
  );

  return { posts: visible, loading, error, refresh };
}
