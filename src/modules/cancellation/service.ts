import { pool, withTransaction } from '../../db/pool.js';
import { config } from '../../shared/config.js';
import type { EventStatus } from '../events/service.js';

export interface CancelledEventResultDto {
  id: string;
  status: 'cancelled';
  availableSeats: 0;
}

export interface EventSettlementResult {
  eventId: string;
  refundedCount: number;
  cancelledCount: number;
}

export interface ReconciliationSummary {
  eventsProcessed: number;
  refundedCount: number;
  cancelledCount: number;
}

export class CancellationDomainError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'CancellationDomainError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

interface LockedCancelEventRow {
  id: string;
  organizer_id: string;
  status: EventStatus;
}

function isPoolClosing(): boolean {
  const internalPool = pool as unknown as { ending?: boolean; ended?: boolean };
  return Boolean(internalPool.ending || internalPool.ended);
}

export function computeCancellationSettlementDelayMs(
  delayMultiplier: number = config.gatewayDelayMultiplier,
): number {
  const multiplier =
    Number.isFinite(delayMultiplier) && delayMultiplier > 0 ? delayMultiplier : 1;
  return Math.max(10, Math.round(300 * multiplier));
}

/**
 * Liquida em transação todos os ingressos pendentes/confirmados de um evento cancelado (R11):
 * - confirmed -> refunded (estornado)
 * - pending   -> cancelled (cancelado)
 * Idempotente e seguro contra reexecuções concorrentes.
 */
export async function processCancelledEventTickets(
  eventId: string,
): Promise<EventSettlementResult> {
  if (isPoolClosing()) {
    return { eventId, refundedCount: 0, cancelledCount: 0 };
  }

  return withTransaction(async (client) => {
    const eventRes = await client.query<{ id: string; status: EventStatus }>(
      `SELECT id, status
       FROM events
       WHERE id = $1
       FOR UPDATE`,
      [eventId],
    );

    if (eventRes.rows.length === 0 || eventRes.rows[0].status !== 'cancelled') {
      return { eventId, refundedCount: 0, cancelledCount: 0 };
    }

    const refundedRes = await client.query(
      `UPDATE tickets
       SET status = 'refunded',
           updated_at = NOW()
       WHERE event_id = $1
         AND status = 'confirmed'`,
      [eventId],
    );

    const cancelledRes = await client.query(
      `UPDATE tickets
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE event_id = $1
         AND status = 'pending'`,
      [eventId],
    );

    return {
      eventId,
      refundedCount: refundedRes.rowCount ?? 0,
      cancelledCount: cancelledRes.rowCount ?? 0,
    };
  });
}

/**
 * Agenda o processamento assíncrono (~300ms * gatewayDelayMultiplier) sem bloquear
 * a resposta HTTP do cancelamento e sem prender o event loop (.unref()).
 */
export function scheduleEventCancellationSettlement(eventId: string): number {
  const delayMs = computeCancellationSettlementDelayMs(config.gatewayDelayMultiplier);

  const timer = setTimeout(() => {
    void processCancelledEventTickets(eventId).catch(() => {
      // Caso ocorra falha transitória, o reconciliador periódico garante a liquidação em < 10s
    });
  }, delayMs);

  timer.unref();

  return delayMs;
}

/**
 * Reconciliador seguro: localiza qualquer evento 'cancelled' que ainda possua
 * ingressos 'confirmed' ou 'pending' e conclui o estorno/cancelamento em transação (R11).
 */
export async function reconcileCancelledEventsTickets(): Promise<ReconciliationSummary> {
  if (isPoolClosing()) {
    return { eventsProcessed: 0, refundedCount: 0, cancelledCount: 0 };
  }

  const pendingEventsRes = await pool.query<{ id: string }>(
    `SELECT DISTINCT e.id
     FROM events e
     INNER JOIN tickets t ON t.event_id = e.id
     WHERE e.status = 'cancelled'
       AND t.status IN ('confirmed', 'pending')`,
  );

  let eventsProcessed = 0;
  let refundedCount = 0;
  let cancelledCount = 0;

  for (const row of pendingEventsRes.rows) {
    if (isPoolClosing()) break;
    const settled = await processCancelledEventTickets(row.id);
    eventsProcessed += 1;
    refundedCount += settled.refundedCount;
    cancelledCount += settled.cancelledCount;
  }

  return { eventsProcessed, refundedCount, cancelledCount };
}

let reconcilerTimer: ReturnType<typeof setInterval> | null = null;
let reconcilingInFlight = false;

export function startCancellationReconciler(): void {
  if (reconcilerTimer !== null || isPoolClosing()) {
    return;
  }

  const multiplier =
    Number.isFinite(config.gatewayDelayMultiplier) && config.gatewayDelayMultiplier > 0
      ? config.gatewayDelayMultiplier
      : 1;
  const intervalMs = Math.max(200, Math.round(2000 * multiplier));

  reconcilerTimer = setInterval(() => {
    if (isPoolClosing()) {
      stopCancellationReconciler();
      return;
    }
    if (reconcilingInFlight) {
      return;
    }

    reconcilingInFlight = true;
    void reconcileCancelledEventsTickets()
      .catch(() => {
        // Silencia erros transitórios (ex.: banco encerrando ao final de suíte de testes)
      })
      .finally(() => {
        reconcilingInFlight = false;
      });
  }, intervalMs);

  reconcilerTimer.unref();
}

export function stopCancellationReconciler(): void {
  if (reconcilerTimer !== null) {
    clearInterval(reconcilerTimer);
    reconcilerTimer = null;
  }
}

/**
 * Cancela irreversivelmente um evento 'published' do organizador autenticado (R11, R05, R13).
 */
export async function cancelOrganizerEvent(
  organizerId: string,
  eventId: string,
): Promise<CancelledEventResultDto> {
  const cancelled = await withTransaction(async (client) => {
    const { rows } = await client.query<LockedCancelEventRow>(
      `SELECT id, organizer_id, status
       FROM events
       WHERE id = $1
       FOR UPDATE`,
      [eventId],
    );

    if (rows.length === 0) {
      throw new CancellationDomainError(404, 'not_found', 'Evento não encontrado.');
    }

    const current = rows[0];
    if (current.organizer_id !== organizerId) {
      throw new CancellationDomainError(403, 'forbidden', 'Acesso negado.');
    }

    if (current.status !== 'published') {
      throw new CancellationDomainError(
        409,
        'cannot_cancel_event',
        'Apenas eventos publicados podem ser cancelados.',
      );
    }

    const updatedRes = await client.query<{ id: string }>(
      `UPDATE events
       SET status = 'cancelled',
           cancelled_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [eventId],
    );

    return {
      id: updatedRes.rows[0].id,
      status: 'cancelled' as const,
      availableSeats: 0 as const,
    };
  });

  scheduleEventCancellationSettlement(cancelled.id);

  return cancelled;
}
