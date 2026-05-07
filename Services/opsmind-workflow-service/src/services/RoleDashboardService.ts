import { ticketServiceClient, getTicket, getTicketAssignmentHistory, getTicketStatusHistory, getTicketEscalations, getUserDetails } from '../config/externalServices';
import { ReportingRelationshipRepository } from '../repositories/ReportingRelationshipRepository';
import { TechnicianRepository } from '../repositories/TechnicianRepository';
import { WorkflowLogRepository } from '../repositories/WorkflowLogRepository';
import { SlaTrackingRepository } from '../repositories/SlaTrackingRepository';
import { ExternalTicket, TechnicianRow } from '../interfaces/types';

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
  private slaRepo = new SlaTrackingRepository();

  async getAdminOverview(filters: DashboardFilters) {
    const scope: ScopeContext = { role: 'ADMIN', scopeUserIds: null };
    const tickets = await this.fetchScopedTickets(scope, filters, true);
    return this.buildOverviewMetrics(tickets, scope);
  }

  async getSupervisorOverview(supervisorUserId: number, filters: DashboardFilters) {
    const scope = await this.buildSupervisorScope(supervisorUserId);
    const tickets = await this.fetchScopedTickets(scope, filters, true);
    return this.buildOverviewMetrics(tickets, scope);
  }

  async getSeniorOverview(seniorUserId: number, filters: DashboardFilters) {
    const scope = await this.buildSeniorScope(seniorUserId);
    const tickets = await this.fetchScopedTickets(scope, filters, true);
    return this.buildOverviewMetrics(tickets, scope);
  }

  async getJuniorOverview(juniorUserId: number, filters: DashboardFilters) {
    const scope = await this.buildJuniorScope(juniorUserId);
    const tickets = await this.fetchScopedTickets(scope, filters, true);
    return this.buildOverviewMetrics(tickets, scope);
  }

  async getAdminTickets(filters: DashboardFilters) {
    const scope: ScopeContext = { role: 'ADMIN', scopeUserIds: null };
    return this.buildTicketListResponse(scope, filters);
  }

  async getAdminTicketDetails(ticketId: string) {
    const scope: ScopeContext = { role: 'ADMIN', scopeUserIds: null };
    return this.getTicketDetails(ticketId, scope);
  }

  async getSupervisorTickets(supervisorUserId: number, filters: DashboardFilters) {
    const scope = await this.buildSupervisorScope(supervisorUserId);
    return this.buildTicketListResponse(scope, filters);
  }

  async getSupervisorTicketDetails(supervisorUserId: number, ticketId: string) {
    const scope = await this.buildSupervisorScope(supervisorUserId);
    return this.getTicketDetails(ticketId, scope);
  }

  async getSeniorTickets(seniorUserId: number, filters: DashboardFilters) {
    const scope = await this.buildSeniorScope(seniorUserId);
    return this.buildTicketListResponse(scope, filters);
  }

  async getSeniorTicketDetails(seniorUserId: number, ticketId: string) {
    const scope = await this.buildSeniorScope(seniorUserId);
    return this.getTicketDetails(ticketId, scope);
  }

  async getJuniorTickets(juniorUserId: number, filters: DashboardFilters) {
    const scope = await this.buildJuniorScope(juniorUserId);
    return this.buildTicketListResponse(scope, filters);
  }

  async getJuniorTicketDetails(juniorUserId: number, ticketId: string) {
    const scope = await this.buildJuniorScope(juniorUserId);
    return this.getTicketDetails(ticketId, scope);
  }

  async getTicketDetails(ticketId: string, scope: ScopeContext) {
    const ticket = await getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    this.assertTicketInScope(ticket, scope);

    const assignedUserId = this.toNumericUserId(ticket.assigned_to);
    const hierarchy = await this.resolveHierarchyContext(assignedUserId);
    const assignedTechnician = hierarchy.junior || hierarchy.senior || hierarchy.supervisor;
    const requesterDetails = ticket.requester_id
      ? await this.safeFetchUser(ticket.requester_id)
      : null;

    const [assignmentHistory, statusHistory, escalationHistory, workflowLogs, slaRecord] = await Promise.all([
      this.safeTicketHistory(getTicketAssignmentHistory, ticketId),
      this.safeTicketHistory(getTicketStatusHistory, ticketId),
      this.safeTicketHistory(getTicketEscalations, ticketId),
      this.logRepo.getTicketLogs(ticketId),
      this.slaRepo.getByTicketId(ticketId),
    ]);

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
        assignedToLevel: assignedTechnician?.level || this.resolveSupportLevel(ticket.assigned_to_level),
        requester: requesterDetails?.name || ticket.requester_id || null,
        requesterId: ticket.requester_id ?? null,
        building: ticket.building ?? null,
        room: ticket.room ?? null,
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
    };
  }

  private async buildTicketListResponse(scope: ScopeContext, filters: DashboardFilters) {
    const tickets = await this.fetchScopedTickets(scope, filters, true);
    const total = tickets.length;
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    const paged = tickets.slice(offset, offset + limit);

    const assignedUserIds = this.extractAssignedUserIds(paged);
    const technicians = await this.technicianRepo.getByUserIds(assignedUserIds);
    const technicianMap = new Map(technicians.map((tech) => [tech.user_id, tech]));
    const hierarchyCache = new Map<number, HierarchyContext>();

    const slaMap = await this.buildSlaMap(paged.map((ticket) => String(ticket.id)));
    const requesterMap = await this.buildRequesterMap(paged.map((ticket) => ticket.requester_id).filter(Boolean) as string[]);

    const items = await Promise.all(
      paged.map(async (ticket) => {
        const assignedUserId = this.toNumericUserId(ticket.assigned_to);
        const technician = assignedUserId ? technicianMap.get(assignedUserId) || null : null;
        const hierarchy = await this.resolveHierarchyContext(assignedUserId, hierarchyCache);
        const requester = ticket.requester_id ? requesterMap.get(String(ticket.requester_id)) : null;
        const sla = slaMap.get(String(ticket.id));

        return {
          ticketId: String(ticket.id),
          title: ticket.title ?? null,
          descriptionPreview: this.buildDescriptionPreview(ticket.description),
          status: ticket.status ?? null,
          priority: ticket.priority ?? null,
          assignedTo: ticket.assigned_to ?? null,
          assignedToName: technician?.name ?? null,
          assignedToEmail: technician?.email ?? null,
          assignedToLevel: technician?.level || this.resolveSupportLevel(ticket.assigned_to_level),
          requesterId: ticket.requester_id ?? null,
          requesterName: requester?.name ?? null,
          building: ticket.building ?? null,
          room: ticket.room ?? null,
          escalationCount: ticket.escalation_count ?? 0,
          createdAt: ticket.created_at ?? null,
          updatedAt: ticket.updated_at ?? null,
          hierarchy: {
            junior: hierarchy.junior ? this.formatTechnician(hierarchy.junior) : null,
            senior: hierarchy.senior ? this.formatTechnician(hierarchy.senior) : null,
            supervisor: hierarchy.supervisor ? this.formatTechnician(hierarchy.supervisor) : null,
          },
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

  private async fetchScopedTickets(scope: ScopeContext, filters: DashboardFilters, ignorePagination: boolean) {
    const assignedFilter = this.resolveAssignedFilter(scope, filters);
    if (assignedFilter && assignedFilter.length === 0) {
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

    const { data } = await ticketServiceClient.get('/tickets', { params });
    const rawTickets = Array.isArray(data) ? data : data?.tickets || [];

    const tickets = rawTickets.filter((ticket: ExternalTicket) => !ticket.is_deleted);
    const filtered = await this.applyPostFilters(tickets, filters);

    return filtered;
  }

  private async applyPostFilters(tickets: ExternalTicket[], filters: DashboardFilters) {
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
      const technicians = await this.technicianRepo.getByUserIds(assignedUserIds);
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

  private buildDescriptionPreview(description?: string) {
    if (!description) return null;
    const trimmed = description.trim();
    if (trimmed.length <= 140) return trimmed;
    return `${trimmed.slice(0, 137)}...`;
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

  private parseTicketDate(ticket: ExternalTicket) {
    const candidates = [ticket.created_at, ticket.updated_at, ticket.closed_at];
    for (const raw of candidates) {
      if (!raw) continue;
      const date = new Date(raw as any);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return null;
  }

  private async buildSlaMap(ticketIds: string[]) {
    const records = await this.slaRepo.getByTicketIds(ticketIds);
    const map = new Map<string, any>();
    records.forEach((record) => {
      map.set(record.ticket_id, record);
    });
    return map;
  }

  private async buildRequesterMap(requesterIds: string[]) {
    const unique = Array.from(new Set(requesterIds.filter(Boolean)));
    const results = await Promise.allSettled(unique.map((id) => this.safeFetchUser(id)));
    const map = new Map<string, any>();
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        map.set(unique[index], result.value);
      }
    });
    return map;
  }

  private async safeFetchUser(userId: string) {
    try {
      return await getUserDetails(userId as any);
    } catch {
      return null;
    }
  }

  private async safeTicketHistory(fetcher: (ticketId: string) => Promise<any>, ticketId: string) {
    try {
      return await fetcher(ticketId);
    } catch {
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

  private async buildOverviewMetrics(tickets: ExternalTicket[], scope?: ScopeContext) {
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
    const technicians = await this.technicianRepo.getByUserIds(assignedUserIds);
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

    const ticketsPerSeniorTeam = await this.buildSeniorTeamCounts(tickets, scope);

    const slaRecords = await this.slaRepo.getByTicketIds(tickets.map((ticket) => String(ticket.id)));
    const slaBreached = slaRecords.filter((record) => record.sla_breached).length;
    const slaAtRisk = slaRecords.filter((record) => {
      if (record.sla_breached) return false;
      if (!record.sla_deadline) return false;
      const now = new Date();
      const deadline = new Date(record.sla_deadline);
      const minutes = (deadline.getTime() - now.getTime()) / 1000 / 60;
      return minutes > 0 && minutes <= 30;
    }).length;

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

  private async buildSeniorTeamCounts(tickets: ExternalTicket[], scope?: ScopeContext) {
    if (!scope || scope.role === 'JUNIOR') {
      return [];
    }

    const relationships = await this.relationshipRepo.getAllActive();
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

    const seniors = await this.technicianRepo.getByUserIds(uniqueSeniorIds);
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
