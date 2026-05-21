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
  const inventoryExchange = process.env.INVENTORY_EVENTS_EXCHANGE || "opsmind.events";
  if (inventoryExchange !== exchange) {
    await channel.assertExchange(inventoryExchange, "topic", { durable: true });
    await channel.bindQueue(q.queue, inventoryExchange, "ticket.notification.*");
  }

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
        const { ticket, technician, supervisor } = event || {};

        if (!ticket?.id || !technician?.id) {
          throw new Error("Invalid ticket.notification.assigned payload: missing ticket.id or technician.id");
        }

        await sendInAppNotification(
          technician.id,
          `A new ticket has been assigned to you (Ticket ID: ${ticket.id}, Title: ${ticket.title}).`
        );

        if (technician.email) {
          await sendEmail(
            technician.email,
            "New Ticket Assigned",
            `Hello ${technician.name || "technician"},\n\n` +
              `You have been assigned a new ticket.\n\n` +
              `Ticket ID: ${ticket.id}\nTitle: ${ticket.title}`
          );
        }

        if (supervisor?.id) {
          await sendInAppNotification(
            supervisor.id,
            `Ticket "${ticket.title}" (ID: ${ticket.id}) assigned to ${technician.name || technician.id}`
          );
        }

        if (supervisor?.email) {
          await sendEmail(
            supervisor.email,
            "Ticket Assignment Notification",
            `Hello ${supervisor.name || "supervisor"},\n\n` +
              `The following ticket has been assigned:\n\n` +
              `Ticket ID: ${ticket.id}\nTitle: ${ticket.title}\n` +
              `Assigned Technician: ${technician.name || technician.id}`
          );
        }

        await logSystemMessage(
          `Ticket ${ticket.id} assigned to Technician ${technician.name || "unknown"} [ID: ${technician.id}]` +
          `${supervisor?.id ? ` - Supervisor: ${supervisor.name || "unknown"} [ID: ${supervisor.id}]` : " - Supervisor: none"}`
        );
      }

      // 1.b Ticket Opened (legacy safety-net)
      if (routingKey === "ticket.notification.opened") {
        const { ticket, technician, admin, endUser } = event;

        // notify end user
        if (endUser && endUser.id) {
          await sendInAppNotification(
            endUser.id,
            `Your ticket #${ticket.id} - ${ticket.title} has been created.`
          );

          if (endUser.email) {
            await sendEmail(
              endUser.email,
              "Ticket Created",
              `Hello ${endUser.name || "user"},\n\nYour ticket has been created.\n\nTicket ID: ${ticket.id}\nTitle: ${ticket.title}`
            );
          }
        }

        // notify technician
        if (technician && technician.id) {
          await sendInAppNotification(
            technician.id,
            `A new ticket has been opened: ${ticket.title} (ID: ${ticket.id}).`
          );

          if (technician.email) {
            await sendEmail(
              technician.email,
              "New Ticket Opened",
              `Hello ${technician.name || "technician"},\n\nA new ticket has been opened.\n\nTicket ID: ${ticket.id}\nTitle: ${ticket.title}`
            );
          }
        }

        // notify admin
        if (admin && admin.id) {
          await sendInAppNotification(
            admin.id,
            `Ticket opened: ${ticket.title} (ID: ${ticket.id}).`
          );

          if (admin.email) {
            await sendEmail(
              admin.email,
              "Ticket Opened",
              `Hello ${admin.name || "admin"},\n\nA new ticket has been opened.\n\nTicket ID: ${ticket.id}\nTitle: ${ticket.title}`
            );
          }
        }

        await logSystemMessage(`Ticket ${ticket.id} opened (notified endUser:${endUser?.id} admin:${admin?.id} tech:${technician?.id})`);
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
        const { ticket, technician, endUser, supervisor } = event.data;

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
        const { item, admin } = event;
        const { item } = event;
        const supervisor = event.admin || event.supervisor;
        if (!supervisor || !supervisor.id) {
          throw new Error("Low stock event missing admin/supervisor payload");
        }

        await sendInAppNotification(
          admin.id,
          `Low stock for Item ID: ${item.id}, Name: ${item.name}.`
        );

        if (admin.email) {
          await sendEmail(
            admin.email,
            "Low Stock Alert",
            `Hello ${admin.name},\n\n` +
              `Low stock has been detected.\n\n` +
              `Item ID: ${item.id}\nName: ${item.name}`
          );
        }

        await logSystemMessage(
          `Low stock detected for Item ${item.id} Name: ${item.name}( Admin: ${admin.name} [ID: ${admin.id}])`
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
