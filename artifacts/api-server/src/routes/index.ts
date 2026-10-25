
import { Router, type IRouter } from "express";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);

interface Comment {
  id: string;
  userId: string;
  text: string;
  createdAt: string;
}

const likes = new Set<string>();
const bookmarks = new Set<string>();
const comments: Record<string, Comment[]> = {};
const shares: Record<string, number> = {};

function getUserId(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function getLikes(postId: string): number {
  return Array.from(likes).filter(
    (key) => key.endsWith(`:${postId}`),
  ).length;
}

// جلب جميع تفاعلات المنشور
router.get("/posts/:id/interactions", (req, res) => {
  const postId = req.params.id;
  const userId = getUserId(req.query.userId);

  return res.json({
    success: true,
    totalLikes: getLikes(postId),
    isLiked: userId ? likes.has(`${userId}:${postId}`) : false,
    comments: comments[postId] || [],
  });
});

// جلب التعليقات
router.get("/posts/:id/comments", (req, res) => {
  return res.json({
    success: true,
    comments: comments[req.params.id] || [],
  });
});

// إضافة أو إلغاء الإعجاب
router.post("/posts/:id/like", (req, res) => {
  const postId = req.params.id;
  const userId = getUserId(req.body?.userId);

  if (!userId) {
    return res.status(400).json({ error: "معرّف المستخدم مطلوب" });
  }

  const key = `${userId}:${postId}`;
  const isLiked = !likes.has(key);

  if (isLiked) likes.add(key);
  else likes.delete(key);

  return res.json({
    success: true,
    isLiked,
    totalLikes: getLikes(postId),
  });
});

// إضافة تعليق
router.post("/posts/:id/comments", (req, res) => {
  const postId = req.params.id;
  const userId = getUserId(req.body?.userId);
  const text =
    typeof req.body?.text === "string" ? req.body.text.trim() : "";

  if (!userId) {
    return res.status(400).json({ error: "معرّف المستخدم مطلوب" });
  }

  if (!text) {
    return res.status(400).json({ error: "نص التعليق مطلوب" });
  }

  if (text.length > 5000) {
    return res.status(400).json({ error: "التعليق طويل جداً" });
  }

  const comment: Comment = {
    id: `cm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    text,
    createdAt: new Date().toISOString(),
  };

  comments[postId] ??= [];
  comments[postId].push(comment);

  return res.json({
    success: true,
    comment,
    totalComments: comments[postId].length,
  });
});

// إضافة أو إلغاء الحفظ
router.post("/posts/:id/bookmark", (req, res) => {
  const userId = getUserId(req.body?.userId);

  if (!userId) {
    return res.status(400).json({ error: "معرّف المستخدم مطلوب" });
  }

  const key = `${userId}:${req.params.id}`;
  const isBookmarked = !bookmarks.has(key);

  if (isBookmarked) bookmarks.add(key);
  else bookmarks.delete(key);

  return res.json({ success: true, isBookmarked });
});

// تسجيل المشاركة
router.post("/posts/:id/share", (req, res) => {
  const postId = req.params.id;
  shares[postId] = (shares[postId] || 0) + 1;

  return res.json({
    success: true,
    totalShares: shares[postId],
  });
});

export default router;
