import { ticketServiceClient, getTicket, getTicketAssignmentHistory, getTicketStatusHistory, getTicketEscalations, getUserDetails, getSlaStatusForTickets, getSlaTicket, ExternalCallContext } from '../config/externalServices';
import { ReportingRelationshipRepository } from '../repositories/ReportingRelationshipRepository';
import { TechnicianRepository } from '../repositories/TechnicianRepository';
import { WorkflowLogRepository } from '../repositories/WorkflowLogRepository';
import { ExternalTicket, ReportingRelationshipRow, TechnicianRow } from '../interfaces/types';

const SUPPORT_LEVEL_TO_ROLE: Record<string, 'JUNIOR' | 'SENIOR' | 'SUPERVISOR' | 'ADMIN'> = {
  L1: 'JUNIOR',
  L2: 'SENIOR',
  L3: 'SUPERVISOR',
  L4: 'ADMIN',
};

export interface DashboardFilters {
  limit?: number;
  offset?: number;
  status?: string;
  priority?: string;
  assignedTo?: string;
  level?: string;
  seniorId?: number;
  supervisorId?: number;
  dateFrom?: string;
  dateTo?: string;
  escalatedOnly?: boolean;
}

export interface DashboardRequestContext extends ExternalCallContext {
  endpoint?: string;
  scopeRole?: 'ADMIN' | 'SUPERVISOR' | 'SENIOR' | 'JUNIOR';
}

export type DashboardErrorCode =
  | 'DASHBOARD_DEPENDENCY_FAILED'
  | 'TICKET_SERVICE_UNAVAILABLE'
  | 'SLA_SERVICE_UNAVAILABLE'
  | 'WORKFLOW_DB_QUERY_FAILED';

export class DashboardDependencyError extends Error {
  public readonly code: DashboardErrorCode;
  public readonly statusCode: number;
  public readonly dependency: string;
  public readonly causeMessage: string | null;

  constructor(params: {
    code: DashboardErrorCode;
    statusCode: number;
    dependency: string;
    message: string;
    cause?: unknown;
  }) {
    super(params.message);
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.dependency = params.dependency;
    this.causeMessage = params.cause instanceof Error ? params.cause.message : (params.cause ? String(params.cause) : null);
  }
}

interface ScopeContext {
  role: 'ADMIN' | 'SUPERVISOR' | 'SENIOR' | 'JUNIOR';
  viewerUserId?: number;
  scopeUserIds: number[] | null;
}

interface HierarchyContext {
  junior: TechnicianRow | null;
  senior: TechnicianRow | null;
  supervisor: TechnicianRow | null;
}

interface TimelineEvent {
  timestamp: string;
  actor: string | null;
  actorRole: string | null;
  actionType: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  source: string;
}

export class RoleDashboardService {
  private technicianRepo = new TechnicianRepository();
  private relationshipRepo = new ReportingRelationshipRepository();
  private logRepo = new WorkflowLogRepository();

  private log(level: 'info' | 'warn' | 'error', message: string, context: DashboardRequestContext, extra: Record<string, unknown> = {}) {
    const payload = {
      requestId: context.requestId || null,
      endpoint: context.endpoint || null,
      scopeRole: context.scopeRole || null,
      ...extra,
    };
    const logger = level === 'info' ? console.info : level === 'warn' ? console.warn : console.error;
    logger(`[RoleDashboardService] ${message}`, payload);
  }

  private asDashboardContext(context?: DashboardRequestContext): DashboardRequestContext {
    return context || {};
  }

