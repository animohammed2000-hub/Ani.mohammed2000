/**
 * Persistent interactions layer (likes, comments, reposts, shares, bookmarks).
 *
 * Design goals:
 *  - optimistic UI: the button reacts instantly, then the database confirms it
 *  - rollback on failure, so a failed write never leaves a fake "liked" state
 *  - one shared store per (user, post) so every rendered copy of a post shows
 *    exactly the same counters and flags (feed, profile, reel, saved page)
 *  - hydration from the database, so refresh / re-render / reopening the app
 *    restores the real state and the real counters
 *  - realtime updates so counters are the same for every user
 *  - graceful degradation: if an optional table has not been migrated yet the
 *    feature falls back to localStorage and tells the user, instead of
 *    pretending the interaction was saved
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

/** Snapshot seeded from the post row returned by the feed query. */
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
  // Server counters win as soon as they exist; local numbers are only used
  // while the app runs without a configured database.
  if (typeof server === "number" && Number.isFinite(server)) return server;
  if (typeof local === "number" && Number.isFinite(local)) return local;
  return fallback;
}

/** Read the current state of a post for a user (no React needed). */
export function readInteractionState(
  post: Post,
  userId: string,
): InteractionSnapshot {
  return readCache(post.id, userId) ?? snapshotFromPost(post, userId);
}

/** Internal: read with a minimal post reference. */
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

function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/* ------------------------------------------------------------------ */
/* Local fallback (used only when a table has not been migrated yet)    */
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
    /* storage can be unavailable in private mode - ignore */
  }
}

/* --- local comments (only used until the database is configured) ---- */

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
    /* ignore quota / private mode errors */
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
/* Hydration                                                           */
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

/**
 * Tries the SQL helper first (single round trip, aggregates every row with a
 * SECURITY DEFINER function so global counters do not depend on per-table
 * select policies). Returns null when the helper is not deployed yet.
 */
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

    // Fill flags for rows the RPC did not return (should not happen).
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

/**
 * Fallback for projects where the migration has not been applied yet.
 * Likes/comments are readable by every signed-in user, so their counters stay
 * real. Reposts/bookmarks/shares only expose the current user's rows; their
 * counters then come from the denormalised columns when they exist.
 */
async function fetchFallbackSummaries(
  postIds: string[],
  userId: string,
): Promise<Map<string, Summary>> {
  const summaries = new Map<string, Summary>();
  postIds.forEach((id) => summaries.set(id, { postId: id }));

  if (!supabaseConfigured || postIds.length === 0) return summaries;

  const [likes, comments, reposts, bookmarks, shares, rows] = await Promise.all([
    supabase
      .from("likes")
      .select("post_id,user_id")
      .in("post_id", postIds)
      .limit(20000),
    supabase
      .from("comments")
      .select("post_id")
      .in("post_id", postIds)
      .limit(20000),
    supabase
      .from("reposts")
      .select("post_id,user_id")
      .in("post_id", postIds)
      .limit(20000),
    supabase
      .from("bookmarks")
      .select("post_id,user_id")
      .in("post_id", postIds)
      .limit(20000),
    supabase
      .from("post_shares")
      .select("post_id,user_id")
      .in("post_id", postIds)
      .limit(20000),
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
  // Never overwrite a snapshot while a write for it is still in flight.
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

/** Hydrate counters/flags for a set of posts from the database. */
export async function hydratePosts(
  posts: Post[],
  userId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!userId || posts.length === 0) return;

  const ids = posts
    .map((post) => post.id)
    .filter((id) => options.force || !directHydration.has(keyOf(id, userId)));

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

/** Hydrate a single post by id (used by realtime and after mutations). */
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

/** Fetch profiles + interaction summaries and return fully decorated posts. */
export async function decoratePosts(
  rows: RawRow[],
  userId: string,
): Promise<Post[]> {
  if (!rows || rows.length === 0) return [];

  const authorIds = Array.from(
    new Set(rows.map((row) => String(row.user_id ?? "")).filter(Boolean)),
  );

  let profiles: Profile[] = [];
  if (supabaseConfigured && authorIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id,username,full_name,display_name,avatar_url,bio")
      .in("id", authorIds);
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
  }));

  await hydratePosts(posts, userId);

  return posts.map((post) => decoratePost(post, userId));
}

/** Merge the shared store state into a post object. */
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

async function notifyUser(
  recipientId: string,
  actorId: string,
  type: "like" | "comment" | "repost" | "follow",
  postId: string,
  content: string,
): Promise<void> {
  if (!supabaseConfigured || !recipientId || recipientId === actorId) return;
  try {
    await supabase.from("notifications").insert({
      user_id: recipientId,
      actor_id: actorId,
      type,
      reference_id: postId,
      content,
    });
  } catch {
    /* notifications are best-effort */
  }
}

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
      ? await supabase
          .from("likes")
          .insert({ post_id: post.id, user_id: userId })
      : await supabase
          .from("likes")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", userId);

    if (error && error.code !== "23505") {
      patchCache(post.id, userId, {
        liked: before.liked,
        likes: before.likes,
      });
      writeLocalFlag(userId, post.id, {
        liked: before.liked,
        likes: before.likes,
      });
      toast.error("تعذر حفظ الإعجاب، تحقق من الاتصال وحاول مجدداً");
      return;
    }

    writeLocalFlag(userId, post.id, { liked, likes });
    if (liked) {
      void notifyUser(post.user_id, userId, "like", post.id, "أعجب بمنشورك");
    }
  } catch {
    patchCache(post.id, userId, { liked: before.liked, likes: before.likes });
    toast.error("تعذر حفظ الإعجاب، تحقق من الاتصال وحاول مجدداً");
    return;
  } finally {
    markPending(post.id, userId, -1);
  }

  await hydratePostIds([post.id], userId, { force: true });
}

