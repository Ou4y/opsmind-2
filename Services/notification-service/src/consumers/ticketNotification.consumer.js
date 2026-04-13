const { sendEmail } = require("../services/email.service");
const { sendInAppNotification } = require("../services/inApp.service");
const { logSystemMessage } = require("../services/systemMessage.service");

async function consumeTicketNotifications(channel, exchange) {
  // 1) Create / assert queue
  const q = await channel.assertQueue("ticket.notification.queue", {
    durable: true
  });

  // 2) Bind queue to exchange
  await channel.bindQueue(q.queue, exchange, "ticket.notification.*");

  console.log(" Waiting for ticket notification events...");

  // 3) Consume messages
  channel.consume(q.queue, async (msg) => {
    if (!msg) return;

    try {
      console.log("Message received");

      const routingKey = msg.fields.routingKey;
      const event = JSON.parse(msg.content.toString());

      // ===============================
      // 1️ Ticket Assigned
      // ===============================
      if (routingKey === "ticket.notification.assigned") {
        const { ticket, technician, supervisor } = event;

        await sendInAppNotification(
          technician.id,
          `A new ticket has been assigned to you (Ticket ID: ${ticket.id}, Title: ${ticket.title}).`
        );

        if (technician.email) {
          await sendEmail(
            technician.email,
            "New Ticket Assigned",
            `Hello ${technician.name},\n\n` +
              `You have been assigned a new ticket.\n\n` +
              `Ticket ID: ${ticket.id}\nTitle: ${ticket.title}`
          );
        }

        await sendInAppNotification(
          supervisor.id,
          `Ticket "${ticket.title}" (ID: ${ticket.id}) assigned to ${technician.name}`
        );

        if (supervisor.email) {
          await sendEmail(
            supervisor.email,
            "Ticket Assignment Notification",
            `Hello ${supervisor.name},\n\n` +
              `The following ticket has been assigned:\n\n` +
              `Ticket ID: ${ticket.id}\nTitle: ${ticket.title}\n` +
              `Assigned Technician: ${technician.name}`
          );
        }

        await logSystemMessage(
          `Ticket ${ticket.id} assigned to Technician ${technician.name} [ID: ${technician.id}] - Supervisor: ${supervisor.name} [ID: ${supervisor.id}]`
        );
      }

      // 2 SLA Warning (before breach)
      if (routingKey === "ticket.notification.slaWarning") {
        const { ticket, technician, supervisor } = event;

        await sendInAppNotification(
         technician.id,
          `SLA is about to expire soon for Ticket ID: ${ticket.id}, Title: ${ticket.title}.`
       );

        if (technician.email) {
          await sendEmail(
           technician.email,
            "SLA Warning",
            `Hello ${technician.name},\n\n` +
            `SLA will expire soon.\n\n` +
            `Ticket ID: ${ticket.id}\nTitle: ${ticket.title}`
          );
        }

        await sendInAppNotification(
         supervisor.id,
          `SLA nearing expiration for Ticket ID: ${ticket.id}, Title: ${ticket.title}.`
        );

        if (supervisor.email) {
          await sendEmail(
           supervisor.email,
            "SLA Warning",
            `Hello ${supervisor.name},\n\n` +
            `SLA will expire soon.\n\n` +
            `Ticket ID: ${ticket.id}\nTitle: ${ticket.title}\n` +
            `Assigned Technician: ${technician.name}`
          );
        }

        await logSystemMessage(
          `SLA warning for Ticket ${ticket.id} (Notified: ${technician.name} [ID: ${technician.id}] + Supervisor: ${supervisor.name} [ID: ${supervisor.id}])`
       );
      }

      
      // 3 SLA Breached 
      if (routingKey === "ticket.notification.slaBreached") {
        const { ticket, technician, supervisor } = event;

        await sendInAppNotification(
          technician.id,
          `SLA breached for Ticket ID: ${ticket.id}, Title: ${ticket.title}.`
        );

        if (technician.email) {
          await sendEmail(
            technician.email,
            "SLA Breach Alert",
            `Hello ${technician.name},\n\n` +
              `SLA has been breached.\n\n` +
              `Ticket ID: ${ticket.id}\nTitle: ${ticket.title}`
          );
        }

        await sendInAppNotification(
          supervisor.id,
          `SLA breached for Ticket ID: ${ticket.id}, Title: ${ticket.title}.`
        );

        if (supervisor.email) {
          await sendEmail(
            supervisor.email,
            "SLA Breach Alert",
            `Hello ${supervisor.name},\n\n` +
              `SLA has been breached.\n\n` +
              `Ticket ID: ${ticket.id}\nTitle: ${ticket.title}\n` +
              `Assigned Technician: ${technician.name}`
          );
        }

        await logSystemMessage(
          `SLA breached for Ticket ${ticket.id} (Notified: ${technician.name} [ID: ${technician.id}] + Supervisor: ${supervisor.name} [ID: ${supervisor.id}])`
        );
      }

      // 4 Ticket Resolved
      
      if (routingKey === "ticket.notification.resolved") {
        const { ticket, technician, endUser, supervisor } = event;

        await sendInAppNotification(
          endUser.id,
          `Ticket #${ticket.id} - ${ticket.title} has been resolved.`
        );

        if (endUser.email) {
          await sendEmail(
            endUser.email,
            "Your Ticket Has Been Resolved",
            `Hello ${endUser.name},\n\n` +
              `Your ticket has been resolved successfully.\n\n` +
              `Ticket ID: ${ticket.id}\nTitle: ${ticket.title}`
          );
        }

        await sendInAppNotification(
          technician.id,
          `Ticket #${ticket.id} (${ticket.title}) has been resolved.`
        );

        await sendInAppNotification(
          supervisor.id,
          `Ticket #${ticket.id} (${ticket.title}) has been resolved by ${technician.name}.`
        );

        if (supervisor.email) {
          await sendEmail(
            supervisor.email,
            "Ticket Resolved Notification",
            `Hello ${supervisor.name},\n\n` +
              `Ticket #${ticket.id} has been resolved.\n\n` +
              `Title: ${ticket.title}\nResolved by: ${technician.name}`
          );
        }

        await logSystemMessage(
          `Ticket ${ticket.id} resolved by Technician ${technician.name} [ID: ${technician.id}] (Supervisor: ${supervisor.name} [ID: ${supervisor.id}])`
        );
      }

      // 5 Low stock

      if (routingKey === "ticket.notification.lowStock") {
        const { item, supervisor } = event;

        await sendInAppNotification(
          supervisor.id,
          `Low stock for Item ID: ${item.id}, Name: ${item.name}.`
        );

        if (supervisor.email) {
          await sendEmail(
            supervisor.email,
            "Low Stock Alert",
            `Hello ${supervisor.name},\n\n` +
              `Low stock has been detected.\n\n` +
              `Item ID: ${item.id}\nName: ${item.name}`
          );
        }

        await logSystemMessage(
          `Low stock detected for Item ${item.id} Name: ${item.name}( Supervisor: ${supervisor.name} [ID: ${supervisor.id}])`
        );
      }


      //  IMPORTANT: acknowledge message ONLY if everything succeeded
      channel.ack(msg);
      console.log(" Message processed & ACK sent");

    } catch (err) {
      console.error(" Error processing message:", err);

      channel.nack(msg, false, false);
    }
  });
}

module.exports = consumeTicketNotifications;