  async getAdminOverview(filters: DashboardFilters, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: 'ADMIN' });
    const scope: ScopeContext = { role: 'ADMIN', scopeUserIds: null };
    const tickets = await this.fetchScopedTickets(scope, filters, true, requestContext);
    return this.buildOverviewMetrics(tickets, scope, requestContext);
  }

  async getSupervisorOverview(supervisorUserId: number, filters: DashboardFilters, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: 'SUPERVISOR' });
    const scope = await this.buildSupervisorScope(supervisorUserId);
    const tickets = await this.fetchScopedTickets(scope, filters, true, requestContext);
    return this.buildOverviewMetrics(tickets, scope, requestContext);
  }

  async getSeniorOverview(seniorUserId: number, filters: DashboardFilters, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: 'SENIOR' });
    const scope = await this.buildSeniorScope(seniorUserId);
    const tickets = await this.fetchScopedTickets(scope, filters, true, requestContext);
    return this.buildOverviewMetrics(tickets, scope, requestContext);
  }

  async getJuniorOverview(juniorUserId: number, filters: DashboardFilters, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: 'JUNIOR' });
    const scope = await this.buildJuniorScope(juniorUserId);
    const tickets = await this.fetchScopedTickets(scope, filters, true, requestContext);
    return this.buildOverviewMetrics(tickets, scope, requestContext);
  }

  async getAdminTickets(filters: DashboardFilters, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: 'ADMIN' });
    const scope: ScopeContext = { role: 'ADMIN', scopeUserIds: null };
    return this.buildTicketListResponse(scope, filters, requestContext);
  }

  async getAdminTicketDetails(ticketId: string, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: 'ADMIN' });
    const scope: ScopeContext = { role: 'ADMIN', scopeUserIds: null };
    return this.getTicketDetails(ticketId, scope, requestContext);
  }

  async getSupervisorTickets(supervisorUserId: number, filters: DashboardFilters, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: 'SUPERVISOR' });
    const scope = await this.buildSupervisorScope(supervisorUserId);
    return this.buildTicketListResponse(scope, filters, requestContext);
  }

  async getSupervisorTicketDetails(supervisorUserId: number, ticketId: string, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: 'SUPERVISOR' });
    const scope = await this.buildSupervisorScope(supervisorUserId);
    return this.getTicketDetails(ticketId, scope, requestContext);
  }

  async getSeniorTickets(seniorUserId: number, filters: DashboardFilters, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: 'SENIOR' });
    const scope = await this.buildSeniorScope(seniorUserId);
    return this.buildTicketListResponse(scope, filters, requestContext);
  }

  async getSeniorTicketDetails(seniorUserId: number, ticketId: string, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: 'SENIOR' });
    const scope = await this.buildSeniorScope(seniorUserId);
    return this.getTicketDetails(ticketId, scope, requestContext);
  }

  async getJuniorTickets(juniorUserId: number, filters: DashboardFilters, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: 'JUNIOR' });
    const scope = await this.buildJuniorScope(juniorUserId);
    return this.buildTicketListResponse(scope, filters, requestContext);
  }

  async getJuniorTicketDetails(juniorUserId: number, ticketId: string, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: 'JUNIOR' });
    const scope = await this.buildJuniorScope(juniorUserId);
    return this.getTicketDetails(ticketId, scope, requestContext);
  }

  async getTicketDetails(ticketId: string, scope: ScopeContext, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: scope.role });
    const ticket = await getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    this.assertTicketInScope(ticket, scope);

    const assignedUserId = this.toNumericUserId(ticket.assigned_to);
    const hierarchy = await this.safeResolveHierarchyContext(assignedUserId, undefined, requestContext);
    const assignedTechnician = hierarchy.junior || hierarchy.senior || hierarchy.supervisor;
    const assignedToLevel = this.resolveOwnerRole(assignedTechnician?.level || ticket.assigned_to_level || null);
    const ownershipType = this.resolveOwnershipType(scope, assignedUserId, assignedToLevel, ticket.escalation_count ?? 0);
    const allowedActions = this.buildAllowedActions(scope, assignedUserId, assignedToLevel, ticket.status);
    const requesterDetails = ticket.requester_id
      ? await this.safeFetchUser(ticket.requester_id, requestContext)
      : null;

    const assignmentHistory = await this.safeTicketHistory(getTicketAssignmentHistory, ticketId, requestContext);
    const statusHistory = await this.safeTicketHistory(getTicketStatusHistory, ticketId, requestContext);
    const escalationHistory = await this.safeTicketHistory(getTicketEscalations, ticketId, requestContext);
    const optionalDetails = await Promise.allSettled([
      this.logRepo.getTicketLogs(ticketId),
      this.fetchWorkflowSlaDetail(ticketId, requestContext),
    ]);
    const workflowLogs = optionalDetails[0].status === 'fulfilled' ? optionalDetails[0].value : [];
    const slaRecord = optionalDetails[1].status === 'fulfilled' ? optionalDetails[1].value : null;

    if (optionalDetails[0].status === 'rejected') {
      this.log('warn', 'Workflow logs lookup failed during ticket details', requestContext, {
        dependency: 'workflow-db.workflow_logs',
        ticketId,
        error: optionalDetails[0].reason instanceof Error ? optionalDetails[0].reason.message : String(optionalDetails[0].reason),
      });
    }
    if (optionalDetails[1].status === 'rejected') {
      this.log('warn', 'SLA detail lookup failed during ticket details', requestContext, {
        dependency: 'sla-service./sla/tickets/:ticketId',
        ticketId,
        error: optionalDetails[1].reason instanceof Error ? optionalDetails[1].reason.message : String(optionalDetails[1].reason),
      });
    }

    const assignmentItems = assignmentHistory?.items || [];
    const statusItems = statusHistory?.items || [];
    const escalationItems = escalationHistory?.items || [];

    const escalationHistoryPayload = this.buildEscalationHistory(assignmentItems, escalationItems);
    const assignmentHistoryPayload = assignmentItems.map((item: any) => ({
      previousAssignee: item.previous_assignee ?? null,
      newAssignee: item.new_assignee ?? null,
      previousLevel: item.previous_level ?? null,
      newLevel: item.new_level ?? null,
      method: item.method,
      reason: item.reason ?? null,
      performedBy: item.performed_by ?? null,
      performedByRole: item.performed_by_role ?? null,
      timestamp: item.created_at,
    }));

    const statusHistoryPayload = statusItems.map((item: any) => ({
      oldStatus: item.old_status,
      newStatus: item.new_status,
      performedBy: item.performed_by ?? null,
      performedByRole: item.performed_by_role ?? null,
      reason: item.reason ?? null,
      timestamp: item.created_at,
    }));

    const workflowLogPayload = workflowLogs.map((log) => ({
      id: log.id,
      action: log.action,
      timestamp: log.created_at,
      performedBy: log.performed_by ?? null,
      fromGroup: log.from_group_id ?? null,
      toGroup: log.to_group_id ?? null,
      reason: log.reason ?? null,
    }));

    const slaEvents = this.buildSlaEvents(slaRecord);
    const timeline = this.buildTimelineEvents(ticket, requesterDetails, assignmentItems, statusItems, escalationItems, workflowLogs, slaEvents);

    return {
      ticket: {
        id: String(ticket.id),
        title: ticket.title ?? null,
        description: ticket.description ?? null,
        status: ticket.status ?? null,
        priority: ticket.priority ?? null,
        assignedTo: ticket.assigned_to ?? null,
        assignedToName: assignedTechnician?.name ?? null,
        assignedToEmail: assignedTechnician?.email ?? null,
        assignedToLevel: assignedToLevel,
        assignedToLevelCode: ticket.assigned_to_level ?? null,
        currentOwnerRole: assignedToLevel,
        ownershipType,
        requester: requesterDetails?.name || ticket.requester_id || null,
        requesterId: ticket.requester_id ?? null,
        building: ticket.building ?? null,
        room: ticket.room ?? null,
        latitude: ticket.latitude ?? null,
        longitude: ticket.longitude ?? null,
        location: this.buildLocationPayload(ticket),
        createdAt: ticket.created_at ?? null,
        updatedAt: ticket.updated_at ?? null,
        closedAt: ticket.closed_at ?? null,
        escalationCount: ticket.escalation_count ?? 0,
      },
      hierarchy: {
        assignedTechnician: assignedTechnician ? this.formatTechnician(assignedTechnician) : null,
        senior: hierarchy.senior ? this.formatTechnician(hierarchy.senior) : null,
        supervisor: hierarchy.supervisor ? this.formatTechnician(hierarchy.supervisor) : null,
      },
      escalationHistory: escalationHistoryPayload,
      assignmentHistory: assignmentHistoryPayload,
      statusHistory: statusHistoryPayload,
      workflowLogs: workflowLogPayload,
      slaEvents,
      timeline,
      allowedActions,
    };
  }

  private async buildTicketListResponse(scope: ScopeContext, filters: DashboardFilters, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: scope.role });
    const tickets = await this.fetchScopedTickets(scope, filters, true, requestContext);
    const total = tickets.length;
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    const paged = tickets.slice(offset, offset + limit);

    const assignedUserIds = this.extractAssignedUserIds(paged);
    let technicians: TechnicianRow[] = [];
    try {
      technicians = await this.technicianRepo.getByUserIds(assignedUserIds);
    } catch (error: unknown) {
      this.log('warn', 'Technician lookup failed for dashboard list; continuing without names', requestContext, {
        dependency: 'workflow-db.technicians',
        assignedUserCount: assignedUserIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const technicianMap = new Map(technicians.map((tech) => [tech.user_id, tech]));
    const hierarchyCache = new Map<number, HierarchyContext>();

    const slaMap = await this.buildSlaMap(paged.map((ticket) => String(ticket.id)), requestContext);
    const requesterMap = await this.buildRequesterMap(
      paged.map((ticket) => ticket.requester_id).filter(Boolean) as string[],
      requestContext,
    );

    const items = await Promise.all(
      paged.map(async (ticket) => {
        const assignedUserId = this.toNumericUserId(ticket.assigned_to);
        const technician = assignedUserId ? technicianMap.get(assignedUserId) || null : null;
        const hierarchy = await this.safeResolveHierarchyContext(assignedUserId, hierarchyCache, requestContext);
        const requester = ticket.requester_id ? requesterMap.get(String(ticket.requester_id)) : null;
        const sla = slaMap.get(String(ticket.id));
        const assignedToLevel = this.resolveOwnerRole(technician?.level || ticket.assigned_to_level || null);
        const ownershipType = this.resolveOwnershipType(scope, assignedUserId, assignedToLevel, ticket.escalation_count ?? 0);
        const allowedActions = this.buildAllowedActions(scope, assignedUserId, assignedToLevel, ticket.status);

        return {
          ticketId: String(ticket.id),
          title: ticket.title ?? null,
          descriptionPreview: this.buildDescriptionPreview(ticket.description),
          status: ticket.status ?? null,
          priority: ticket.priority ?? null,
          assignedTo: ticket.assigned_to ?? null,
          assignedToName: technician?.name ?? null,
          assignedToEmail: technician?.email ?? null,
          assignedToLevel: assignedToLevel,
          assignedToLevelCode: ticket.assigned_to_level ?? null,
          currentOwnerRole: assignedToLevel,
          ownershipType,
          requesterId: ticket.requester_id ?? null,
          requesterName: requester?.name ?? null,
          building: ticket.building ?? null,
          room: ticket.room ?? null,
          latitude: ticket.latitude ?? null,
          longitude: ticket.longitude ?? null,
          location: this.buildLocationPayload(ticket),
          escalationCount: ticket.escalation_count ?? 0,
          createdAt: ticket.created_at ?? null,
          updatedAt: ticket.updated_at ?? null,
          hierarchy: {
            junior: hierarchy.junior ? this.formatTechnician(hierarchy.junior) : null,
            senior: hierarchy.senior ? this.formatTechnician(hierarchy.senior) : null,
            supervisor: hierarchy.supervisor ? this.formatTechnician(hierarchy.supervisor) : null,
          },
          allowedActions,
          flags: {
            isEscalated: (ticket.escalation_count ?? 0) > 0,
            isOverdue: sla?.sla_breached ?? false,
            requiresAttention: this.requiresAttention(ticket, sla),
          },
        };
      }),
    );

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  private async fetchScopedTickets(
    scope: ScopeContext,
    filters: DashboardFilters,
    ignorePagination: boolean,
    context?: DashboardRequestContext,
  ) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: scope.role });
    const assignedFilter = this.resolveAssignedFilter(scope, filters);
    if (assignedFilter && assignedFilter.length === 0) {
      this.log('info', 'No scoped assignees resolved; returning empty ticket list', requestContext, {
        dependency: 'workflow-scope',
      });
      return [];
    }

    const params: Record<string, string> = {};
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (assignedFilter && assignedFilter.length > 0) {
      params.assigned_to = assignedFilter.join(',');
    }
    if (!ignorePagination) {
      params.limit = String(filters.limit ?? 50);
      params.offset = String(filters.offset ?? 0);
    }

    this.log('info', 'Fetching scoped tickets from ticket service', requestContext, {
      dependency: 'ticket-service./tickets',
      params,
    });

    let rawTickets: ExternalTicket[] = [];
    try {
      const { data } = await ticketServiceClient.get('/tickets', { params });
      rawTickets = Array.isArray(data) ? data : data?.tickets || [];
      this.log('info', 'Ticket service response received', requestContext, {
        dependency: 'ticket-service./tickets',
        ticketCount: rawTickets.length,
      });
    } catch (error: any) {
      const status = error?.response?.status;
      const message = error?.message || 'Failed to fetch tickets from ticket service';

      this.log('error', 'Ticket service fetch failed', requestContext, {
        dependency: 'ticket-service./tickets',
        statusCode: status ?? null,
        params,
        error: message,
      });

      throw new DashboardDependencyError({
        code: 'TICKET_SERVICE_UNAVAILABLE',
        statusCode: 502,
        dependency: 'ticket-service./tickets',
        message: 'Ticket service unavailable for dashboard query',
        cause: error,
      });
    }

    const tickets = rawTickets.filter((ticket: ExternalTicket) => !ticket.is_deleted);
    const filtered = await this.applyPostFilters(tickets, filters, requestContext);

    return filtered;
  }

  private async applyPostFilters(tickets: ExternalTicket[], filters: DashboardFilters, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext(context);
    let filtered = tickets;

    if (filters.dateFrom || filters.dateTo) {
      filtered = filtered.filter((ticket) => {
        const candidateDate = this.parseTicketDate(ticket);
        if (!candidateDate) return false;
        if (filters.dateFrom && candidateDate < new Date(filters.dateFrom)) return false;
        if (filters.dateTo && candidateDate > new Date(filters.dateTo)) return false;
        return true;
      });
    }

    if (filters.escalatedOnly) {
      filtered = filtered.filter((ticket) => (ticket.escalation_count ?? 0) > 0);
    }

    if (filters.level || filters.seniorId || filters.supervisorId) {
      const assignedUserIds = this.extractAssignedUserIds(filtered);
      let technicians: TechnicianRow[] = [];
      try {
        technicians = await this.technicianRepo.getByUserIds(assignedUserIds);
      } catch (error: unknown) {
        this.log('warn', 'Technician lookup failed during post filters; skipping level-based refinement', requestContext, {
          dependency: 'workflow-db.technicians',
          assignedUserCount: assignedUserIds.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      const technicianMap = new Map(technicians.map((tech) => [tech.user_id, tech]));

      if (filters.level) {
        const targetLevel = String(filters.level).toUpperCase();
        filtered = filtered.filter((ticket) => {
          const assignedId = this.toNumericUserId(ticket.assigned_to);
          const tech = assignedId ? technicianMap.get(assignedId) : null;
          const resolvedLevel = tech?.level || this.resolveSupportLevel(ticket.assigned_to_level);
          return resolvedLevel === targetLevel;
        });
      }

      if (filters.seniorId) {
        const seniorScope = await this.resolveSeniorScopeIds(filters.seniorId);
        filtered = filtered.filter((ticket) => {
          const assignedId = this.toNumericUserId(ticket.assigned_to);
          return assignedId != null && seniorScope.has(assignedId);
        });
      }

      if (filters.supervisorId) {
        const supervisorScope = await this.resolveSupervisorScopeIds(filters.supervisorId);
        filtered = filtered.filter((ticket) => {
          const assignedId = this.toNumericUserId(ticket.assigned_to);
          return assignedId != null && supervisorScope.has(assignedId);
        });
      }
    }

    return filtered;
  }

  private resolveAssignedFilter(scope: ScopeContext, filters: DashboardFilters) {
    if (!scope.scopeUserIds) {
      if (filters.assignedTo) {
        return [filters.assignedTo];
      }
      return null;
    }

    if (filters.assignedTo) {
      const assignedId = Number(filters.assignedTo);
      if (!Number.isFinite(assignedId)) return [];
      return scope.scopeUserIds.includes(assignedId) ? [String(assignedId)] : [];
    }

    return scope.scopeUserIds.map((id) => String(id));
  }

  private async buildSupervisorScope(supervisorUserId: number): Promise<ScopeContext> {
    const seniorUserIds = await this.relationshipRepo.getSeniorsForSupervisor(supervisorUserId);
    const juniorsBySenior = await Promise.all(
      seniorUserIds.map((seniorId) => this.relationshipRepo.getJuniorsForSenior(seniorId)),
    );
    const juniorUserIds = juniorsBySenior.flat();
    const scopeUserIds = Array.from(new Set([supervisorUserId, ...seniorUserIds, ...juniorUserIds]));
    return { role: 'SUPERVISOR', viewerUserId: supervisorUserId, scopeUserIds };
  }

  private async buildSeniorScope(seniorUserId: number): Promise<ScopeContext> {
    const juniorUserIds = await this.relationshipRepo.getJuniorsForSenior(seniorUserId);
    const scopeUserIds = Array.from(new Set([seniorUserId, ...juniorUserIds]));
    return { role: 'SENIOR', viewerUserId: seniorUserId, scopeUserIds };
  }

  private async buildJuniorScope(juniorUserId: number): Promise<ScopeContext> {
    return { role: 'JUNIOR', viewerUserId: juniorUserId, scopeUserIds: [juniorUserId] };
  }

  private async resolveHierarchyContext(userId: number | null, cache?: Map<number, HierarchyContext>) {
    if (!userId) {
      return { junior: null, senior: null, supervisor: null };
    }

    if (cache?.has(userId)) {
      return cache.get(userId)!;
    }

    const assigned = await this.technicianRepo.getByUserId(userId);
    if (!assigned) {
      const empty = { junior: null, senior: null, supervisor: null };
      cache?.set(userId, empty);
      return empty;
    }

    let junior: TechnicianRow | null = null;
    let senior: TechnicianRow | null = null;
    let supervisor: TechnicianRow | null = null;

    if (assigned.level === 'JUNIOR') {
      junior = assigned;
      const seniorRel = await this.relationshipRepo.getManagerByRelationshipType(userId, 'JUNIOR_TO_SENIOR');
      senior = seniorRel ? await this.technicianRepo.getByUserId(seniorRel.parent_user_id) : null;
      if (senior) {
        const supervisorRel = await this.relationshipRepo.getManagerByRelationshipType(senior.user_id, 'SENIOR_TO_SUPERVISOR');
        supervisor = supervisorRel ? await this.technicianRepo.getByUserId(supervisorRel.parent_user_id) : null;
      }
    } else if (assigned.level === 'SENIOR') {
      senior = assigned;
      const supervisorRel = await this.relationshipRepo.getManagerByRelationshipType(userId, 'SENIOR_TO_SUPERVISOR');
      supervisor = supervisorRel ? await this.technicianRepo.getByUserId(supervisorRel.parent_user_id) : null;
    } else if (assigned.level === 'SUPERVISOR') {
      supervisor = assigned;
    } else if (assigned.level === 'ADMIN') {
      supervisor = assigned;
    }

    const result = { junior, senior, supervisor };
    cache?.set(userId, result);
    return result;
  }

  private async safeResolveHierarchyContext(
    userId: number | null,
    cache?: Map<number, HierarchyContext>,
    context?: DashboardRequestContext,
  ): Promise<HierarchyContext> {
    const requestContext = this.asDashboardContext(context);
    try {
      return await this.resolveHierarchyContext(userId, cache);
    } catch (error: unknown) {
      this.log('warn', 'Hierarchy lookup failed; continuing without hierarchy enrichment', requestContext, {
        dependency: 'workflow-db.reporting_relationships',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { junior: null, senior: null, supervisor: null };
    }
  }

  private buildDescriptionPreview(description?: string) {
    if (!description) return null;
    const trimmed = description.trim();
    if (trimmed.length <= 140) return trimmed;
    return `${trimmed.slice(0, 137)}...`;
  }

  private buildLocationPayload(ticket: ExternalTicket) {
    const building = ticket.building ?? null;
    const room = ticket.room ?? null;
    const latitude = ticket.latitude ?? null;
    const longitude = ticket.longitude ?? null;

    if (building || room) {
      return { building, room };
    }

    const lat = Number(latitude);
    const lon = Number(longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { latitude: lat, longitude: lon };
    }

    return null;
  }

  private extractAssignedUserIds(tickets: ExternalTicket[]) {
    const ids = new Set<number>();
    tickets.forEach((ticket) => {
      const userId = this.toNumericUserId(ticket.assigned_to);
      if (userId != null) ids.add(userId);
    });
    return Array.from(ids);
  }

  private toNumericUserId(value: number | string | null | undefined): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private resolveSupportLevel(level?: string | null) {
    if (!level) return null;
    return SUPPORT_LEVEL_TO_ROLE[level] || null;
  }

  private resolveOwnerRole(level?: string | null) {
    if (!level) return null;
    const normalized = String(level || '').toUpperCase();
    if (!normalized) return null;
    if (['JUNIOR', 'SENIOR', 'SUPERVISOR', 'ADMIN'].includes(normalized)) {
      return normalized as 'JUNIOR' | 'SENIOR' | 'SUPERVISOR' | 'ADMIN';
    }
    return SUPPORT_LEVEL_TO_ROLE[normalized] || null;
  }

  private resolveOwnershipType(
    scope: ScopeContext,
    assignedUserId: number | null,
    assignedRole: string | null,
    escalationCount: number,
  ) {
    if (!assignedRole) return 'UNASSIGNED';
    const isEscalated = escalationCount > 0;

    if (scope.role === 'SENIOR') {
      if (assignedRole === 'JUNIOR') return 'TEAM_JUNIOR_TICKET';
      if (assignedRole === 'SENIOR') {
        if (scope.viewerUserId != null && assignedUserId === scope.viewerUserId) {
          return isEscalated ? 'ESCALATED_TO_SENIOR' : 'DIRECT_SENIOR_TICKET';
        }
        return 'TEAM_SENIOR_TICKET';
      }
    }

    if (scope.role === 'SUPERVISOR') {
      if (assignedRole === 'JUNIOR') return 'TEAM_JUNIOR_TICKET';
      if (assignedRole === 'SENIOR') return 'TEAM_SENIOR_TICKET';
      if (assignedRole === 'SUPERVISOR') {
        if (scope.viewerUserId != null && assignedUserId === scope.viewerUserId) {
          return isEscalated ? 'ESCALATED_TO_SUPERVISOR' : 'DIRECT_SUPERVISOR_TICKET';
        }
        return 'TEAM_SUPERVISOR_TICKET';
      }
    }

    return 'TEAM_TICKET';
  }

  private buildAllowedActions(
    scope: ScopeContext,
    assignedUserId: number | null,
    assignedRole: string | null,
    status: string | null,
  ) {
    const normalizedStatus = String(status || '').toUpperCase();
    const isClosed = normalizedStatus === 'RESOLVED' || normalizedStatus === 'CLOSED';
    const isOwner = scope.viewerUserId != null
      && assignedUserId != null
      && scope.viewerUserId === assignedUserId;
    const canStart = isOwner && (normalizedStatus === 'OPEN' || normalizedStatus === 'ESCALATED');
    const canResolve = isOwner && normalizedStatus === 'IN_PROGRESS';
    const canEscalate = isOwner && !isClosed
      && ['JUNIOR', 'SENIOR', 'SUPERVISOR'].includes(String(assignedRole || ''));

    return {
      canStart,
      canResolve,
      canEscalate,
      canReassign: false,
      canViewDetails: true,
    };
  }

  private parseTicketDate(ticket: ExternalTicket) {
    const candidates = [ticket.created_at, ticket.updated_at, ticket.closed_at];
    for (const raw of candidates) {
      if (!raw) continue;
      const date = new Date(raw as any);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return null;
  }

  private async buildSlaMap(ticketIds: string[], context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext(context);
    const normalizedTicketIds = Array.from(new Set(ticketIds.map((id) => String(id || '').trim()).filter(Boolean)));
    if (normalizedTicketIds.length === 0) {
      return new Map<string, any>();
    }

    let records: any[] = [];
    try {
      records = Object.values(
        await getSlaStatusForTickets(normalizedTicketIds, {
          requestId: requestContext.requestId,
          caller: requestContext.endpoint || 'RoleDashboardService.buildSlaMap',
        }),
      ).filter(Boolean) as any[];
    } catch (error: unknown) {
      this.log('warn', 'SLA bulk status lookup failed; continuing without SLA enrichment', requestContext, {
        dependency: 'sla-service./sla/tickets/status',
        ticketCount: normalizedTicketIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Map<string, any>();
    }

    const map = new Map<string, any>();
    records.forEach((record) => {
      map.set(record.ticket_id, record);
    });
    return map;
  }

  private async buildRequesterMap(requesterIds: string[], context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext(context);
    const unique = Array.from(new Set(requesterIds.filter(Boolean)));
    const results = await Promise.allSettled(unique.map((id) => this.safeFetchUser(id, requestContext)));
    const map = new Map<string, any>();
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        map.set(unique[index], result.value);
      }
    });
    return map;
  }

  private async safeFetchUser(userId: string, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext(context);
    try {
      return await getUserDetails(userId as any);
    } catch (error: unknown) {
      this.log('warn', 'Requester lookup failed; returning null', requestContext, {
        dependency: 'auth-service./users/:id',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async safeTicketHistory(
    fetcher: (ticketId: string) => Promise<any>,
    ticketId: string,
    context?: DashboardRequestContext,
  ) {
    const requestContext = this.asDashboardContext(context);
    try {
      return await fetcher(ticketId);
    } catch (error: unknown) {
      this.log('warn', 'Ticket history lookup failed; continuing without history segment', requestContext, {
        dependency: 'ticket-service.history',
        ticketId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private formatTechnician(technician: TechnicianRow) {
    return {
      userId: technician.user_id,
      name: technician.name,
      email: technician.email,
      level: technician.level,
    };
  }

  private requiresAttention(ticket: ExternalTicket, slaRecord: any) {
    const priority = String(ticket.priority || '').toUpperCase();
    if (priority === 'CRITICAL' || priority === 'HIGH') return true;
    if (slaRecord?.sla_breached) return true;
    if ((ticket.escalation_count ?? 0) > 0) return true;
    return false;
  }

  private buildSlaEvents(slaRecord: any) {
    if (!slaRecord) return [];
    const events: any[] = [];
    if (slaRecord.sla_deadline) {
      events.push({
        type: 'SLA_DEADLINE',
        timestamp: slaRecord.sla_deadline,
      });
    }
    if (slaRecord.sla_breached && slaRecord.breached_at) {
      events.push({
        type: 'SLA_BREACH',
        timestamp: slaRecord.breached_at,
      });
    }
    return events;
  }

  private async fetchWorkflowSlaDetail(ticketId: string, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext(context);
    let sla: any | null = null;
    try {
      sla = await getSlaTicket(ticketId);
    } catch (error: unknown) {
      this.log('warn', 'SLA detail lookup failed; continuing without SLA timeline', requestContext, {
        dependency: 'sla-service./sla/tickets/:id',
        ticketId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    if (!sla) return null;

    const breachedEvent = Array.isArray(sla.events)
      ? sla.events.find((event: any) =>
          event.eventType === 'RESPONSE_BREACHED' || event.eventType === 'RESOLUTION_BREACHED')
      : null;

    const deadline = sla.firstResponseAt ? sla.resolutionDueAt : sla.responseDueAt;
    const breached =
      sla.status === 'BREACHED' || sla.responseBreachSent || sla.resolutionBreachSent;

    return {
      ticket_id: sla.ticketId,
      sla_deadline: deadline,
      sla_breached: breached,
      breached_at: breachedEvent?.createdAt ?? null,
    };
  }

  private buildTimelineEvents(
    ticket: ExternalTicket,
    requester: any,
    assignmentItems: any[],
    statusItems: any[],
    escalationItems: any[],
    workflowLogs: any[],
    slaEvents: any[],
  ): TimelineEvent[] {
    const events: TimelineEvent[] = [];

    if (ticket.created_at) {
      events.push({
        timestamp: String(ticket.created_at),
        actor: requester?.name || ticket.requester_id || null,
        actorRole: requester?.role || 'REQUESTER',
        actionType: 'CREATED',
        newValue: { status: ticket.status },
        source: 'ticket-service',
      });
    }

    assignmentItems.forEach((item) => {
      const actionType = item.method === 'ESCALATION'
        ? 'ESCALATED'
        : item.previous_assignee && item.previous_assignee !== item.new_assignee
        ? 'REASSIGNED'
        : 'ASSIGNED';
      events.push({
        timestamp: String(item.created_at),
        actor: item.performed_by ?? null,
        actorRole: item.performed_by_role ?? null,
        actionType,
        oldValue: {
          assignee: item.previous_assignee,
          level: item.previous_level,
        },
        newValue: {
          assignee: item.new_assignee,
          level: item.new_level,
        },
        reason: item.reason ?? null,
        source: 'ticket-service',
      });
    });

    statusItems.forEach((item) => {
      events.push({
        timestamp: String(item.created_at),
        actor: item.performed_by ?? null,
        actorRole: item.performed_by_role ?? null,
        actionType: 'STATUS_CHANGED',
        oldValue: item.old_status,
        newValue: item.new_status,
        reason: item.reason ?? null,
        source: 'ticket-service',
      });
    });

    escalationItems.forEach((item) => {
      events.push({
        timestamp: String(item.created_at),
        actor: null,
        actorRole: null,
        actionType: 'ESCALATION_RECORDED',
        oldValue: item.from_level,
        newValue: item.to_level,
        reason: item.reason ?? null,
        source: 'ticket-service',
      });
    });

    workflowLogs.forEach((log) => {
      events.push({
        timestamp: String(log.created_at),
        actor: log.performed_by != null ? String(log.performed_by) : null,
        actorRole: null,
        actionType: log.action,
        oldValue: log.from_group_id ?? null,
        newValue: log.to_group_id ?? null,
        reason: log.reason ?? null,
        source: 'workflow',
      });
    });

    slaEvents.forEach((event) => {
      events.push({
        timestamp: String(event.timestamp),
        actor: null,
        actorRole: null,
        actionType: event.type,
        source: 'sla',
      });
    });

    return events
      .filter((event) => event.timestamp)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  private buildEscalationHistory(assignmentItems: any[], escalationItems: any[]) {
    const fromAssignments = assignmentItems
      .filter((item) => item.method === 'ESCALATION')
      .map((item) => ({
        fromAssignee: item.previous_assignee ?? null,
        toAssignee: item.new_assignee ?? null,
        fromLevel: item.previous_level ?? null,
        toLevel: item.new_level ?? null,
        reason: item.reason ?? null,
        performedBy: item.performed_by ?? null,
        performedByRole: item.performed_by_role ?? null,
        timestamp: item.created_at,
      }));

    if (fromAssignments.length > 0) {
      return fromAssignments;
    }

    return escalationItems.map((item) => ({
      fromAssignee: null,
      toAssignee: null,
      fromLevel: item.from_level ?? null,
      toLevel: item.to_level ?? null,
      reason: item.reason ?? null,
      performedBy: null,
      performedByRole: null,
      timestamp: item.created_at,
    }));
  }

  private async buildOverviewMetrics(tickets: ExternalTicket[], scope?: ScopeContext, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: scope?.role || context?.scopeRole });
    const statusCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    const technicianCounts: Record<string, number> = {};

    tickets.forEach((ticket) => {
      const status = String(ticket.status || 'UNKNOWN').toUpperCase();
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      const priority = String(ticket.priority || 'UNKNOWN').toUpperCase();
      priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;

      const assignedTo = ticket.assigned_to != null ? String(ticket.assigned_to) : null;
      if (assignedTo) {
        technicianCounts[assignedTo] = (technicianCounts[assignedTo] || 0) + 1;
      }
    });

    const escalationCount = tickets.filter((ticket) => (ticket.escalation_count ?? 0) > 0).length;

    const resolvedTickets = tickets.filter((ticket) => {
      const status = String(ticket.status || '').toUpperCase();
      return status === 'RESOLVED' || status === 'CLOSED';
    });
    const resolutionMinutes = resolvedTickets
      .map((ticket) => {
        const createdAt = this.parseTicketDate({ ...ticket, updated_at: ticket.created_at });
        const completedAt = ticket.closed_at || ticket.updated_at || ticket.created_at;
        if (!createdAt || !completedAt) return null;
        const end = new Date(completedAt as any);
        if (Number.isNaN(end.getTime())) return null;
        return Math.max(0, (end.getTime() - createdAt.getTime()) / 1000 / 60);
      })
      .filter((value): value is number => value != null);
    const avgResolutionMinutes = resolutionMinutes.length > 0
      ? Math.round(resolutionMinutes.reduce((sum, value) => sum + value, 0) / resolutionMinutes.length)
      : 0;

    const assignedUserIds = this.extractAssignedUserIds(tickets);
    let technicians: TechnicianRow[] = [];
    try {
      technicians = await this.technicianRepo.getByUserIds(assignedUserIds);
    } catch (error: unknown) {
      this.log('warn', 'Technician lookup failed during overview metrics; continuing with empty technician list', requestContext, {
        dependency: 'workflow-db.technicians',
        assignedUserCount: assignedUserIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const ticketCountsByUser = new Map<number, number>();
    tickets.forEach((ticket) => {
      const assignedId = this.toNumericUserId(ticket.assigned_to);
      if (assignedId != null) {
        ticketCountsByUser.set(assignedId, (ticketCountsByUser.get(assignedId) || 0) + 1);
      }
    });
    const ticketsPerTechnician = technicians.map((tech) => ({
      userId: tech.user_id,
      name: tech.name,
      email: tech.email,
      level: tech.level,
      ticketCount: ticketCountsByUser.get(tech.user_id) || 0,
    }));

    const ticketsPerSeniorTeam = await this.buildSeniorTeamCounts(tickets, scope, requestContext);

    let slaRecords: any[] = [];
    try {
      slaRecords = Object.values(
        await getSlaStatusForTickets(
          tickets.map((ticket) => String(ticket.id)),
          {
            requestId: requestContext.requestId,
            caller: requestContext.endpoint || 'RoleDashboardService.buildOverviewMetrics',
          },
        ),
      ).filter(Boolean) as any[];
    } catch (error: unknown) {
      this.log('warn', 'SLA bulk status lookup failed during overview metrics; using default zero values', requestContext, {
        dependency: 'sla-service./sla/tickets/status',
        ticketCount: tickets.length,
        error: error instanceof Error ? error.message : String(error),
      });
      slaRecords = [];
    }
    const slaBreached = slaRecords.filter((record) => record.sla_breached).length;
    const slaAtRisk = slaRecords.filter((record) => record.at_risk).length;

    return {
      totalTickets: tickets.length,
      openTickets: statusCounts.OPEN || 0,
      inProgressTickets: statusCounts.IN_PROGRESS || 0,
      resolvedTickets: statusCounts.RESOLVED || 0,
      closedTickets: statusCounts.CLOSED || 0,
      escalatedTickets: escalationCount,
      avgResolutionMinutes,
      slaBreachedTickets: slaBreached,
      slaAtRiskTickets: slaAtRisk,
      ticketsByStatus: statusCounts,
      ticketsByPriority: priorityCounts,
      ticketsPerTechnician,
      ticketsPerSeniorTeam,
      scopeRole: scope?.role ?? 'ADMIN',
    };
  }

  private async buildSeniorTeamCounts(tickets: ExternalTicket[], scope?: ScopeContext, context?: DashboardRequestContext) {
    const requestContext = this.asDashboardContext({ ...context, scopeRole: scope?.role || context?.scopeRole });
    if (!scope || scope.role === 'JUNIOR') {
      return [];
    }

    let relationships: ReportingRelationshipRow[] = [];
    try {
      relationships = await this.relationshipRepo.getAllActive();
    } catch (error: any) {
      const code = error?.code || error?.errno || null;
      this.log('error', 'Failed to query reporting relationships for overview metrics', requestContext, {
        dependency: 'workflow-db.reporting_relationships',
        error: error instanceof Error ? error.message : String(error),
        dbCode: code,
      });

      if (code === 'ER_NO_SUCH_TABLE') {
        throw new DashboardDependencyError({
          code: 'WORKFLOW_DB_QUERY_FAILED',
          statusCode: 500,
          dependency: 'workflow-db.reporting_relationships',
          message: 'Workflow hierarchy tables are missing',
          cause: error,
        });
      }

      throw new DashboardDependencyError({
        code: 'WORKFLOW_DB_QUERY_FAILED',
        statusCode: 500,
        dependency: 'workflow-db.reporting_relationships',
        message: 'Workflow hierarchy query failed',
        cause: error,
      });
    }
    const juniorToSenior = relationships.filter((rel) => rel.relationship_type === 'JUNIOR_TO_SENIOR');
    const seniorToSupervisor = relationships.filter((rel) => rel.relationship_type === 'SENIOR_TO_SUPERVISOR');

    let seniorIds: number[] = [];
    if (scope.role === 'SENIOR' && scope.viewerUserId) {
      seniorIds = [scope.viewerUserId];
    } else if (scope.role === 'SUPERVISOR' && scope.viewerUserId) {
      seniorIds = seniorToSupervisor
        .filter((rel) => rel.parent_user_id === scope.viewerUserId)
        .map((rel) => rel.child_user_id);
    } else {
      seniorIds = juniorToSenior.map((rel) => rel.parent_user_id);
    }

    const uniqueSeniorIds = Array.from(new Set(seniorIds));
    if (uniqueSeniorIds.length === 0) return [];

    let seniors: TechnicianRow[] = [];
    try {
      seniors = await this.technicianRepo.getByUserIds(uniqueSeniorIds);
    } catch (error: unknown) {
      this.log('warn', 'Senior technician lookup failed while computing team counts; returning empty senior team metrics', requestContext, {
        dependency: 'workflow-db.technicians',
        seniorCount: uniqueSeniorIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
    const juniorMap = new Map<number, number[]>();
    juniorToSenior.forEach((rel) => {
      if (!juniorMap.has(rel.parent_user_id)) {
        juniorMap.set(rel.parent_user_id, []);
      }
      juniorMap.get(rel.parent_user_id)!.push(rel.child_user_id);
    });

    return seniors.map((senior) => {
      const juniors = juniorMap.get(senior.user_id) || [];
      const scopeIds = new Set([senior.user_id, ...juniors]);
      const ticketCount = tickets.filter((ticket) => {
        const assignedId = this.toNumericUserId(ticket.assigned_to);
        return assignedId != null && scopeIds.has(assignedId);
      }).length;

      return {
        seniorUserId: senior.user_id,
        seniorName: senior.name,
        juniorCount: juniors.length,
        ticketCount,
      };
    });
  }

  private assertTicketInScope(ticket: ExternalTicket, scope: ScopeContext) {
    if (scope.role === 'ADMIN' || !scope.scopeUserIds) {
      return;
    }

    const assignedUserId = this.toNumericUserId(ticket.assigned_to);
    if (!assignedUserId || !scope.scopeUserIds.includes(assignedUserId)) {
      throw new Error('Ticket is outside of your hierarchy scope');
    }
  }

  private async resolveSeniorScopeIds(seniorUserId: number) {
    const juniors = await this.relationshipRepo.getJuniorsForSenior(seniorUserId);
    return new Set([seniorUserId, ...juniors]);
  }

  private async resolveSupervisorScopeIds(supervisorUserId: number) {
    const seniors = await this.relationshipRepo.getSeniorsForSupervisor(supervisorUserId);
    const juniorsBySenior = await Promise.all(seniors.map((seniorId) => this.relationshipRepo.getJuniorsForSenior(seniorId)));
    const juniors = juniorsBySenior.flat();
    return new Set([supervisorUserId, ...seniors, ...juniors]);
  }
}