export async function toggleBookmark(
  post: Post,
  userId: string,
): Promise<void> {
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
      ? await supabase
          .from("bookmarks")
          .insert({ post_id: post.id, user_id: userId })
      : await supabase
          .from("bookmarks")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", userId);

    if (error && error.code !== "23505") {
      if (isMissingRelation(error)) {
        writeLocalFlag(userId, post.id, { bookmarked });
        toast.warning(
          "تم حفظ المنشور على هذا الجهاز. طبّق ترحيل قاعدة البيانات لحفظه في حسابك.",
        );
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
      ? await supabase
          .from("reposts")
          .insert({ post_id: post.id, user_id: userId })
      : await supabase
          .from("reposts")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", userId);

    if (error && error.code !== "23505") {
      if (isMissingRelation(error)) {
        writeLocalFlag(userId, post.id, { reposted });
        toast.warning(
          "تم تسجيل إعادة النشر على هذا الجهاز. طبّق ترحيل قاعدة البيانات لحفظها في حسابك.",
        );
        return;
      }
      patchCache(post.id, userId, {
        reposted: before.reposted,
        reposts: before.reposts,
      });
      toast.error("تعذر إعادة النشر، حاول مرة أخرى");
      return;
    }

    stored = true;
    writeLocalFlag(userId, post.id, { reposted });
    toast.success(reposted ? "تمت إعادة نشر المنشور" : "تمت إزالة إعادة النشر");
    if (reposted) {
      void notifyUser(
        post.user_id,
        userId,
        "repost",
        post.id,
        "أعاد نشر منشورك",
      );
    }
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
  } catch {
    /* fall through to the legacy path */
  }

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

export async function sharePost(post: Post, userId: string): Promise<void> {
  const url = buildPostUrl(post.id);
  const title = `منشور ${displayName(post.author)} على آني`;
  const text = post.content ? post.content.slice(0, 140) : title;

  let sharedVia: "web-share" | "clipboard" | "none" = "none";

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      sharedVia = "web-share";
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") return;
    }
  }

  if (sharedVia === "none") {
    const copied = await copyToClipboard(url);
    if (!copied) {
      toast.error("تعذر نسخ رابط المنشور");
      return;
    }
    sharedVia = "clipboard";
  }

  const before = readInteractionState(post, userId);
  patchCache(post.id, userId, { shared: true, shares: before.shares + 1 });

  if (supabaseConfigured && userId) {
    try {
      const { error } = await supabase
        .from("post_shares")
        .insert({ post_id: post.id, user_id: userId });
      if (error && isMissingRelation(error)) {
        writeLocalFlag(userId, post.id, { shared: true });
      }
    } catch {
      writeLocalFlag(userId, post.id, { shared: true });
    }
    void hydratePostIds([post.id], userId, { force: true });
  }

  toast.success(
    sharedVia === "clipboard"
      ? "تم نسخ رابط المنشور إلى الحافظة"
      : "تمت مشاركة المنشور",
  );
}

export async function createComment(
  post: Post,
  userId: string,
  content: string,
): Promise<PostCommentRow | null> {
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (!supabaseConfigured) {
    toast.error("قاعدة البيانات غير مهيأة، تعذر نشر التعليق");
    return null;
  }

  markPending(post.id, userId, 1);
  const before = readInteractionState(post, userId);
  patchCache(post.id, userId, { comments: before.comments + 1 });

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

    void notifyUser(
      post.user_id,
      userId,
      "comment",
      post.id,
      "علّق على منشورك",
    );

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
  if (!supabaseConfigured) return false;
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
/* Realtime                                                            */
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

/** Apply denormalised counters pushed by the posts table triggers. */
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

  (["likes", "comments", "reposts", "bookmarks", "post_shares"] as const).forEach(
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

/** Mount once (in the app shell) to keep counters live for every user. */
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

/* ------------------------------------------------------------------ */
/* React hooks                                                         */
/* ------------------------------------------------------------------ */

/** Re-renders a component whenever any interaction snapshot changes. */
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

/** Live interaction state for one post + bound optimistic actions. */
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
    void hydratePosts([post], userId, { force: true });
  }, [key, post, userId]);

  const state = snapshot ?? snapshotFromPost(post, userId);

  const onLike = useCallback(() => toggleLike(post, userId), [post, userId]);
  const onBookmark = useCallback(
    () => toggleBookmark(post, userId),
    [post, userId],
  );
  const onRepost = useCallback(
    () => toggleRepost(post, userId),
    [post, userId],
  );
  const onShare = useCallback(() => sharePost(post, userId), [post, userId]);

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

/**
 * Comments for one post. Loaded on demand, kept in sync with realtime and
 * never lost on refresh (they live in the comments table).
 */
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
      setComments([]);
      setError("قاعدة البيانات غير مهيأة");
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
  }, [post.id, userId]);

  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    void load();
  }, [enabled, load]);

  // Reset when the post changes.
  useEffect(() => {
    loadedRef.current = false;
    setComments(null);
    setError(null);
  }, [post.id]);

  // Live comments for the opened post.
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
            // Fetch the author for comments created by other users.
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

/** Posts bookmarked by the user, newest first, with real interaction data. */
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

  // Drop posts that the user un-bookmarks while the page is open.
  useInteractionsVersion();
  const visible = posts.filter(
    (post) => readCache(post.id, userId)?.bookmarked !== false,
  );

  return { posts: visible, loading, error, refresh };
}
