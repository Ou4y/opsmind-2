import swaggerJsdoc from 'swagger-jsdoc';

/**
 * OpenAPI 3.0 Specification — OpsMind Workflow Service
 *
 * All schemas and paths defined programmatically (no JSDoc annotations needed).
 * This keeps documentation centralized and avoids polluting controllers/routes.
 */

const swaggerDefinition: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'OpsMind Workflow Service API',
      version: '1.0.0',
      description:
        'Workflow and Assignment microservice for the OpsMind university IT Service Management platform. ' +
        'Handles ticket routing, claim-on-open, reassignment, escalation, and monitoring dashboards.',
      contact: {
        name: 'OpsMind Team',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3003',
        description: 'Local / Docker development',
      },
    ],

    // ─────────────────────────────────────────────
    //  Tags
    // ─────────────────────────────────────────────
    tags: [
      { name: 'Health', description: 'Service health & readiness' },
      { name: 'Routing', description: 'Automatic ticket routing by building / floor' },
      { name: 'Claim', description: 'Claim-on-open (junior technicians)' },
      { name: 'Reassignment', description: 'Ticket reassignment with authority checks' },
      { name: 'Escalation', description: 'Escalation (SLA, manual, critical, reopen)' },
      { name: 'Workflow Logs', description: 'Workflow action audit logs' },
      { name: 'Tickets', description: 'Group and technician ticket queries' },
      { name: 'SLA', description: 'SLA tracking and status' },
      { name: 'Metrics', description: 'Workflow metrics and analytics' },
      { name: 'Reports', description: 'SLA and escalation reports' },
      { name: 'Dashboards', description: 'Monitoring & analytics dashboards' },
      { name: 'Admin - Groups', description: 'Support group management' },
      { name: 'Admin - Members', description: 'Group member management' },
      { name: 'Admin - Escalation Rules', description: 'Escalation rule configuration' },
    ],

    // ─────────────────────────────────────────────
    //  Reusable Components
    // ─────────────────────────────────────────────
    components: {
      schemas: {
        // ── Enums ──
        MemberRole: {
          type: 'string',
          enum: ['JUNIOR', 'SENIOR'],
        },
        UserRole: {
          type: 'string',
          enum: ['JUNIOR', 'SENIOR', 'SUPERVISOR', 'HEAD_OF_IT'],
        },
        MemberStatus: {
          type: 'string',
          enum: ['ACTIVE', 'INACTIVE', 'ON_LEAVE'],
        },
        RoutingStatus: {
          type: 'string',
          enum: ['UNASSIGNED', 'ASSIGNED', 'ESCALATED'],
        },
        EscalationTrigger: {
          type: 'string',
          enum: ['SLA', 'MANUAL', 'CRITICAL', 'REOPEN_COUNT'],
        },

        // ── Database Row Schemas ──
        SupportGroup: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            name: { type: 'string', example: 'Building-A Floor-1 Support' },
            building: { type: 'string', example: 'A' },
            floor: { type: 'integer', example: 1 },
            parent_group_id: { type: 'integer', nullable: true, example: null },
            is_active: { type: 'boolean', example: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        GroupMember: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            user_id: { type: 'integer', example: 10 },
            group_id: { type: 'integer', example: 1 },
            role: { $ref: '#/components/schemas/MemberRole' },
            can_assign: { type: 'boolean', example: false },
            can_escalate: { type: 'boolean', example: false },
            status: { $ref: '#/components/schemas/MemberStatus' },
            joined_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        TicketRoutingState: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            ticket_id: { type: 'string', format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' },
            current_group_id: { type: 'integer', example: 1 },
            assigned_member_id: { type: 'integer', nullable: true, example: null },
            status: { $ref: '#/components/schemas/RoutingStatus' },
            escalation_count: { type: 'integer', example: 0 },
            last_escalated_at: { type: 'string', format: 'date-time', nullable: true },
            claimed_at: { type: 'string', format: 'date-time', nullable: true },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        EscalationRule: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            source_group_id: { type: 'integer', example: 1 },
            target_group_id: { type: 'integer', example: 2 },
            trigger_type: { $ref: '#/components/schemas/EscalationTrigger' },
            delay_minutes: { type: 'integer', example: 30 },
            reopen_threshold: { type: 'integer', example: 0 },
            is_active: { type: 'boolean', example: true },
            priority: { type: 'integer', example: 0 },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        WorkflowLog: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            ticket_id: { type: 'string', format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' },
            action: { type: 'string', enum: ['CREATED', 'ROUTED', 'CLAIMED', 'REASSIGNED', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED'] },
            from_group_id: { type: 'integer', nullable: true },
            to_group_id: { type: 'integer', nullable: true },
            from_member_id: { type: 'integer', nullable: true },
            to_member_id: { type: 'integer', nullable: true },
            performed_by: { type: 'integer', nullable: true },
            reason: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },

        // ── Generic API Response Wrapper ──
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string', example: 'Descriptive error message' },
          },
        },
      },
    },

    // ─────────────────────────────────────────────
    //  Paths
    // ─────────────────────────────────────────────
    paths: {
      // ══════════════════════════════════════
      //  Health
      // ══════════════════════════════════════
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Service health check',
          description: 'Returns service status and verifies MySQL connectivity by running `SELECT 1`.',
          operationId: 'healthCheck',
          responses: {
            200: {
              description: 'Service is healthy and database is connected',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'OK' },
                      service: { type: 'string', example: 'opsmind-workflow' },
                      database: { type: 'string', example: 'connected' },
                      timestamp: { type: 'string', format: 'date-time' },
                      uptime: { type: 'number', example: 123.456 },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Database connection failed',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ERROR' },
                      service: { type: 'string', example: 'opsmind-workflow' },
                      database: { type: 'string', example: 'disconnected' },
                      error: { type: 'string', example: 'Connection refused' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ══════════════════════════════════════
      //  Routing
      // ══════════════════════════════════════
      '/workflow/route-ticket': {
        post: {
          tags: ['Routing'],
          summary: 'Route a ticket to a support group',
          description:
            'Auto-routes a ticket to the correct support group based on building and floor. ' +
            'Creates a routing state record with status UNASSIGNED.',
          operationId: 'routeTicket',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['ticketId', 'building', 'floor'],
                  properties: {
                    ticketId: { type: 'string', format: 'uuid', description: 'Ticket ID from Ticket Service (UUID)', example: '550e8400-e29b-41d4-a716-446655440000' },
                    building: { type: 'string', description: 'Building identifier', example: 'A' },
                    floor: { type: 'integer', description: 'Floor number', example: 1 },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Ticket routed successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          ticketId: { type: 'string', format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' },
                          groupId: { type: 'integer', example: 1 },
                          groupName: { type: 'string', example: 'Building-A Floor-1 Support' },
                          building: { type: 'string', example: 'A' },
                          floor: { type: 'integer', example: 1 },
                          routing_state: {
                            type: 'object',
                            properties: {
                              id: { type: 'integer', example: 1 },
                              ticket_id: { type: 'string', format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' },
                              current_group_id: { type: 'integer', example: 1 },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: 'Missing required fields or no support group found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/ticket/{ticketId}/routing': {
        get: {
          tags: ['Routing'],
          summary: 'Get routing state for a ticket',
          description: 'Returns the current workflow routing state for the given ticket ID.',
          operationId: 'getTicketRouting',
          parameters: [
            {
              name: 'ticketId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Ticket ID',
              example: 101,
            },
          ],
          responses: {
            200: {
              description: 'Routing state found',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: { $ref: '#/components/schemas/TicketRoutingState' },
                    },
                  },
                },
              },
            },
            404: {
              description: 'Ticket not found in workflow system',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/group/{groupId}/queue': {
        get: {
          tags: ['Routing'],
          summary: 'Get all tickets in a group queue',
          description: 'Returns all ticket routing states currently assigned to the given group.',
          operationId: 'getGroupQueue',
          parameters: [
            {
              name: 'groupId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Support group ID',
              example: 1,
            },
          ],
          responses: {
            200: {
              description: 'Group queue retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          groupId: { type: 'integer', example: 1 },
                          tickets: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/TicketRoutingState' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/group/{groupId}/info': {
        get: {
          tags: ['Routing'],
          summary: 'Get support group information',
          description: 'Returns details of a specific support group.',
          operationId: 'getGroupInfo',
          parameters: [
            {
              name: 'groupId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Support group ID',
              example: 1,
            },
          ],
          responses: {
            200: {
              description: 'Group info retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: { $ref: '#/components/schemas/SupportGroup' },
                    },
                  },
                },
              },
            },
            404: {
              description: 'Group not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      // ══════════════════════════════════════
      //  Claim-on-Open
      // ══════════════════════════════════════
      '/workflow/claim/{ticketId}': {
        post: {
          tags: ['Claim'],
          summary: 'Claim a ticket',
          description:
            'Junior technician claims an unassigned ticket. Uses database-level atomic UPDATE ' +
            '(`WHERE status = \'UNASSIGNED\'`) to prevent race conditions. ' +
            'Also notifies Ticket Service via `PATCH /tickets/:id/assign`.',
          operationId: 'claimTicket',
          parameters: [
            {
              name: 'ticketId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Ticket ID to claim',
              example: 101,
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['userId'],
                  properties: {
                    userId: { type: 'integer', description: 'User ID of the claiming technician', example: 10 },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Ticket claimed successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          ticketId: { type: 'integer', example: 101 },
                          claimedBy: { type: 'integer', example: 10 },
                          memberId: { type: 'integer', example: 1 },
                          groupId: { type: 'integer', example: 1 },
                          message: { type: 'string', example: 'Ticket successfully claimed by user 10' },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: 'User not in group, not a junior, or ticket not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            409: {
              description: 'Ticket already claimed (race condition detected)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: false },
                      error: { type: 'string', example: 'Ticket 101 is already claimed or escalated. Current status: ASSIGNED' },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/claim/{ticketId}/status': {
        get: {
          tags: ['Claim'],
          summary: 'Check if a ticket is claimed',
          description: 'Returns whether the given ticket has been claimed by a technician.',
          operationId: 'getClaimStatus',
          parameters: [
            {
              name: 'ticketId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Ticket ID',
              example: 101,
            },
          ],
          responses: {
            200: {
              description: 'Claim status retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          ticketId: { type: 'integer', example: 101 },
                          claimed: { type: 'boolean', example: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/group/{groupId}/unclaimed': {
        get: {
          tags: ['Claim'],
          summary: 'List unclaimed tickets in a group',
          description: 'Returns all tickets in the group with status UNASSIGNED.',
          operationId: 'getUnclaimedTickets',
          parameters: [
            {
              name: 'groupId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Support group ID',
              example: 1,
            },
          ],
          responses: {
            200: {
              description: 'Unclaimed tickets retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          groupId: { type: 'integer', example: 1 },
                          unclaimedTickets: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/TicketRoutingState' },
                          },
                          count: { type: 'integer', example: 3 },
                        },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      // ══════════════════════════════════════
      //  Reassignment
      // ══════════════════════════════════════
      '/workflow/reassign/{ticketId}': {
        post: {
          tags: ['Reassignment'],
          summary: 'Reassign a ticket to another member',
          description:
            'Reassigns a ticket to a different group member. Authority checks:\n' +
            '- **JUNIOR** → denied\n' +
            '- **SENIOR** → within same building only\n' +
            '- **SUPERVISOR / HEAD_OF_IT** → any building\n\n' +
            'Also notifies Ticket Service via `PATCH /tickets/:id/status`.',
          operationId: 'reassignTicket',
          parameters: [
            {
              name: 'ticketId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Ticket ID to reassign',
              example: 101,
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['userId', 'toMemberId', 'userRole'],
                  properties: {
                    userId: { type: 'integer', description: 'User performing the reassignment', example: 20 },
                    toMemberId: { type: 'integer', description: 'Target group member ID', example: 3 },
                    userRole: { $ref: '#/components/schemas/UserRole' },
                    userBuilding: { type: 'string', description: 'Building of the user (optional)', example: 'A' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Ticket reassigned successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          ticketId: { type: 'integer', example: 101 },
                          fromGroup: { type: 'string', example: 'Building-A Floor-1 Support' },
                          toGroup: { type: 'string', example: 'Building-A Floor-2 Senior' },
                          toMember: { type: 'integer', example: 3 },
                          performedBy: { type: 'integer', example: 20 },
                          message: { type: 'string', example: 'Ticket reassigned to member 3 in group Building-A Floor-2 Senior' },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: 'Missing fields, ticket not found, or target member not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            403: {
              description: 'Insufficient authority (e.g. senior cross-building)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: false },
                      error: { type: 'string', example: 'Senior can only reassign within same building. Current: A, Target: B' },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/reassign/{ticketId}/targets': {
        get: {
          tags: ['Reassignment'],
          summary: 'Get available reassignment targets',
          description: 'Returns the list of members a ticket can be reassigned to, filtered by the caller\'s authority level.',
          operationId: 'getReassignmentTargets',
          parameters: [
            {
              name: 'ticketId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Ticket ID',
              example: 101,
            },
            {
              name: 'groupId',
              in: 'query',
              required: true,
              schema: { type: 'integer' },
              description: 'Current group ID',
              example: 1,
            },
            {
              name: 'userRole',
              in: 'query',
              required: true,
              schema: { $ref: '#/components/schemas/UserRole' },
              description: 'Role of the requesting user',
            },
            {
              name: 'userBuilding',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Building of the requesting user',
              example: 'A',
            },
          ],
          responses: {
            200: {
              description: 'Available targets retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          ticketId: { type: 'integer', example: 101 },
                          availableTargets: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/GroupMember' },
                          },
                          count: { type: 'integer', example: 5 },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: 'Missing required query params',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      // ══════════════════════════════════════
      //  Escalation
      // ══════════════════════════════════════
      '/workflow/escalate/{ticketId}': {
        post: {
          tags: ['Escalation'],
          summary: 'Escalate a ticket',
          description:
            'Escalates a ticket to the next support tier based on escalation rules.\n\n' +
            '**Trigger types:**\n' +
            '- `SLA` — automatic SLA breach\n' +
            '- `MANUAL` — requires `userRole` (SENIOR or SUPERVISOR only)\n' +
            '- `CRITICAL` — critical ticket auto-escalation\n' +
            '- `REOPEN_COUNT` — reopened too many times\n\n' +
            'Resets `assigned_member_id` and increments `escalation_count`.',
          operationId: 'escalateTicket',
          parameters: [
            {
              name: 'ticketId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Ticket ID to escalate',
              example: 102,
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['triggerType'],
                  properties: {
                    triggerType: { $ref: '#/components/schemas/EscalationTrigger' },
                    performedBy: { type: 'integer', description: 'User ID performing escalation (for MANUAL)', example: 20 },
                    userRole: {
                      $ref: '#/components/schemas/UserRole',
                      description: 'Required when triggerType is MANUAL',
                    },
                  },
                },
                examples: {
                  manual: {
                    summary: 'Manual escalation by senior',
                    value: { triggerType: 'MANUAL', performedBy: 20, userRole: 'SENIOR' },
                  },
                  sla: {
                    summary: 'SLA breach escalation',
                    value: { triggerType: 'SLA' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Ticket escalated successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          ticketId: { type: 'integer', example: 102 },
                          fromGroup: { type: 'string', example: 'Building-A Floor-1 Support' },
                          toGroup: { type: 'string', example: 'Building-A Floor-2 Senior' },
                          escalationCount: { type: 'integer', example: 1 },
                          triggerType: { type: 'string', example: 'MANUAL' },
                          message: { type: 'string', example: 'Ticket escalated to Building-A Floor-2 Senior' },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: 'Missing triggerType, no escalation rule found, or ticket not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            403: {
              description: 'Insufficient role for manual escalation',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: false },
                      error: { type: 'string', example: 'Only Seniors and Supervisors can escalate. User role: JUNIOR' },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/escalate/{ticketId}/history': {
        get: {
          tags: ['Escalation'],
          summary: 'Get escalation history for a ticket',
          description: 'Returns all workflow log entries with action ESCALATED for the given ticket.',
          operationId: 'getEscalationHistory',
          parameters: [
            {
              name: 'ticketId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Ticket ID',
              example: 102,
            },
          ],
          responses: {
            200: {
              description: 'Escalation history retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          ticketId: { type: 'integer', example: 102 },
                          escalations: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/WorkflowLog' },
                          },
                          count: { type: 'integer', example: 2 },
                        },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/group/{groupId}/escalation-path': {
        get: {
          tags: ['Escalation'],
          summary: 'Get escalation rules for a group',
          description: 'Returns all active escalation rules where the given group is the source.',
          operationId: 'getEscalationPath',
          parameters: [
            {
              name: 'groupId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Source support group ID',
              example: 1,
            },
          ],
          responses: {
            200: {
              description: 'Escalation path retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          groupId: { type: 'integer', example: 1 },
                          escalationRules: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/EscalationRule' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      // ══════════════════════════════════════
      //  Dashboards & Monitoring
      // ══════════════════════════════════════
      '/workflow/dashboard/audit/{ticketId}': {
        get: {
          tags: ['Dashboards'],
          summary: 'Get full audit trail for a ticket',
          description: 'Returns the complete immutable audit trail (all workflow log entries) for a specific ticket.',
          operationId: 'getAuditTrail',
          parameters: [
            {
              name: 'ticketId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Ticket ID',
              example: 101,
            },
          ],
          responses: {
            200: {
              description: 'Audit trail retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          ticketId: { type: 'integer', example: 101 },
                          totalActions: { type: 'integer', example: 3 },
                          logs: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                id: { type: 'integer' },
                                action: { type: 'string' },
                                timestamp: { type: 'string', format: 'date-time' },
                                performedBy: { type: 'integer', nullable: true },
                                fromGroup: { type: 'integer', nullable: true },
                                toGroup: { type: 'integer', nullable: true },
                                reason: { type: 'string', nullable: true },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/dashboard/building/{buildingId}': {
        get: {
          tags: ['Dashboards'],
          summary: 'Building-level dashboard',
          description: 'Returns a full dashboard for a building, including all groups, members, and ticket counts.',
          operationId: 'getBuildingDashboard',
          parameters: [
            {
              name: 'buildingId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Building identifier',
              example: 'A',
            },
          ],
          responses: {
            200: {
              description: 'Building dashboard retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          building: { type: 'string', example: 'A' },
                          totalTickets: { type: 'integer', example: 12 },
                          unassignedTickets: { type: 'integer', example: 4 },
                          escalatedTickets: { type: 'integer', example: 1 },
                          groups: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                groupId: { type: 'integer' },
                                groupName: { type: 'string' },
                                floor: { type: 'integer' },
                                members: { type: 'array', items: { type: 'object' } },
                                tickets: {
                                  type: 'object',
                                  properties: {
                                    total: { type: 'integer' },
                                    assigned: { type: 'integer' },
                                    unassigned: { type: 'integer' },
                                    escalated: { type: 'integer' },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/dashboard/member/{memberId}': {
        get: {
          tags: ['Dashboards'],
          summary: 'Member workload dashboard',
          description: 'Returns workload and permissions for a specific group member.',
          operationId: 'getMemberDashboard',
          parameters: [
            {
              name: 'memberId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Group member ID',
              example: 1,
            },
          ],
          responses: {
            200: {
              description: 'Member dashboard retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          memberId: { type: 'integer', example: 1 },
                          memberRole: { $ref: '#/components/schemas/MemberRole' },
                          groupId: { type: 'integer', example: 1 },
                          assignedTickets: { type: 'integer', example: 3 },
                          escalationCount: { type: 'integer', example: 0 },
                          joinedAt: { type: 'string', format: 'date-time' },
                          status: { $ref: '#/components/schemas/MemberStatus' },
                          permissions: {
                            type: 'object',
                            properties: {
                              canAssign: { type: 'boolean', example: false },
                              canEscalate: { type: 'boolean', example: false },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/dashboard/group/{groupId}/metrics': {
        get: {
          tags: ['Dashboards'],
          summary: 'Group performance metrics',
          description: 'Returns ticket distribution and performance metrics for a support group.',
          operationId: 'getGroupMetrics',
          parameters: [
            {
              name: 'groupId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Support group ID',
              example: 1,
            },
          ],
          responses: {
            200: {
              description: 'Group metrics retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          groupId: { type: 'integer', example: 1 },
                          groupName: { type: 'string', example: 'Building-A Floor-1 Support' },
                          building: { type: 'string', example: 'A' },
                          floor: { type: 'integer', example: 1 },
                          members: { type: 'integer', example: 5 },
                          tickets: {
                            type: 'object',
                            properties: {
                              total: { type: 'integer' },
                              assigned: { type: 'integer' },
                              unassigned: { type: 'integer' },
                              escalated: { type: 'integer' },
                            },
                          },
                          metrics: {
                            type: 'object',
                            properties: {
                              averageResolutionTime: { type: 'number', example: 0 },
                              escalationRate: { type: 'number', example: 0 },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/dashboard/activity/recent': {
        get: {
          tags: ['Dashboards'],
          summary: 'Recent workflow activity',
          description: 'Returns recent workflow actions across all tickets.',
          operationId: 'getRecentActivity',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 50 },
              description: 'Max number of entries to return',
            },
            {
              name: 'minutes',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 60 },
              description: 'Look-back window in minutes',
            },
          ],
          responses: {
            200: {
              description: 'Recent activity retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          period: { type: 'string', example: 'Last 60 minutes' },
                          totalActions: { type: 'integer', example: 10 },
                          logs: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                ticketId: { type: 'integer' },
                                action: { type: 'string' },
                                timestamp: { type: 'string', format: 'date-time' },
                                description: { type: 'string' },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      // ══════════════════════════════════════
      //  Workflow Logs
      // ══════════════════════════════════════
      '/workflow/logs/{ticketId}': {
        get: {
          tags: ['Workflow Logs'],
          summary: 'Get workflow action logs for a ticket',
          operationId: 'getWorkflowLogs',
          parameters: [
            { name: 'ticketId', in: 'path', required: true, schema: { type: 'string' }, description: 'Ticket UUID' },
          ],
          responses: {
            200: { description: 'Logs retrieved', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } } } } },
            500: { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },

      // ══════════════════════════════════════
      //  Group & Technician Tickets
      // ══════════════════════════════════════
      '/workflow/group/{groupId}/tickets': {
        get: {
          tags: ['Tickets'],
          summary: 'Get tickets assigned to a support group',
          operationId: 'getGroupTickets',
          parameters: [
            { name: 'groupId', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by status' },
            { name: 'building', in: 'query', schema: { type: 'string' }, description: 'Filter by building' },
            { name: 'technicianLevel', in: 'query', schema: { type: 'string' }, description: 'Filter by technician level' },
          ],
          responses: {
            200: { description: 'Tickets retrieved', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/TicketRoutingState' } } } } } } },
            500: { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },

      '/workflow/technician/{technicianId}/tickets': {
        get: {
          tags: ['Tickets'],
          summary: 'Get tickets assigned to a technician',
          operationId: 'getTechnicianTickets',
          parameters: [
            { name: 'technicianId', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by status' },
          ],
          responses: {
            200: { description: 'Tickets retrieved', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/TicketRoutingState' } } } } } } },
            500: { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },

      // ══════════════════════════════════════
      //  SLA Status
      // ══════════════════════════════════════
      '/workflow/sla/status': {
        post: {
          tags: ['SLA'],
          summary: 'Get SLA status for multiple tickets',
          operationId: 'getSLAStatus',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['ticket_ids'], properties: { ticket_ids: { type: 'array', items: { type: 'string' } } } } } },
          },
          responses: {
            200: { description: 'SLA status retrieved', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } } } } },
            400: { description: 'Bad request', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },

      // ══════════════════════════════════════
      //  Metrics
      // ══════════════════════════════════════
      '/workflow/metrics': {
        get: {
          tags: ['Metrics'],
          summary: 'Get comprehensive workflow metrics',
          operationId: 'getWorkflowMetrics',
          parameters: [
            { name: 'start_date', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'end_date', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: {
            200: { description: 'Metrics retrieved', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } } } } },
            500: { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },

      '/workflow/metrics/team/{groupId}': {
        get: {
          tags: ['Metrics'],
          summary: 'Get team-specific metrics',
          operationId: 'getTeamMetrics',
          parameters: [
            { name: 'groupId', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'start_date', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'end_date', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: {
            200: { description: 'Team metrics retrieved', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } } } } },
            500: { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },

      // ══════════════════════════════════════
      //  Reports
      // ══════════════════════════════════════
      '/workflow/reports/sla': {
        get: {
          tags: ['Reports'],
          summary: 'Get SLA compliance report',
          operationId: 'getSLAReport',
          parameters: [
            { name: 'start_date', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'end_date', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: {
            200: { description: 'SLA report retrieved', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } } } } },
            500: { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },

      '/workflow/reports/escalations': {
        get: {
          tags: ['Reports'],
          summary: 'Get escalation statistics report',
          operationId: 'getEscalationReport',
          parameters: [
            { name: 'start_date', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'end_date', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: {
            200: { description: 'Escalation report retrieved', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } } } } },
            500: { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },

      '/workflow/health': {
        get: {
          tags: ['Health'],
          summary: 'Workflow service health check',
          operationId: 'workflowHealthCheck',
          responses: {
            200: { description: 'Service healthy', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, service: { type: 'string' }, database: { type: 'string' }, timestamp: { type: 'string' }, uptime: { type: 'number' } } } } } },
            500: { description: 'Service unhealthy' },
          },
        },
      },

      // ══════════════════════════════════════
      //  Admin — Support Groups
      // ══════════════════════════════════════
      '/workflow/admin/support-groups': {
        post: {
          tags: ['Admin - Groups'],
          summary: 'Create a support group',
          description: 'Creates a new floor-based support group for a building.',
          operationId: 'createGroup',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'building', 'floor'],
                  properties: {
                    name: { type: 'string', description: 'Group display name', example: 'Building-A Floor-1 Support' },
                    building: { type: 'string', description: 'Building identifier', example: 'A' },
                    floor: { type: 'integer', description: 'Floor number', example: 1 },
                    parentGroupId: { type: 'integer', description: 'Parent group for hierarchy', nullable: true, example: null },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Group created successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'integer', example: 1 },
                          name: { type: 'string', example: 'Building-A Floor-1 Support' },
                          building: { type: 'string', example: 'A' },
                          floor: { type: 'integer', example: 1 },
                          parent_group_id: { type: 'integer', nullable: true, example: null },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: 'Missing required fields or duplicate building/floor',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/admin/groups/building/{building}': {
        get: {
          tags: ['Admin - Groups'],
          summary: 'List groups by building',
          description: 'Returns all active support groups in the given building, ordered by floor.',
          operationId: 'getGroupsByBuilding',
          parameters: [
            {
              name: 'building',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Building identifier',
              example: 'A',
            },
          ],
          responses: {
            200: {
              description: 'Groups retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/SupportGroup' },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/admin/groups/{groupId}': {
        get: {
          tags: ['Admin - Groups'],
          summary: 'Get group by ID',
          description: 'Returns a specific support group by its ID.',
          operationId: 'getGroupById',
          parameters: [
            {
              name: 'groupId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Support group ID',
              example: 1,
            },
          ],
          responses: {
            200: {
              description: 'Group found',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: { $ref: '#/components/schemas/SupportGroup' },
                    },
                  },
                },
              },
            },
            404: {
              description: 'Group not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/admin/groups/{groupId}/members': {
        get: {
          tags: ['Admin - Groups'],
          summary: 'List members of a group',
          description: 'Returns all active members in the given support group.',
          operationId: 'getGroupMembers',
          parameters: [
            {
              name: 'groupId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Support group ID',
              example: 1,
            },
          ],
          responses: {
            200: {
              description: 'Members retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/GroupMember' },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      // ══════════════════════════════════════
      //  Admin — Members
      // ══════════════════════════════════════
      '/workflow/admin/members': {
        post: {
          tags: ['Admin - Members'],
          summary: 'Add a member to a group',
          description: 'Registers a user as a technician in a support group with the specified role and permissions.',
          operationId: 'addMember',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['userId', 'groupId', 'role'],
                  properties: {
                    userId: { type: 'integer', description: 'Auth service user ID', example: 10 },
                    groupId: { type: 'integer', description: 'Target support group ID', example: 1 },
                    role: { $ref: '#/components/schemas/MemberRole' },
                    canAssign: { type: 'boolean', description: 'Can assign tickets', default: false },
                    canEscalate: { type: 'boolean', description: 'Can escalate tickets', default: false },
                  },
                },
                examples: {
                  junior: {
                    summary: 'Add a junior technician',
                    value: { userId: 10, groupId: 1, role: 'JUNIOR' },
                  },
                  senior: {
                    summary: 'Add a senior technician with permissions',
                    value: { userId: 20, groupId: 1, role: 'SENIOR', canAssign: true, canEscalate: true },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Member added successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'integer', example: 1 },
                          user_id: { type: 'integer', example: 10 },
                          group_id: { type: 'integer', example: 1 },
                          role: { type: 'string', example: 'JUNIOR' },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: 'Missing required fields or duplicate user/group combination',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/admin/members/{memberId}': {
        get: {
          tags: ['Admin - Members'],
          summary: 'Get member by ID',
          description: 'Returns details of a specific group member.',
          operationId: 'getMemberById',
          parameters: [
            {
              name: 'memberId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Group member ID',
              example: 1,
            },
          ],
          responses: {
            200: {
              description: 'Member found',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: { $ref: '#/components/schemas/GroupMember' },
                    },
                  },
                },
              },
            },
            404: {
              description: 'Member not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      '/workflow/admin/members/{memberId}/status': {
        patch: {
          tags: ['Admin - Members'],
          summary: 'Update member status',
          description: 'Changes a member\'s status (ACTIVE, INACTIVE, ON_LEAVE).',
          operationId: 'updateMemberStatus',
          parameters: [
            {
              name: 'memberId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Group member ID',
              example: 1,
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status'],
                  properties: {
                    status: { $ref: '#/components/schemas/MemberStatus' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Status updated',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      message: { type: 'string', example: 'Status updated' },
                    },
                  },
                },
              },
            },
            400: {
              description: 'Invalid status value',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },

      // ══════════════════════════════════════
      //  Admin — Escalation Rules
      // ══════════════════════════════════════
      '/workflow/admin/escalation-rules': {
        post: {
          tags: ['Admin - Escalation Rules'],
          summary: 'Create an escalation rule',
          description:
            'Defines a new escalation path from a source group to a target group, triggered by the specified condition.',
          operationId: 'createEscalationRule',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['sourceGroupId', 'targetGroupId', 'triggerType'],
                  properties: {
                    sourceGroupId: { type: 'integer', description: 'Source support group ID', example: 1 },
                    targetGroupId: { type: 'integer', description: 'Target support group ID', example: 2 },
                    triggerType: { $ref: '#/components/schemas/EscalationTrigger' },
                    delayMinutes: { type: 'integer', description: 'Delay before escalation (minutes)', default: 0, example: 30 },
                    priority: { type: 'integer', description: 'Rule priority (higher = first)', default: 0, example: 0 },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Escalation rule created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'integer', example: 1 },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: 'Missing required fields or invalid group IDs',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
        get: {
          tags: ['Admin - Escalation Rules'],
          summary: 'List all escalation rules',
          description: 'Returns all active escalation rules with source and target group names.',
          operationId: 'getAllEscalationRules',
          responses: {
            200: {
              description: 'Rules retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'array',
                        items: {
                          allOf: [
                            { $ref: '#/components/schemas/EscalationRule' },
                            {
                              type: 'object',
                              properties: {
                                source_group_name: { type: 'string', example: 'Building-A Floor-1 Support' },
                                target_group_name: { type: 'string', example: 'Building-A Floor-2 Senior' },
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
    },
  },
  apis: [], // All paths defined inline above — no JSDoc annotations needed
};

export const swaggerSpec = swaggerJsdoc(swaggerDefinition);
