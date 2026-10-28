import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Notification } from '../types/notification';
import { NotificationsDrawer } from './NotificationsDrawer';

interface HeaderProps {
  currentUserId: string;
}

export const Header: React.FC<HeaderProps> = ({ currentUserId }) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!currentUserId) return;

    let isMounted = true;

    const fetchNotifications = async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false });

      if (!isMounted) return;

      if (!error && data) {
        const nextNotifications = data as Notification[];
        setNotifications(nextNotifications);
        setUnreadCount(nextNotifications.filter((notification) => !notification.read).length);
      }
    };

    fetchNotifications();

    return () => {
      isMounted = false;
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel('global_notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${currentUserId}`,
        },
        (payload) => {
          const newNotification = payload.new as Notification;

          setNotifications((prev) => [newNotification, ...prev]);
          setUnreadCount((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  const handleOpenDrawer = async () => {
    setIsDrawerOpen(true);

    if (unreadCount === 0) return;

    setUnreadCount(0);
    setNotifications((prev) =>
      prev.map((notification) =>
        notification.read ? notification : { ...notification, read: true }
      )
    );

    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', currentUserId)
      .eq('read', false);

    if (error) {
      console.error('Failed to mark notifications as read:', error);
    }
  };

  const markAsRead = async (id: string) => {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id);

    if (!error) {
      setNotifications((prev) =>
        prev.map((notification) =>
          notification.id === id ? { ...notification, read: true } : notification
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
  };

  return (
    <>
      <header className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <h1 className="text-xl font-bold dark:text-white">التطبيق</h1>

        <button
          onClick={handleOpenDrawer}
          className="relative p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition"
          aria-label="الإشعارات"
        >
          🔔
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </header>

      <NotificationsDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        notifications={notifications}
        onMarkAsRead={markAsRead}
      />
    </>
  );
};
