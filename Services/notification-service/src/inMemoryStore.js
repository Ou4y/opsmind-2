// Simple in-memory notification store used for testing when NO_DB=true

const store = new Map();

function addNotification(userId, message) {
  if (!userId) return;
  const arr = store.get(userId) || [];
  arr.unshift({ id: String(Date.now()) + Math.random().toString(36).slice(2,8), message, read: false, createdAt: new Date() });
  store.set(userId, arr);
}

function getNotifications(userId) {
  return (store.get(userId) || []).slice();
}

function markAllRead(userId) {
  const arr = store.get(userId) || [];
  for (const n of arr) n.read = true;
}

module.exports = { addNotification, getNotifications, markAllRead };
