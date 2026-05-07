import AuthService from './authService.js';

const NOTIFICATION_API = (
    (typeof window !== 'undefined' && window.OPSMIND_NOTIFICATION_URL) ? window.OPSMIND_NOTIFICATION_URL :
    'http://localhost:3005/api/notifications'
).replace(/\/+$/, '');

const NotificationService = {

    
    async getUserNotifications() {
        const user = AuthService.getUser();
        if (!user) return [];

        const userId = user.id;

        try {
            const response = await fetch(
                `${NOTIFICATION_API}/${userId}`
            );

            if (!response.ok) {
                throw new Error('Failed to fetch notifications');
            }

            const data = await response.json();

            console.log("Notifications from backend:", data);

            return Array.isArray(data) ? data : [];

        } catch (error) {
            console.error('Notification fetch error:', error);
            return [];
        }
    },

    
    async getUnreadCount() {
        const notifications = await this.getUserNotifications();
        return notifications.filter(n => !n.read).length;
    },

    
    async markAllAsRead() {
        const user = AuthService.getUser();
        if (!user) return;

        try {
            await fetch(
                `${NOTIFICATION_API}/${user.id}/mark-read`,
                {
                    method: 'PUT'
                }
            );

            console.log("All notifications marked as read");

        } catch (error) {
            console.error("Mark all as read failed:", error);
        }
    },

    
    async markOneAsRead(notificationId) {
        try {
            // Backend currently exposes only a user-level mark-read endpoint.
            // Keep this method non-breaking for callers by falling back to mark-all.
            console.warn('Single-notification read endpoint is not available; marking all as read instead.', notificationId);
            await this.markAllAsRead();

        } catch (error) {
            console.error("Mark single notification failed:", error);
        }
    }

};

export default NotificationService;
