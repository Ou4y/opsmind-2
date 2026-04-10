// ==========================================
// Workflow Service - Type Definitions
// ==========================================

// ---------- Database Row Types ----------

export interface SupportGroupRow {
  id: number;
  name: string;
  building: string;
  floor: number;
  parent_group_id: number | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface GroupMemberRow {
  id: number;
  user_id: number;
  group_id: number;
  role: 'JUNIOR' | 'SENIOR' | 'SUPERVISOR';
  can_assign: boolean;
  can_escalate: boolean;
  status: 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE';
  joined_at: Date;
  updated_at: Date;
}

export interface WorkflowLogRow {
  id: number;
  ticket_id: string;
  action: WorkflowAction;
  from_group_id: number | null;
  to_group_id: number | null;
  from_member_id: number | null;
  to_member_id: number | null;
  performed_by: number | null;
  reason: string | null;
  created_at: Date;
}

export interface EscalationRuleRow {
  id: number;
  source_group_id: number;
  target_group_id: number;
  trigger_type: EscalationTrigger;
  delay_minutes: number;
  reopen_threshold: number;
  is_active: boolean;
  priority: number;
  created_at: Date;
  updated_at: Date;
}

export interface TicketRoutingStateRow {
  id: number;
  ticket_id: string;
  current_group_id: number;
  assigned_member_id: number | null;
  status: RoutingStatus;
  escalation_count: number;
  last_escalated_at: Date | null;
  claimed_at: Date | null;
  updated_at: Date;
}

export interface SlaTrackingRow {
  id: number;
  ticket_id: string;
  priority: string | null;
  created_at: Date;
  assigned_at: Date | null;
  sla_deadline: Date;
  sla_breached: boolean;
  breached_at: Date | null;
  updated_at: Date;
}

// ---------- Enums ----------

export type WorkflowAction =
  | 'CREATED'
  | 'ROUTED'
  | 'CLAIMED'
  | 'REASSIGNED'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED';

export type EscalationTrigger = 'SLA' | 'MANUAL' | 'CRITICAL' | 'REOPEN_COUNT';

export type RoutingStatus = 'UNASSIGNED' | 'ASSIGNED' | 'ESCALATED';

export type MemberRole = 'JUNIOR' | 'SENIOR' | 'SUPERVISOR';

export type MemberStatus = 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE';

export type UserRole = 'JUNIOR' | 'SENIOR' | 'SUPERVISOR' | 'HEAD_OF_IT';

// ---------- Request DTOs ----------

export interface RouteTicketRequest {
  ticketId: string;
  building: string;
  floor: number;
}

export interface ClaimTicketRequest {
  userId: number;
}

export interface ReassignTicketRequest {
  userId: number;
  toMemberId: number;
  userRole: UserRole;
  userBuilding?: string;
}

export interface EscalateTicketRequest {
  triggerType: EscalationTrigger;
  performedBy?: number;
  userRole?: UserRole;
}

export interface CreateGroupRequest {
  name: string;
  building: string;
  floor: number;
  parentGroupId?: number;
}

export interface AddMemberRequest {
  userId: number;
  groupId: number;
  role: MemberRole;
  canAssign?: boolean;
  canEscalate?: boolean;
}

export interface CreateEscalationRuleRequest {
  sourceGroupId: number;
  targetGroupId: number;
  triggerType: EscalationTrigger;
  delayMinutes?: number;
  priority?: number;
}

// ---------- Response DTOs ----------

export interface RouteTicketResponse {
  success: boolean;
  ticketId: string;
  groupId: number;
  groupName: string;
  building: string;
  floor: number;
  routing_state: { id: number; ticket_id: string; current_group_id: number };
}

export interface ClaimTicketResponse {
  success: boolean;
  ticketId: string;
  claimedBy: number;
  memberId: number;
  groupId: number;
  message: string;
}

export interface ReassignTicketResponse {
  success: boolean;
  ticketId: string;
  fromGroup: string;
  toGroup: string;
  toMember: number;
  performedBy: number;
  message: string;
}

export interface EscalateTicketResponse {
  success: boolean;
  ticketId: string;
  fromGroup: string;
  toGroup: string;
  escalationCount: number;
  triggerType: string;
  message: string;
}

// ---------- Workflow Log Data ----------

export interface WorkflowLogData {
  from_group_id?: number | null;
  to_group_id?: number | null;
  from_member_id?: number | null;
  to_member_id?: number | null;
  performed_by?: number | null;
  reason?: string | null;
}

// ---------- Dashboard Types ----------

export interface BuildingDashboard {
  building: string;
  groups: BuildingGroupSummary[];
  totalTickets: number;
  unassignedTickets: number;
  escalatedTickets: number;
}

export interface BuildingGroupSummary {
  groupId: number;
  groupName: string;
  floor: number;
  members: GroupMemberSummary[];
  tickets: TicketCountSummary;
}

export interface GroupMemberSummary {
  id: number;
  user_id: number;
  role: MemberRole;
  status: MemberStatus;
}

export interface TicketCountSummary {
  total: number;
  assigned: number;
  unassigned: number;
  escalated: number;
}

export interface MemberDashboard {
  memberId: number;
  memberRole: MemberRole;
  groupId: number;
  assignedTickets: number;
  escalationCount: number;
  joinedAt: Date;
  status: MemberStatus;
  permissions: {
    canAssign: boolean;
    canEscalate: boolean;
  };
}

export interface GroupMetrics {
  groupId: number;
  groupName: string;
  building: string;
  floor: number;
  members: number;
  tickets: TicketCountSummary;
  metrics: {
    averageResolutionTime: number;
    escalationRate: number;
  };
}

// ---------- API Response Wrapper ----------

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ---------- External Service Types ----------

export interface ExternalTicket {
  id: number;
  building: string;
  floor: number;
  room: string;
  assigned_to: number | null;
  status: string;
  priority: string;
  escalation_count: number;
  resolution_summary: string | null;
}

export interface ExternalUser {
  id: number;
  email: string;
  role: string;
}
