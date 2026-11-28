import { withTransaction } from '../../db/pool.js';
import type { EventStatus } from '../events/service.js';
import type { TicketStatus } from '../purchases/service.js';

export type CheckinRejectCode =
  | 'invalid_ticket'
  | 'event_cancelled'
  | 'not_confirmed'
  | 'already_used';

export type CheckinResultCode = 'valid' | CheckinRejectCode;

export const CHECKIN_MESSAGES: Record<CheckinResultCode, string> = {
  invalid_ticket: 'Ingresso inválido para este evento',
  event_cancelled: 'Evento cancelado',
  not_confirmed: 'Ingresso não confirmado',
  already_used: 'Ingresso já utilizado',
  valid: 'Entrada liberada',
};

export interface CheckinAllowedDto {
  allowed: true;
  code: 'valid';
  message: 'Entrada liberada';
  ticketId: string;
}

export interface CheckinRejectedDto {
  allowed: false;
  code: CheckinRejectCode;
  message: string;
}

export type CheckinOutcome =
  | { httpStatus: 200; body: CheckinAllowedDto }
  | { httpStatus: 422; body: CheckinRejectedDto };

export class CheckinDomainError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'CheckinDomainError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface EventCheckinRow {
  id: string;
  organizer_id: string;
  status: EventStatus;
}

interface LockedTicketRow {
  id: string;
  code: string;
  event_id: string;
  status: TicketStatus;
  checked_in: boolean;
}

export async function performEventCheckin(
  organizerId: string,
  eventId: string,
  input: unknown,
): Promise<CheckinOutcome> {
  return withTransaction(async (client) => {
    const eventRes = await client.query<EventCheckinRow>(
      `SELECT id, organizer_id, status
       FROM events
       WHERE id = $1
       FOR SHARE`,
      [eventId],
    );

    if (eventRes.rows.length === 0) {
      throw new CheckinDomainError(404, 'not_found', 'Evento não encontrado.');
    }

    const event = eventRes.rows[0];
    if (event.organizer_id !== organizerId) {
      throw new CheckinDomainError(403, 'forbidden', 'Acesso negado.');
    }

    const rawCode =
      isPlainObject(input) && typeof input.code === 'string' ? input.code.trim() : '';

    const ticketRes = await client.query<LockedTicketRow>(
      `SELECT id, code, event_id, status, checked_in
       FROM tickets
       WHERE code = $1
       FOR UPDATE`,
      [rawCode],
    );

    const ticket = ticketRes.rows[0] ?? null;

    // 1. Código não existe ou pertence a outro evento (R10 - prioridade 1)
    if (!ticket || ticket.event_id !== eventId) {
      return {
        httpStatus: 422,
        body: {
          allowed: false,
          code: 'invalid_ticket',
          message: CHECKIN_MESSAGES.invalid_ticket,
        },
      };
    }

    // 2. Evento está cancelado (R10 - prioridade 2)
    if (event.status === 'cancelled') {
      return {
        httpStatus: 422,
        body: {
          allowed: false,
          code: 'event_cancelled',
          message: CHECKIN_MESSAGES.event_cancelled,
        },
      };
    }

    // 3. Ingresso não está confirmado (R10 - prioridade 3)
    if (ticket.status !== 'confirmed') {
      return {
        httpStatus: 422,
        body: {
          allowed: false,
          code: 'not_confirmed',
          message: CHECKIN_MESSAGES.not_confirmed,
        },
      };
    }

    // 4. Ingresso já passou pelo check-in (R10 - prioridade 4)
    if (ticket.checked_in === true) {
      return {
        httpStatus: 422,
        body: {
          allowed: false,
          code: 'already_used',
          message: CHECKIN_MESSAGES.already_used,
        },
      };
    }

    // 5. Caso contrário -> registra check-in preservando status = 'confirmed' (R10 - prioridade 5)
    await client.query(
      `UPDATE tickets
       SET checked_in = TRUE,
           checked_in_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [ticket.id],
    );

    return {
      httpStatus: 200,
      body: {
        allowed: true,
        code: 'valid',
        message: 'Entrada liberada',
        ticketId: ticket.id,
      },
    };
  });
}
