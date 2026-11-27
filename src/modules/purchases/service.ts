import { pool, withTransaction } from '../../db/pool.js';
import { generateId, generateTicketCode } from '../../shared/ids.js';
import { isValidEmail } from '../auth/routes.js';
import type { EventStatus } from '../events/service.js';
import { scheduleSimulatedGateway } from './gateway.js';

export type TicketStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'refunded';
export type TicketStatusLabel = 'pendente' | 'confirmado' | 'recusado' | 'cancelado' | 'estornado';
export type PurchaseChannel = 'showcase' | 'partner';

export const TICKET_STATUS_LABELS: Record<TicketStatus, TicketStatusLabel> = {
  pending: 'pendente',
  confirmed: 'confirmado',
  declined: 'recusado',
  cancelled: 'cancelado',
  refunded: 'estornado',
};

export function formatTicketStatusLabel(status: TicketStatus): TicketStatusLabel {
  return TICKET_STATUS_LABELS[status];
}

export interface PurchaseAcceptedDto {
  ticketId: string;
  code: string;
  status: 'pending';
}

export interface ParticipantTicketDto {
  ticketId: string;
  code: string;
  eventId: string;
  eventName: string;
  eventStartsAt: string;
  eventLocation: string;
  priceCents: number;
  status: TicketStatus;
  statusLabel: TicketStatusLabel;
  checkedIn: boolean;
  createdAt: string;
}

export interface PartnerTicketDto {
  ticketId: string;
  code: string;
  eventId: string;
  status: TicketStatus;
  checkedIn: boolean;
}

export class PurchaseDomainError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'PurchaseDomainError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const CARD_NUMBER_REGEX = /^\d{16}$/;

export function isValidCardNumber(value: unknown): value is string {
  return typeof value === 'string' && CARD_NUMBER_REGEX.test(value);
}

interface AtomicPurchaseParams {
  eventId: string;
  participantId: string | null;
  buyerEmail: string;
  channel: PurchaseChannel;
  cardNumber: string;
}

interface LockedEventRow {
  id: string;
  status: EventStatus;
  capacity: number;
  price_cents: number;
}

