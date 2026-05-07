import { TicketCreatedEvent, TicketAssignedEvent, TechnicianRow, TicketPriority } from '../interfaces/types';
import { TechnicianRepository } from '../repositories/TechnicianRepository';
import { TicketRepository } from '../repositories/TicketRepository';
import { WorkflowLogRepository } from '../repositories/WorkflowLogRepository';
import { haversineDistanceKm } from '../utils/geo';
import { assignTicket, getTicketDetails, getUserDetails, startSlaTracking } from '../config/externalServices';
import { NotificationPublisher } from './NotificationPublisher';

/**
 * Maximum active ticket count a technician may carry before being excluded.
 * Technicians at or above this threshold are considered overloaded.
 */
const MAX_WORKLOAD = 10;
const NO_ACTIVE_JUNIOR_TECHNICIAN_ERROR = 'No active junior technicians available.';
const LEGACY_NO_AVAILABLE_TECHNICIAN_ERROR = 'NO_AVAILABLE_TECHNICIAN';
const LEGACY_NO_ELIGIBLE_TECHNICIAN_ERROR = 'NO_ELIGIBLE_TECHNICIAN';
const WORKLOAD_ONLY_DISTANCE_KM = 0;

export function isAssignmentPendingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message === NO_ACTIVE_JUNIOR_TECHNICIAN_ERROR ||
    message === LEGACY_NO_AVAILABLE_TECHNICIAN_ERROR ||
    message === LEGACY_NO_ELIGIBLE_TECHNICIAN_ERROR
  );
}

interface PriorityWeights {
  distance: number;
  workload: number;
}

/**
 * Scoring weights per ticket priority.
 *
 * score = weights.distance * norm_distance + weights.workload * norm_workload
 *
 * HIGH/CRITICAL: closer technician is more important  → distance weight 0.7
 * MEDIUM:        balanced                             → both weights 0.5
 * LOW:           least-busy technician preferred      → workload weight 0.7
 */
const PRIORITY_WEIGHTS: Record<TicketPriority, PriorityWeights> = {
  CRITICAL: { distance: 0.7, workload: 0.3 },
  HIGH:     { distance: 0.7, workload: 0.3 },
  MEDIUM:   { distance: 0.5, workload: 0.5 },
  LOW:      { distance: 0.3, workload: 0.7 },
};

interface TechnicianWithWorkload extends TechnicianRow {
  workload: number;
}

interface ScoredTechnician extends TechnicianWithWorkload {
  distance_km: number;
  score: number;
}

type AssignmentSource = 'queue' | 'route-ticket' | 'unknown';
type AssignmentStrategy = 'distance_workload' | 'workload_only' | 'overload_fallback';

interface AssignmentOptions {
  source?: AssignmentSource;
}

