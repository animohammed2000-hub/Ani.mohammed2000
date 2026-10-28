import React, { useState } from 'react';
import { useNotifications } from '../hooks/useNotifications';
import { NotificationsDrawer } from './NotificationsDrawer';

interface HeaderProps {
  currentUserId: string;
}

export const Header: React.FC<HeaderProps> = ({ currentUserId }) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const { notifications, unreadCount, markAsRead } = useNotifications(currentUserId);

  return (
    <>
      <header className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <h1 className="text-xl font-bold dark:text-white">التطبيق</h1>

        {/* زر الجرس مع عداد الإشعارات اللحظي */}
        <button
          onClick={() => setIsDrawerOpen(true)}
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

      {/* درج الإشعارات الجانبي */}
      <NotificationsDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        notifications={notifications}
        onMarkAsRead={markAsRead}
      />
    </>
  );
};