async function createPendingTicketAndScheduleGateway(
  params: AtomicPurchaseParams,
): Promise<PurchaseAcceptedDto> {
  const created = await withTransaction(async (client) => {
    const eventRes = await client.query<LockedEventRow>(
      `SELECT id, status, capacity, price_cents
       FROM events
       WHERE id = $1
       FOR UPDATE`,
      [params.eventId],
    );

    if (eventRes.rows.length === 0 || eventRes.rows[0].status !== 'published') {
      throw new PurchaseDomainError(
        404,
        'event_not_available',
        'Evento inexistente ou indisponível para compra.',
      );
    }

    const event = eventRes.rows[0];

    const occupiedRes = await client.query<{ occupied: number }>(
      `SELECT COUNT(*)::int AS occupied
       FROM tickets
       WHERE event_id = $1
         AND status IN ('pending', 'confirmed')`,
      [event.id],
    );
    const occupied = occupiedRes.rows[0]?.occupied ?? 0;

    if (occupied >= event.capacity) {
      throw new PurchaseDomainError(409, 'sold_out', 'Ingressos esgotados.');
    }

    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ticketId = generateId('tkt');
      const code = generateTicketCode(8);

      await client.query('SAVEPOINT sp_insert_ticket');
      try {
        await client.query(
          `INSERT INTO tickets (
             id,
             code,
             event_id,
             participant_id,
             buyer_email,
             channel,
             price_cents,
             status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
          [
            ticketId,
            code,
            event.id,
            params.participantId,
            params.buyerEmail,
            params.channel,
            event.price_cents,
          ],
        );
        await client.query('RELEASE SAVEPOINT sp_insert_ticket');

        return {
          ticketId,
          code,
          status: 'pending' as const,
        };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT sp_insert_ticket');
        if ((err as { code?: string })?.code === '23505' && attempt < maxAttempts) {
          continue;
        }
        throw err;
      }
    }

    throw new Error('Não foi possível gerar código único de ingresso após múltiplas tentativas.');
  });

  // Dispara o gateway simulado APÓS o COMMIT da transação sem bloquear a resposta (R06, R08)
  scheduleSimulatedGateway(created.ticketId, params.cardNumber);

  return created;
}

export async function purchaseShowcaseTicket(
  participant: { id: string; email: string },
  eventId: string,
  input: unknown,
): Promise<PurchaseAcceptedDto> {
  // Valida os 16 dígitos numéricos do cartão ANTES de consultar evento ou criar ingresso (CA-F03-02)
  if (!isPlainObject(input) || !isValidCardNumber(input.cardNumber)) {
    throw new PurchaseDomainError(
      422,
      'invalid_request',
      'Informe um número de cartão válido com exatamente 16 dígitos numéricos.',
    );
  }

  return createPendingTicketAndScheduleGateway({
    eventId,
    participantId: participant.id,
    buyerEmail: participant.email,
    channel: 'showcase',
    cardNumber: input.cardNumber,
  });
}

export async function purchasePartnerTicket(
  eventId: string,
  input: unknown,
): Promise<PurchaseAcceptedDto> {
  // Ordem estrita (CA-F03-02): após 401 X-Api-Key, valida corpo (422) ANTES de consultar o evento (404)
  if (!isPlainObject(input)) {
    throw new PurchaseDomainError(422, 'invalid_request', 'Corpo da requisição inválido.');
  }

  const { buyerEmail, cardNumber } = input;
  if (
    typeof buyerEmail !== 'string' ||
    !isValidEmail(buyerEmail) ||
    !isValidCardNumber(cardNumber)
  ) {
    throw new PurchaseDomainError(422, 'invalid_request', 'Dados de compra inválidos.');
  }

  const cleanEmail = buyerEmail.trim().toLowerCase();

  return createPendingTicketAndScheduleGateway({
    eventId,
    participantId: null,
    buyerEmail: cleanEmail,
    channel: 'partner',
    cardNumber,
  });
}

interface ParticipantTicketRow {
  id: string;
  code: string;
  event_id: string;
  event_name: string;
  event_starts_at: Date | string;
  event_location: string;
  price_cents: number;
  status: TicketStatus;
  checked_in: boolean;
  created_at: Date | string;
}

export async function listParticipantTickets(
  participantId: string,
): Promise<ParticipantTicketDto[]> {
  const { rows } = await pool.query<ParticipantTicketRow>(
    `SELECT
       t.id,
       t.code,
       t.event_id,
       e.name AS event_name,
       e.starts_at AS event_starts_at,
       e.location AS event_location,
       t.price_cents,
       t.status,
       t.checked_in,
       t.created_at
     FROM tickets t
     INNER JOIN events e ON e.id = t.event_id
     WHERE t.participant_id = $1
     ORDER BY t.created_at DESC, t.id DESC`,
    [participantId],
  );

  return rows.map((row) => ({
    ticketId: row.id,
    code: row.code,
    eventId: row.event_id,
    eventName: row.event_name,
    eventStartsAt: new Date(row.event_starts_at).toISOString(),
    eventLocation: row.event_location,
    priceCents: row.price_cents,
    status: row.status,
    statusLabel: formatTicketStatusLabel(row.status),
    checkedIn: row.checked_in,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

interface PartnerTicketRow {
  id: string;
  code: string;
  event_id: string;
  status: TicketStatus;
  checked_in: boolean;
}

export async function getPartnerTicketById(ticketId: string): Promise<PartnerTicketDto> {
  const { rows } = await pool.query<PartnerTicketRow>(
    `SELECT id, code, event_id, status, checked_in
     FROM tickets
     WHERE id = $1`,
    [ticketId],
  );

  if (rows.length === 0) {
    throw new PurchaseDomainError(404, 'ticket_not_found', 'Ingresso não encontrado.');
  }

  const row = rows[0];
  return {
    ticketId: row.id,
    code: row.code,
    eventId: row.event_id,
    status: row.status,
    checkedIn: row.checked_in,
  };
}