function hasFiniteCoordinate(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasTechnicianLocation(technician: TechnicianRow): technician is TechnicianRow & {
  latitude: number;
  longitude: number;
} {
  return hasFiniteCoordinate(technician.latitude) && hasFiniteCoordinate(technician.longitude);
}

/**
 * Assignment Service
 *
 * Selects the best available technician for a new ticket using a
 * priority-weighted score over normalised distance and workload.
 * No dependency on support-group routing.
 */
export class AssignmentService {
  private technicianRepo = new TechnicianRepository();
  private ticketRepo = new TicketRepository();
  private logRepo = new WorkflowLogRepository();
  private notificationPublisher = new NotificationPublisher();

  async assignForTicket(
    event: TicketCreatedEvent,
    options?: AssignmentOptions,
  ): Promise<TicketAssignedEvent | null> {
    const source = options?.source ?? 'unknown';

    // Ensure ticket exists locally for workload tracking.
    await this.ticketRepo.upsertTicket(event.ticket_id);

    // Idempotency guard: skip if already assigned (duplicate RabbitMQ delivery and
    // race between the consumer and REST /route-ticket endpoint).
    const assignmentCheck = await this.ticketRepo.isAlreadyAssigned(event.ticket_id);
    if (assignmentCheck) {
      console.log(
        `[AssignmentService] ⚠ Skipping assignment | source=${source} | ticket=${event.ticket_id} | ` +
          `assigned_to=${assignmentCheck.assigned_to ?? 'null'} | status=${assignmentCheck.status}`,
      );
      return null;
    }

    const activeJuniors = await this.technicianRepo.getAvailableTechnicians();
    const activeWithLocationCount = activeJuniors.filter((tech) => hasTechnicianLocation(tech)).length;

    console.log(
      `[AssignmentService] Ticket received | source=${source} | ticket=${event.ticket_id} | ` +
        `active_juniors=${activeJuniors.length} | juniors_with_location=${activeWithLocationCount} | ` +
        `ticket_location=(${event.latitude}, ${event.longitude})`,
    );

    if (!activeJuniors.length) {
      console.warn(
        `[AssignmentService] Assignment pending | source=${source} | ticket=${event.ticket_id} | ` +
          `strategy=pending | reason=${NO_ACTIVE_JUNIOR_TECHNICIAN_ERROR}`,
      );
      throw new Error(NO_ACTIVE_JUNIOR_TECHNICIAN_ERROR);
    }

    const workloadMap = await this.ticketRepo.getWorkloadMap();
    const withWorkload: TechnicianWithWorkload[] = activeJuniors.map((tech) => ({
      ...tech,
      workload: workloadMap[tech.user_id] ?? 0,
    }));

    // Prefer technicians below the overload threshold.
    const underCapacity = withWorkload.filter((tech) => tech.workload < MAX_WORKLOAD);

    const priority: TicketPriority = event.priority ?? 'MEDIUM';
    const weights = PRIORITY_WEIGHTS[priority];
    const ticketHasLocation = hasFiniteCoordinate(event.latitude) && hasFiniteCoordinate(event.longitude);
    const isOverloadFallback = underCapacity.length === 0;
    const candidatePool = isOverloadFallback ? withWorkload : underCapacity;
    const locationCandidates = candidatePool.filter((tech) => hasTechnicianLocation(tech));
    let strategy: AssignmentStrategy = 'workload_only';
    if (isOverloadFallback) {
      strategy = 'overload_fallback';
    } else if (ticketHasLocation && locationCandidates.length > 0) {
      strategy = 'distance_workload';
    }

    const assignmentReason = isOverloadFallback
      ? `all_active_juniors_over_capacity_threshold_${MAX_WORKLOAD}`
      : strategy === 'distance_workload'
      ? 'location_and_workload_scoring'
      : 'location_missing_or_unusable_workload_only';

    if (isOverloadFallback) {
      console.warn(
        `[AssignmentService] Overload fallback activated | source=${source} | ticket=${event.ticket_id} | ` +
          `strategy=${strategy} | reason=${assignmentReason} | active_juniors=${activeJuniors.length}`,
      );
    }

    console.log(
      `[AssignmentService] Strategy selected | source=${source} | ticket=${event.ticket_id} | strategy=${strategy} | ` +
        `priority=${priority} | candidates=${candidatePool.length} | ` +
        `location_candidates=${locationCandidates.length} | ticket_has_location=${ticketHasLocation}`,
    );

    let best: ScoredTechnician;

    if (strategy === 'distance_workload') {
      const withMetrics = locationCandidates.map((tech) => {
        const distance_km = haversineDistanceKm(
          event.latitude,
          event.longitude,
          tech.latitude,
          tech.longitude,
        );
        return { ...tech, distance_km };
      });

      const maxDistance = Math.max(...withMetrics.map((tech) => tech.distance_km), 1);
      const maxWorkload = Math.max(...withMetrics.map((tech) => tech.workload), 1);

      const scored = withMetrics.map((tech) => {
        const normDist = tech.distance_km / maxDistance;
        const normWork = tech.workload / maxWorkload;
        const score = weights.distance * normDist + weights.workload * normWork;
        return { ...tech, score };
      });

      scored.sort(
        (a, b) =>
          a.score - b.score ||
          a.workload - b.workload ||
          a.user_id - b.user_id ||
          a.id - b.id,
      );
      best = scored[0];
    } else {
      const sorted = [...candidatePool].sort(
        (a, b) => a.workload - b.workload || a.user_id - b.user_id || a.id - b.id,
      );
      const selected = sorted[0];
      const maxWorkload = Math.max(...candidatePool.map((tech) => tech.workload), 1);
      best = {
        ...selected,
        distance_km: WORKLOAD_ONLY_DISTANCE_KM,
        score: selected.workload / maxWorkload,
      };
    }

    console.log(
      `[AssignmentService] ✔ Technician selected | source=${source} | ticket=${event.ticket_id} | ` +
        `strategy=${strategy} | user_id=${best.user_id} | workload=${best.workload} | ` +
        `distance_km=${best.distance_km.toFixed(3)} | score=${best.score.toFixed(4)}`,
    );

    // Final race-condition guard: verify ticket is still unassigned before commit.
    const finalCheck = await this.ticketRepo.isAlreadyAssigned(event.ticket_id);
    if (finalCheck) {
      console.log(
        `[AssignmentService] ⚠ Race condition detected | source=${source} | ticket=${event.ticket_id} | ` +
          `strategy=${strategy} | ` +
          `during processing | assigned_to=${finalCheck.assigned_to ?? 'null'} | status=${finalCheck.status}`,
      );
      return null;
    }

    // Update local DB first (workload tracking).
    await this.ticketRepo.assignTicket(event.ticket_id, best.user_id);

    // Notify ticket-service (authoritative store) without forcing status transition.
    // Live technicians table has no level column; default all to L1.
    const supportLevel = 'L1';
    console.log(
      `[AssignmentService] → PATCH ticket-service | source=${source} | ticket=${event.ticket_id} | ` +
        `assigned_to=${best.user_id} | assigned_to_level=${supportLevel} | status_preserved=OPEN`,
    );
    try {
      const result = await assignTicket(event.ticket_id, best.user_id, supportLevel, undefined, {
        assignmentMethod: 'AUTOMATIC',
        assignmentReason: assignmentReason,
        performedByRole: 'SYSTEM',
      });
      console.log(
        `[AssignmentService] ✔ ticket-service PATCH succeeded | source=${source} | ticket=${event.ticket_id} | response:`,
        JSON.stringify(result),
      );

      await this.logRepo.logAction(event.ticket_id, 'ROUTED', {
        to_member_id: best.user_id,
        reason: `Auto-assigned by workflow (${assignmentReason})`,
      });

      // Start SLA tracking after successful assignment.
      await this.startSlaTracking(event, best.user_id);

      // Publish notification event after successful assignment.
      await this.publishAssignmentNotification(event.ticket_id, best.user_id);
    } catch (extErr: any) {
      const status = extErr?.response?.status ?? 'NO_RESPONSE';
      const body = extErr?.response?.data ?? extErr?.message;
      console.error(
        `[AssignmentService] ✘ ticket-service PATCH FAILED | source=${source} | ticket=${event.ticket_id} | ` +
          `HTTP ${status} | body: ${JSON.stringify(body)}`,
      );
    }

    return {
      ticket_id: event.ticket_id,
      technician_id: best.user_id,
      distance_km: best.distance_km,
      workload: best.workload,
      score: best.score,
      assignment_strategy: strategy,
      assignment_path: source,
      assignment_reason: assignmentReason,
    };
  }

  /**
   * Enrich and validate user data for notification publishing
   * 
   * Data sources (priority order):
   * 1. Local database (technicians table) - provides id, name
   * 2. Auth Service API - provides email
   * 
   * Validation: ensures id, name, and email are present
   * 
   * @param userId - The user ID to fetch data for
   * @param userType - User type for logging ('technician' or 'supervisor')
   * @returns Enriched user data or null if validation fails
   */
  private async enrichUserData(
    workflowUserId: number,
    userType: 'technician' | 'supervisor',
  ): Promise<{ id: string; name: string; email: string } | null> {
    try {
      // Step 1: Resolve by workflow user_id first, fallback to internal row id for compatibility.
      const technicianData =
        (await this.technicianRepo.getByUserId(workflowUserId)) ||
        (await this.technicianRepo.getById(workflowUserId));
      
      // Step 2: Fetch email from Auth Service
      const authUser = await getUserDetails(workflowUserId);

      // Step 3: Build enriched data object
      const enrichedData = {
        id: String(workflowUserId),
        name: technicianData?.name || authUser?.email?.split('@')[0] || '',
        email: authUser?.email || '',
      };

      // Step 4: Validate required fields
      if (!enrichedData.name || !enrichedData.email) {
        const missing: string[] = [];
        if (!enrichedData.name) missing.push('name');
        if (!enrichedData.email) missing.push('email');
        
        console.error(
          `[AssignmentService] ✘ Validation failed for ${userType} ${workflowUserId}: ` +
          `missing ${missing.join(', ')}. Event will not be published.`
        );
        return null;
      }

      console.log(
        `[AssignmentService] ✔ Enriched ${userType} data: ` +
        `id=${enrichedData.id}, name=${enrichedData.name}, email=${enrichedData.email}`
      );

      return enrichedData;
    } catch (error) {
      console.error(
        `[AssignmentService] ✘ Failed to enrich ${userType} data for user ${workflowUserId}:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Publish assignment notification event to RabbitMQ
   * 
   * Implementation:
   * - Fetches ticket details from ticket-service
   * - Enriches technician data (local DB + Auth Service)
   * - Enriches supervisor data (local DB + Auth Service)
   * - Validates all required fields (id, name, email)
   * - Publishes event only if validation passes
   * 
   * Data Flow:
   * 1. Local DB query (technicians table) → id, name
   * 2. Auth Service API → email
   * 3. Validation → ensures all fields present
   * 4. Publish to RabbitMQ
   * 
   * Error Handling:
   * - Missing data → logged, event not published
   * - API failures → logged, event not published
   * - Never throws → assignment flow continues
   */
  private async publishAssignmentNotification(ticketId: string, technicianUserId: number): Promise<void> {
    try {
      console.log(`[AssignmentService] Publishing notification for ticket ${ticketId}...`);

      // Step 1: Fetch ticket details from ticket-service
      const ticketDetails = await getTicketDetails(ticketId);
      const ticketTitle = ticketDetails?.title || 'Untitled Ticket';

      // Step 2: Enrich and validate technician data
      const technicianData = await this.enrichUserData(technicianUserId, 'technician');
      if (!technicianData) {
        console.warn(
          `[AssignmentService] ✘ Skipping notification publish: ` +
          `technician data validation failed for ticket ${ticketId}`
        );
        return;
      }

      // Step 3: Fetch supervisor from local database
      const supervisor = await this.technicianRepo.getSupervisor();
      if (!supervisor) {
        console.warn(
          `[AssignmentService] ✘ Skipping notification publish: ` +
          `no supervisor found for ticket ${ticketId}`
        );
        return;
      }

      // Step 4: Enrich and validate supervisor data
      const supervisorData = await this.enrichUserData(supervisor.user_id, 'supervisor');
      if (!supervisorData) {
        console.warn(
          `[AssignmentService] ✘ Skipping notification publish: ` +
          `supervisor data validation failed for ticket ${ticketId}`
        );
        return;
      }

      // Step 5: Build and publish notification payload
      await this.notificationPublisher.publishTicketAssigned({
        ticket: {
          id: ticketId,
          title: ticketTitle,
        },
        technician: technicianData,
        supervisor: supervisorData,
      });

      console.log(
        `[AssignmentService] ✔ Notification published successfully | ` +
        `ticket=${ticketId} | technician=${technicianData.email} | supervisor=${supervisorData.email}`
      );
    } catch (error) {
      console.error(
        `[AssignmentService] ✘ Failed to publish assignment notification for ticket ${ticketId}:`,
        error instanceof Error ? error.message : error
      );
      // Do not throw - notification failure should not break assignment
    }
  }

  /**
   * Validate SLA payload before sending POST /sla/start
   * 
   * Checks all required fields and returns detailed error if validation fails
   * 
   * @param payload - The SLA payload to validate
   * @returns Object with { valid: boolean, missingFields: string[] }
   */
  private validateSlaPayload(payload: {
    ticketId: string;
    title: string;
    priority: string;
    ticketStatus: string;
    requesterId: string | number | undefined;
    assignedTo: string;
    technician: { id: string; name: string; email: string };
    supervisor: { id: string; name: string; email: string };
  }): { valid: boolean; missingFields: string[] } {
    const missingFields: string[] = [];

    // Validate ticket fields
    if (!payload.ticketId) missingFields.push('ticket.id');
    if (!payload.title) missingFields.push('ticket.title');
    if (!payload.priority) missingFields.push('ticket.priority');
    if (!payload.ticketStatus) missingFields.push('ticket.status');
    if (!payload.requesterId) missingFields.push('ticket.requester_id');

    // Validate technician fields
    if (!payload.technician.id) missingFields.push('technician.user_id');
    if (!payload.technician.name) missingFields.push('technician.name');
    if (!payload.technician.email) missingFields.push('technician.email');

    // Validate supervisor fields
    if (!payload.supervisor.id) missingFields.push('supervisor.user_id');
    if (!payload.supervisor.name) missingFields.push('supervisor.name');
    if (!payload.supervisor.email) missingFields.push('supervisor.email');

    return {
      valid: missingFields.length === 0,
      missingFields,
    };
  }

  /**
   * Start SLA tracking after successful ticket assignment
   * 
   * Implementation:
   * - Fetches ticket details from ticket-service (title, priority, status, createdAt, requester_id)
   * - Enriches technician data (local DB + Auth Service)
   * - Enriches supervisor data (local DB + Auth Service)
   * - Validates all required fields comprehensively
   * - Calls POST /sla/start only if validation passes
   * 
   * Data Flow:
   * 1. Ticket Service API → title, priority, status, createdAt, requester_id
   * 2. Local DB query (technicians table) → technician name, supervisor
   * 3. Auth Service API → technician email, supervisor email
   * 4. Validation → ensures ALL required fields present
   * 5. POST /sla/start (only if valid)
   * 
   * Validation Requirements:
   * - ticket.id, title, priority, status, requester_id
   * - technician.user_id, name, email
   * - supervisor.user_id, name, email
   * 
   * Error Handling:
   * - Missing data → logged with specific field names, SLA not started
   * - API failures → logged, SLA not started
   * - Never throws → assignment flow continues even if SLA fails
   */
  private async startSlaTracking(event: TicketCreatedEvent, technicianUserId: number): Promise<void> {
    try {
      console.log(`[AssignmentService] Starting SLA tracking for ticket ${event.ticket_id}...`);

      // Step 1: Fetch ticket details from ticket-service
      const ticketDetails = await getTicketDetails(event.ticket_id);
      if (!ticketDetails) {
        console.error(
          `[AssignmentService] ✘ SLA validation failed for ticket ${event.ticket_id} | ` +
          `reason: could not fetch ticket details from ticket-service`
        );
        return;
      }

      // Step 2: Enrich and validate technician data
      const technicianData = await this.enrichUserData(technicianUserId, 'technician');
      if (!technicianData) {
        console.error(
          `[AssignmentService] ✘ SLA validation failed for ticket ${event.ticket_id} | ` +
          `reason: technician data enrichment failed for technician ${technicianUserId}`
        );
        return;
      }

      // Step 3: Fetch supervisor from local database
      const supervisor = await this.technicianRepo.getSupervisor();
      if (!supervisor) {
        console.error(
          `[AssignmentService] ✘ SLA validation failed for ticket ${event.ticket_id} | ` +
          `reason: no supervisor found in database`
        );
        return;
      }

      // Step 4: Enrich and validate supervisor data
      const supervisorData = await this.enrichUserData(supervisor.user_id, 'supervisor');
      if (!supervisorData) {
        console.error(
          `[AssignmentService] ✘ SLA validation failed for ticket ${event.ticket_id} | ` +
          `reason: supervisor data enrichment failed for supervisor ${supervisor.user_id}`
        );
        return;
      }

      // Step 5: Build SLA payload
      const slaPayload = {
        ticketId: event.ticket_id,
        title: ticketDetails.title,
        priority: ticketDetails.priority || event.priority,
        ticketStatus: ticketDetails.status,
        requesterId: ticketDetails.requester_id || ticketDetails.created_by,
        assignedTo: String(technicianUserId),
        technician: technicianData,
        supervisor: supervisorData,
      };

      // Step 6: Comprehensive validation before sending
      const validation = this.validateSlaPayload(slaPayload);
      
      if (!validation.valid) {
        console.error(
          `[AssignmentService] ✘ SLA validation failed for ticket ${event.ticket_id} | ` +
          `missing required fields: ${validation.missingFields.join(', ')} | ` +
          `payload: ${JSON.stringify(slaPayload, null, 2)}`
        );
        return;
      }

      console.log(
        `[AssignmentService] ✔ SLA payload validated successfully | ` +
        `ticket=${event.ticket_id} | all required fields present`
      );

      // Step 7: Call POST /sla/start with validated payload
      // Use assignment time (now) as createdAt since SLA starts at assignment, not ticket creation
      await startSlaTracking(
        slaPayload.ticketId,
        slaPayload.title,
        slaPayload.priority,
        slaPayload.ticketStatus,
        new Date().toISOString(), // Assignment time, not ticket creation time
        slaPayload.assignedTo,
        slaPayload.requesterId,
        slaPayload.technician,
        slaPayload.supervisor,
      );

      console.log(
        `[AssignmentService] ✔ SLA tracking started successfully | ` +
        `ticket=${event.ticket_id} | technician=${technicianData.email} | supervisor=${supervisorData.email}`
      );
    } catch (error) {
      console.error(
        `[AssignmentService] ✘ Failed to start SLA tracking for ticket ${event.ticket_id}:`,
        error instanceof Error ? error.message : error
      );
      // Do not throw - SLA failure should not break assignment
    }
  }
}
