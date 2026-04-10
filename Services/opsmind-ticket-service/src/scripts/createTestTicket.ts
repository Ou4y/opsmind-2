import { prisma } from '../lib/prisma';

async function main() {
  const ticket = await prisma.ticket.create({
    data: {
      title: 'Test ticket',
      description: 'This is a test ticket from Prisma',
      type_of_request: 'INCIDENT',
      requester_id: '550e8400-e29b-41d4-a716-446655440000',
      assigned_to_level: 'L1',
      priority: 'MEDIUM',
      support_level: 'L1',
      status: 'OPEN',
      latitude: 33.5138,
      longitude: 36.2765,
      escalation_count: 0,
      is_deleted: false,
    },
  });

  console.log(ticket);
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
