import { pool } from '../../db/pool.js';
import { computeAvailableSeats, type EventStatus } from '../events/service.js';

export interface EventDashboardDto {
  eventId: string;
  status: EventStatus;
  confirmed: number;
  pending: number;
  checkIns: number;
  availableSeats: number;
  revenueCents: number;
  revenueFormatted: string;
  refunded: number;
}

export class DashboardDomainError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'DashboardDomainError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

interface EventDashboardAggregationRow {
  id: string;
  organizer_id: string;
  status: EventStatus;
  capacity: number;
  confirmed: number;
  pending: number;
  check_ins: number;
  revenue_cents: number;
  refunded: number;
}

/**
 * Formata um valor em centavos para reais de maneira determinística com espaço ASCII comum (U+0020).
 * Exemplos: 0 -> "R$ 0,00", 35000 -> "R$ 350,00", 125050 -> "R$ 1.250,50".
 */
export function formatRevenueBRL(cents: number): string {
  const safeCents = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const negative = safeCents < 0 ? '-' : '';
  const abs = Math.abs(safeCents);
  const reais = Math.floor(abs / 100);
  const centavos = String(abs % 100).padStart(2, '0');
  const reaisFormatted = reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative}R$ ${reaisFormatted},${centavos}`;
}

/**
 * Consolida os indicadores operacionais e financeiros do evento em uma única consulta SQL
 * consistente sobre `events` e `tickets`, somando vendas da vitrine (`showcase`) e da API
 * de parceiros (`partner`) e validando estritamente a propriedade do organizador (R12, R05, R03, R13).
 */
export async function getOrganizerEventDashboard(
  organizerId: string,
  eventId: string,
): Promise<EventDashboardDto> {
  const { rows } = await pool.query<EventDashboardAggregationRow>(
    `SELECT
       e.id,
       e.organizer_id,
       e.status,
       e.capacity,
       COUNT(*) FILTER (WHERE t.status = 'confirmed')::int AS confirmed,
       COUNT(*) FILTER (WHERE t.status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE t.status = 'confirmed' AND t.checked_in = TRUE)::int AS check_ins,
       COALESCE(SUM(t.price_cents) FILTER (WHERE t.status = 'confirmed'), 0)::int AS revenue_cents,
       COUNT(*) FILTER (WHERE t.status = 'refunded')::int AS refunded
     FROM events e
     LEFT JOIN tickets t ON t.event_id = e.id
     WHERE e.id = $1
     GROUP BY e.id, e.organizer_id, e.status, e.capacity`,
    [eventId],
  );

  if (rows.length === 0) {
    throw new DashboardDomainError(404, 'not_found', 'Evento não encontrado.');
  }

  const row = rows[0];
  if (row.organizer_id !== organizerId) {
    throw new DashboardDomainError(403, 'forbidden', 'Acesso negado.');
  }

  const occupiedSeats = row.confirmed + row.pending;
  const availableSeats = computeAvailableSeats(row.status, row.capacity, occupiedSeats);

  return {
    eventId: row.id,
    status: row.status,
    confirmed: row.confirmed,
    pending: row.pending,
    checkIns: row.check_ins,
    availableSeats,
    revenueCents: row.revenue_cents,
    revenueFormatted: formatRevenueBRL(row.revenue_cents),
    refunded: row.refunded,
  };
}
