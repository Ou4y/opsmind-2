import AuthService from './authService.js';

const NOTIFICATION_API = (
    (typeof window !== 'undefined' && window.OPSMIND_NOTIFICATION_URL) ? window.OPSMIND_NOTIFICATION_URL :
    'http://localhost:3005/api/notifications'
).replace(/\/+$/, '');

const MIN_FETCH_INTERVAL_MS = 1500;
const MAX_BACKOFF_MS = 60000;
const INITIAL_BACKOFF_MS = 4000;

let notificationsInFlightPromise = null;
let lastNotifications = [];
let lastFetchAtMs = 0;
let failureCount = 0;
let backoffUntilMs = 0;

function getNotificationUserIds() {
    const user = AuthService.getUser();
    if (!user) return [];

    const ids = new Set();

    if (user.id !== undefined && user.id !== null && String(user.id).trim()) {
        ids.add(String(user.id).trim());
    }
    if (user.workflowUserId !== undefined && user.workflowUserId !== null && String(user.workflowUserId).trim()) {
        ids.add(String(user.workflowUserId).trim());
    }
    if (user.workflow_user_id !== undefined && user.workflow_user_id !== null && String(user.workflow_user_id).trim()) {
        ids.add(String(user.workflow_user_id).trim());
    }
    if (user.user_id !== undefined && user.user_id !== null && String(user.user_id).trim()) {
        ids.add(String(user.user_id).trim());
    }

    const context = AuthService.resolveUserDashboardContext(user);
    if (context?.workflowUserId !== undefined && context?.workflowUserId !== null) {
        ids.add(String(context.workflowUserId));
    }

    return Array.from(ids);
}

function normalizeAndMergeNotifications(notificationsByIdentity) {
    const seen = new Set();
    const merged = [];

    notificationsByIdentity.forEach(({ identity, notifications }) => {
        if (!Array.isArray(notifications)) return;

        notifications.forEach((notification) => {
            const identityTag = notification._id || notification.id ||
                `${identity}:${notification.message || ''}:${notification.createdAt || ''}`;

            if (seen.has(identityTag)) return;
            seen.add(identityTag);

            merged.push({
                ...notification,
                _notificationIdentity: identity
            });
        });
    });

    merged.sort((a, b) => {
        const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
    });

    return merged;
}

const NotificationService = {

    
    async getUserNotifications(options = {}) {
        const { force = false } = options;
        const userIds = getNotificationUserIds();
        if (userIds.length === 0) return [];

        const nowMs = Date.now();
        if (notificationsInFlightPromise) {
            return notificationsInFlightPromise;
        }

        if (!force && nowMs < backoffUntilMs) {
            return lastNotifications;
        }

        if (!force && (nowMs - lastFetchAtMs) < MIN_FETCH_INTERVAL_MS) {
            return lastNotifications;
        }

        try {
            notificationsInFlightPromise = (async () => {
                const settled = await Promise.allSettled(
                    userIds.map(async (userId) => {
                        const response = await fetch(`${NOTIFICATION_API}/${encodeURIComponent(userId)}`);
                        if (!response.ok) {
                            throw new Error(`Failed to fetch notifications for userId=${userId}`);
                        }

                        const data = await response.json();
                        return {
                            identity: userId,
                            notifications: Array.isArray(data) ? data : []
                        };
                    })
                );

                const successful = settled
                    .filter((entry) => entry.status === 'fulfilled')
                    .map((entry) => entry.value);

                if (successful.length === 0) {
                    throw new Error('Failed to fetch notifications for all known identities');
                }

                const merged = normalizeAndMergeNotifications(successful);
                lastNotifications = merged;
                lastFetchAtMs = Date.now();
                failureCount = 0;
                backoffUntilMs = 0;
                return merged;
            })();

            return await notificationsInFlightPromise;
        } catch (error) {
            failureCount += 1;
            const backoffMs = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * (2 ** Math.max(0, failureCount - 1)));
            backoffUntilMs = Date.now() + backoffMs;
            console.warn('Notification fetch temporarily backed off:', error?.message || error);
            return lastNotifications;
        } finally {
            notificationsInFlightPromise = null;
        }
    },

    
    async getUnreadCount() {
        const notifications = await this.getUserNotifications();
        return notifications.filter(n => !n.read).length;
    },

    
    async markAllAsRead() {
        const userIds = getNotificationUserIds();
        if (userIds.length === 0) return;

        try {
            await Promise.allSettled(
                userIds.map((userId) =>
                    fetch(`${NOTIFICATION_API}/${encodeURIComponent(userId)}/mark-read`, {
                        method: 'PUT'
                    })
                )
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
