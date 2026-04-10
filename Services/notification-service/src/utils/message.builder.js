module.exports = function buildMessage(type, data) {

  switch (type) {

    case "TICKET_OPENED":
      return [
        {
          userId: data.endUser.id,
          email: data.endUser.email,
          subject: "Ticket Opened",
          message: `Your ticket "${data.ticket.title}" has been opened.`,
        },
        {
          userId: data.admin.id,
          email: data.admin.email,
          subject: "New Ticket Opened",
          message: `Ticket "${data.ticket.title}" opened and assigned to ${data.technician.name} id ${data.technician.id}.`
        }
      ];

    case "TICKET_RESOLVED":
      return [
        {
          userId: data.endUser.id,
          email: data.endUser.email,
          subject: "Ticket Resolved",
          message: `Your ticket "${data.ticket.title}" has been resolved.`
        },
        {
          userId: data.admin.id,
          email: data.admin.email,
          subject: "Ticket Resolved",
          message: `Ticket "${data.ticket.title}" resolved by ${data.technician.name} id ${data.technician.id} .`
        }
      ];

    case "LOW_STOCK":
      return [
        {
          userId: data.admin.id,
          email: data.admin.email,
          subject: "Low Stock Alert",
          message: `Item "${data.item.name}"  , "${data.item.id}" is low in stock. Only ${data.remainingQuantity} left.`
        }
      ];

    default:
      throw new Error("Unknown notification type");
  }
};
