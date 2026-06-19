const { sendInAppNotification } = require("../services/inApp.service");

function uniqueRecipients(values) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function buildApprovalMessage(payload, routingKey) {
  const requestCode = payload.requestCode || payload.approvalRequestId || "Inventory approval";
  const entity = payload.entityLabel || payload.actionType || "inventory action";
  if (routingKey.endsWith(".approval_requested")) {
    return `${requestCode}: approval requested for ${entity}.`;
  }
  if (routingKey.endsWith(".approval_approved")) {
    return `${requestCode}: approval approved for ${entity}. Re-run the original action to apply it.`;
  }
  if (routingKey.endsWith(".approval_rejected")) {
    return `${requestCode}: approval rejected for ${entity}.`;
  }
  if (routingKey.endsWith(".approval_escalated")) {
    return `${requestCode}: approval escalated for ${entity}.`;
  }
  if (routingKey.endsWith(".approval_completed")) {
    return `${requestCode}: approved inventory action completed for ${entity}.`;
  }
  return payload.message || `${requestCode}: inventory approval update for ${entity}.`;
}

function resolveRecipients(payload, routingKey) {
  const building = payload.buildingCode || payload.approverBuildingCode || "GLOBAL";
  const approverRole = payload.approverRole || payload.recipientRole;
  const notifyApproverRole = routingKey.endsWith(".approval_requested") || routingKey.endsWith(".approval_escalated");
  return uniqueRecipients([
    payload.recipientUserId,
    payload.approverUserId,
    payload.requesterUserId,
    payload.requester && payload.requester.userId,
    notifyApproverRole && approverRole ? `role:${approverRole}` : null,
    notifyApproverRole && approverRole && building ? `role:${approverRole}:${building}` : null,
  ]);
}

async function consumeInventoryNotifications(channel, exchange) {
  const queue = "inventory.notification.queue";

  await channel.assertQueue(queue, { durable: true });
  await channel.bindQueue(queue, exchange, "inventory.notification.*");

  await channel.consume(queue, async (msg) => {
    if (!msg) return;
    const routingKey = msg.fields.routingKey;
    try {
      const payload = JSON.parse(msg.content.toString() || "{}");
      const recipients = resolveRecipients(payload, routingKey);
      const message = buildApprovalMessage(payload, routingKey);

      if (!recipients.length) {
        console.warn("Inventory notification had no recipients", { routingKey, payload });
      }

      for (const recipient of recipients) {
        await sendInAppNotification(recipient, message);
      }

      channel.ack(msg);
    } catch (err) {
      console.error("Failed to process inventory notification:", err);
      channel.nack(msg, false, false);
    }
  });

  console.log("Listening for inventory notification events");
}

module.exports = consumeInventoryNotifications;
