-- 1. Add parent_id and image_url to comments
ALTER TABLE comments 
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);

-- 2. Create comment_likes table
CREATE TABLE IF NOT EXISTS comment_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(comment_id, user_id)
);

ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read comment_likes" ON comment_likes FOR SELECT USING (true);
CREATE POLICY "Allow authenticated manage comment_likes" ON comment_likes 
FOR ALL USING (auth.uid() = user_id);

-- 3. Update notification type constraint
ALTER TABLE notifications 
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications 
ADD CONSTRAINT notifications_type_check 
CHECK (type IN ('like', 'comment', 'follow', 'mention', 'comment_like', 'reply'));

-- 4. Create comment attachments bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('comment-attachments', 'comment-attachments', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public Read Comment Attachments" ON storage.objects
    FOR SELECT USING (bucket_id = 'comment-attachments');

CREATE POLICY "Authenticated Upload Comment Attachments" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'comment-attachments' AND auth.role() = 'authenticated');
