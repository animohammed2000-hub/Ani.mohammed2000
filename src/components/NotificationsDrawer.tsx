import React, { useEffect, useState } from 'react';
import { Notification } from '../types/notification';
import { supabase } from '../lib/supabase'; // تنبيه: تأكد من مطابق مسار استيراد ملف supabase لديك

interface Props {
  isOpen: boolean;
  onClose: () => void;
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
}

export const NotificationsDrawer: React.FC<Props> = ({
  isOpen,
  onClose,
  notifications: initialNotifications,
  onMarkAsRead,
}) => {
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);

  // مزامنة الإشعارات القادمة عبر الـ Props عند التحديث
  useEffect(() => {
    setNotifications(initialNotifications);
  }, [initialNotifications]);

  // تفعيل الاستماع اللحظي (Realtime Subscription)
  useEffect(() => {
    const channel = supabase
      .channel('realtime_notifications_drawer')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
        },
        async (payload) => {
          const newNotification = payload.new as Notification;

          // جلب تفاصيل التفاعل والمستخدم (Actor) للإشعار الجديد
          if (newNotification.actor_id) {
            const { data: actor } = await supabase
              .from('profiles')
              .select('full_name, avatar_url')
              .eq('id', newNotification.actor_id)
              .single();

            if (actor) {
              newNotification.actor = actor;
            }
          }

          // إضافة الإشعار الجديد في أعلى القائمة فوراً
          setNotifications((prev) => [newNotification, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 h-full p-4 shadow-xl flex flex-col">
        <div className="flex justify-between items-center pb-4 border-b dark:border-gray-800">
          <h2 className="text-xl font-bold dark:text-white">الإشعارات</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 text-lg font-bold">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto mt-4 space-y-3">
          {notifications.length === 0 ? (
            <p className="text-center text-gray-500 mt-10">لا توجد إشعارات حالياً</p>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => onMarkAsRead(n.id)}
                className={`p-3 rounded-lg border dark:border-gray-800 cursor-pointer transition ${
                  n.read ? 'bg-transparent' : 'bg-blue-50 dark:bg-blue-950/30'
                }`}
              >
                <div className="flex items-center space-x-3 space-x-reverse">
                  <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-700 flex items-center justify-center font-bold dark:text-white">
                    {n.actor?.full_name?.[0] || 'U'}
                  </div>
                  <div>
                    <p className="text-sm dark:text-white">
                      <span className="font-semibold">{n.actor?.full_name || 'مستخدم'}</span>{' '}
                      {n.type === 'like' && 'أعجب بمنشورك'}
                      {n.type === 'comment' && 'علق على منشورك'}
                      {n.type === 'follow' && 'قام بمتابعتك'}
                      {n.type === 'mention' && 'شار إليك في تعليق'}
                    </p>
                    <span className="text-xs text-gray-400">
                      {new Date(n.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
