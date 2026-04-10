import { TicketCreatedEvent, TicketAssignedEvent, TechnicianRow, TicketPriority } from '../interfaces/types';
import { TechnicianRepository } from '../repositories/TechnicianRepository';
import { TicketRepository } from '../repositories/TicketRepository';
import { haversineDistanceKm } from '../utils/geo';
import { assignTicket } from '../config/externalServices';

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
}
