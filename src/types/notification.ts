export type NotificationType = 'like' | 'comment' | 'follow' | 'mention';

export interface Notification {
  id: string;
  user_id: string;
  actor_id: string;
  type: NotificationType;
  entity_id?: string;
  read: boolean;
  created_at: string;
  actor?: {
    full_name?: string;
    avatar_url?: string;
  };
}
