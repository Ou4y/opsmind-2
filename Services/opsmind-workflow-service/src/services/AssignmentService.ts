import { TicketCreatedEvent, TicketAssignedEvent, TechnicianRow, TicketPriority } from '../interfaces/types';
import { TechnicianRepository } from '../repositories/TechnicianRepository';
import { TicketRepository } from '../repositories/TicketRepository';
import { haversineDistanceKm } from '../utils/geo';
import { assignTicket, getTicketDetails, getUserDetails, startSlaTracking } from '../config/externalServices';
import { NotificationPublisher } from './NotificationPublisher';

/**
 * Maximum active ticket count a technician may carry before being excluded.
 * Technicians at or above this threshold are considered overloaded.
 */
const MAX_WORKLOAD = 10;

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

interface ScoredTechnician extends TechnicianRow {
  distance_km: number;
  workload: number;
  score: number;
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
  private notificationPublisher = new NotificationPublisher();

  async assignForTicket(event: TicketCreatedEvent): Promise<TicketAssignedEvent | null> {
    // Ensure ticket exists locally for workload tracking
    await this.ticketRepo.upsertTicket(event.ticket_id);

    // Idempotency guard: skip if already assigned (handles duplicate RabbitMQ delivery
    // and the race between the RabbitMQ consumer and the REST /route-ticket endpoint).
    const assignmentCheck = await this.ticketRepo.isAlreadyAssigned(event.ticket_id);
    if (assignmentCheck) {
      console.log(
        `[AssignmentService] ⚠ Skipping assignment: ticket ${event.ticket_id} already assigned | ` +
          `assigned_to=${assignmentCheck.assigned_to ?? 'null'} | status=${assignmentCheck.status}`,
      );
      return null;
    }

    const technicians = await this.technicianRepo.getAvailableTechnicians();

    console.log(
      `[AssignmentService] Ticket ${event.ticket_id} — ` +
        `${technicians.length} non-OFFLINE technician(s) with coordinates retrieved from DB.`,
    );

    if (!technicians.length) {
      console.error(`[AssignmentService] No available technicians found (all OFFLINE or no rows).`);
      throw new Error('No available technicians found');
    }

    const workloadMap = await this.ticketRepo.getWorkloadMap();

    const priority: TicketPriority = event.priority ?? 'MEDIUM';
    const weights = PRIORITY_WEIGHTS[priority];

    console.log(
      `[AssignmentService] Priority=${priority} — weights: distance=${weights.distance}, workload=${weights.workload} | ` +
        `MAX_WORKLOAD threshold=${MAX_WORKLOAD}`,
    );

    // 1. Compute raw distance + workload for each technician
    const withMetrics = technicians.map((t) => {
      const distance_km = haversineDistanceKm(
        event.latitude,
        event.longitude,
        t.latitude as number,
        t.longitude as number,
      );
      const workload = workloadMap[t.id] ?? 0;
      return { ...t, distance_km, workload };
    });

    // 2. Log every candidate before filtering so exclusions are visible
    console.log(`[AssignmentService] Candidate evaluation for ticket ${event.ticket_id}:`);
    withMetrics.forEach((t) => {
      const overloaded = t.workload >= MAX_WORKLOAD;
      console.log(
        `  technician ${t.id} (${t.name}) | status=${t.status} | ` +
          `dist=${t.distance_km.toFixed(3)} km | workload=${t.workload}` +
          (overloaded ? ` ← EXCLUDED (overloaded)` : ''),
      );
    });

    // 3. Exclude overloaded technicians
    const candidates = withMetrics.filter((t) => t.workload < MAX_WORKLOAD);

    if (!candidates.length) {
      console.error(
        `[AssignmentService] No eligible technicians for ticket ${event.ticket_id} ` +
          `(priority=${priority}). All ${technicians.length} technician(s) are overloaded ` +
          `(workload >= ${MAX_WORKLOAD}).`,
      );
      throw new Error('No eligible technicians available');
    }

    // 4. Normalise distance and workload to [0, 1] so they are comparable
    const maxDistance = Math.max(...candidates.map((t) => t.distance_km), 1);
    const maxWorkload = Math.max(...candidates.map((t) => t.workload), 1);

    console.log(
      `[AssignmentService] Normalisation — maxDist=${maxDistance.toFixed(3)} km, maxWorkload=${maxWorkload}`,
    );

    const scored: ScoredTechnician[] = candidates.map((t) => {
      const normDist = t.distance_km / maxDistance;
      const normWork = t.workload / maxWorkload;
      const score = weights.distance * normDist + weights.workload * normWork;
      console.log(
        `  technician ${t.id} (${t.name}) | ` +
          `normDist=${normDist.toFixed(4)}, normWork=${normWork.toFixed(4)} → score=${score.toFixed(4)}`,
      );
      return { ...t, score };
    });

    // 5. Lowest score wins; stable tie-break by id
    const best = scored.reduce((acc, cur) => (cur.score < acc.score ? cur : acc), scored[0]);

    console.log(
      `[AssignmentService] ✔ Selected technician ${best.id} (${best.name}) for ticket ${event.ticket_id} ` +
        `| priority=${priority} | dist=${best.distance_km.toFixed(3)} km | ` +
        `workload=${best.workload} | final score=${best.score.toFixed(4)}`,
    );

    // 6. Final race-condition guard: verify ticket is still unassigned before committing
    const finalCheck = await this.ticketRepo.isAlreadyAssigned(event.ticket_id);
    if (finalCheck) {
      console.log(
        `[AssignmentService] ⚠ Race condition detected: ticket ${event.ticket_id} was assigned ` +
          `during processing | assigned_to=${finalCheck.assigned_to ?? 'null'} | status=${finalCheck.status}`,
      );
      return null;
    }

    // 7. Update local DB first (workload tracking — always required)
    await this.ticketRepo.assignTicket(event.ticket_id, best.id);

    // 8. Notify ticket-service (authoritative store) — non-blocking in local dev
    // Live technicians table has no level column; default all to L1.
    const supportLevel = 'L1';
    console.log(
      `[AssignmentService] → PATCH ticket-service | ticket=${event.ticket_id} | ` +
        `assigned_to=${best.id} | assigned_to_level=${supportLevel} | status=IN_PROGRESS`,
    );
    try {
      const result = await assignTicket(event.ticket_id, best.id, supportLevel, 'IN_PROGRESS');
      console.log(
        `[AssignmentService] ✔ ticket-service PATCH succeeded for ticket ${event.ticket_id} | response:`,
        JSON.stringify(result),
      );

      // 9. Start SLA tracking after successful assignment
      await this.startSlaTracking(event, best.id);

      // 10. Publish notification event after successful assignment
      await this.publishAssignmentNotification(event.ticket_id, best.id);
    } catch (extErr: any) {
      const status = extErr?.response?.status ?? 'NO_RESPONSE';
      const body = extErr?.response?.data ?? extErr?.message;
      console.error(
        `[AssignmentService] ✘ ticket-service PATCH FAILED for ticket ${event.ticket_id} | ` +
          `HTTP ${status} | body: ${JSON.stringify(body)}`,
      );
    }

    return {
      ticket_id: event.ticket_id,
      technician_id: best.id,
      distance_km: best.distance_km,
      workload: best.workload,
      score: best.score,
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
    userId: number,
    userType: 'technician' | 'supervisor',
  ): Promise<{ id: string; name: string; email: string } | null> {
    try {
      // Step 1: Fetch from local database (preferred source for name)
      const technicianData = await this.technicianRepo.getById(userId);
      
      // Step 2: Fetch email from Auth Service
      const authUser = await getUserDetails(userId);

      // Step 3: Build enriched data object
      const enrichedData = {
        id: String(userId),
        name: technicianData?.name || authUser?.email?.split('@')[0] || '',
        email: authUser?.email || '',
      };

      // Step 4: Validate required fields
      if (!enrichedData.name || !enrichedData.email) {
        const missing: string[] = [];
        if (!enrichedData.name) missing.push('name');
        if (!enrichedData.email) missing.push('email');
        
        console.error(
          `[AssignmentService] ✘ Validation failed for ${userType} ${userId}: ` +
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
        `[AssignmentService] ✘ Failed to enrich ${userType} data for user ${userId}:`,
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
  private async publishAssignmentNotification(ticketId: string, technicianId: number): Promise<void> {
    try {
      console.log(`[AssignmentService] Publishing notification for ticket ${ticketId}...`);

      // Step 1: Fetch ticket details from ticket-service
      const ticketDetails = await getTicketDetails(ticketId);
      const ticketTitle = ticketDetails?.title || 'Untitled Ticket';

      // Step 2: Enrich and validate technician data
      const technicianData = await this.enrichUserData(technicianId, 'technician');
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
      const supervisorData = await this.enrichUserData(supervisor.id, 'supervisor');
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
   * Start SLA tracking after successful ticket assignment
   * 
   * Implementation:
   * - Fetches ticket details from ticket-service (title, priority, status, createdAt)
   * - Enriches technician data (local DB + Auth Service)
   * - Enriches supervisor data (local DB + Auth Service)
   * - Validates all required fields
   * - Calls POST /sla/start with complete payload
   * 
   * Data Flow:
   * 1. Ticket Service API → title, priority, status, createdAt
   * 2. Local DB query (technicians table) → technician name, supervisor
   * 3. Auth Service API → technician email, supervisor email
   * 4. Validation → ensures all fields present
   * 5. POST /sla/start
   * 
   * Error Handling:
   * - Missing data → logged, SLA not started
   * - API failures → logged, SLA not started
   * - Never throws → assignment flow continues even if SLA fails
   */
  private async startSlaTracking(event: TicketCreatedEvent, technicianId: number): Promise<void> {
    try {
      console.log(`[AssignmentService] Starting SLA tracking for ticket ${event.ticket_id}...`);

      // Step 1: Fetch ticket details from ticket-service
      const ticketDetails = await getTicketDetails(event.ticket_id);
      if (!ticketDetails) {
        console.warn(
          `[AssignmentService] ✘ Skipping SLA start: ` +
          `could not fetch ticket details for ticket ${event.ticket_id}`
        );
        return;
      }

      // Step 2: Enrich and validate technician data
      const technicianData = await this.enrichUserData(technicianId, 'technician');
      if (!technicianData) {
        console.warn(
          `[AssignmentService] ✘ Skipping SLA start: ` +
          `technician data validation failed for ticket ${event.ticket_id}`
        );
        return;
      }

      // Step 3: Fetch supervisor from local database
      const supervisor = await this.technicianRepo.getSupervisor();
      if (!supervisor) {
        console.warn(
          `[AssignmentService] ✘ Skipping SLA start: ` +
          `no supervisor found for ticket ${event.ticket_id}`
        );
        return;
      }

      // Step 4: Enrich and validate supervisor data
      const supervisorData = await this.enrichUserData(supervisor.id, 'supervisor');
      if (!supervisorData) {
        console.warn(
          `[AssignmentService] ✘ Skipping SLA start: ` +
          `supervisor data validation failed for ticket ${event.ticket_id}`
        );
        return;
      }

      // Step 5: Call POST /sla/start with complete payload
      await startSlaTracking(
        event.ticket_id,
        ticketDetails.title || 'Untitled Ticket',
        ticketDetails.priority || event.priority || 'MEDIUM',
        ticketDetails.status || 'IN_PROGRESS',
        ticketDetails.created_at || new Date().toISOString(),
        String(technicianId),
        technicianData,
        supervisorData,
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
