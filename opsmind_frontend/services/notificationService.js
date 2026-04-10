import AuthService from './authService.js';

const NOTIFICATION_API = 'http://localhost:3000/api/notifications';

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
                `${NOTIFICATION_API}/user/${user.id}/read-all`,
                {
                    method: 'PATCH'
                }
            );

            console.log("All notifications marked as read");

        } catch (error) {
            console.error("Mark all as read failed:", error);
        }
    },

    
    async markOneAsRead(notificationId) {
        try {
            await fetch(
                `${NOTIFICATION_API}/${notificationId}/read`,
                {
                    method: 'PATCH'
                }
            );

        } catch (error) {
            console.error("Mark single notification failed:", error);
        }
    }

};

export default NotificationService;
