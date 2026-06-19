Testing the Notification Service (end-to-end with RabbitMQ, without writing to MongoDB)

Prerequisites:
- RabbitMQ must be running and accessible by the service (check `RABBITMQ_URL` env).
- You don't need MongoDB when testing in-memory.

Quick start (in project root):

1) Start notification service in test/no-db mode:

```bash
# from repo root
cd Services/notification-service
# install deps if needed: npm ci
# start with NO_DB to avoid MongoDB writes and set secret to match ticket service
NO_DB=true INTERNAL_SECRET=change-me-internal-secret RABBITMQ_URL=amqp://opsmind:opsmind@rabbitmq:5672 PORT=3005 node src/index.js
```

2) Send a legacy notification HTTP POST (this is what the ticket service does as a safety-net):

```bash
curl -v -X POST http://localhost:3005/api/notifications \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: change-me-internal-secret" \
  -d '{
    "type":"TICKET_OPENED",
    "payload":{
      "ticket": { "id":"TST-123","title":"Printer problem" },
      "endUser": { "id":"user-1", "name":"Alice", "email":"alice@example.com" },
      "technician": { "id":"tech-1", "name":"Bob", "email":"bob@example.com" },
      "admin": { "id":"admin-1", "name":"Carol", "email":"carol@example.com" }
    }
  }'
```

3) Verify in logs: the notification-service should publish the `ticket.notification.opened` routing key to RabbitMQ and the consumer will process it. Because `NO_DB=true` notifications are kept in-memory, you can fetch them via the same API:

```bash
curl http://localhost:3005/api/notifications/user-1
curl http://localhost:3005/api/notifications/tech-1
curl http://localhost:3005/api/notifications/admin-1
```

You should see JSON arrays of notifications created by the consumer (in-memory).

Notes:
- To revert to normal behavior (persisting to MongoDB) unset `NO_DB` and provide `MONGO_URI` in your environment.
- The endpoint `POST /api/notifications` is compatible with the ticket-service safety-net HTTP calls (it requires `x-internal-secret`).
