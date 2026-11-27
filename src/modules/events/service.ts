import { pool, withTransaction } from '../../db/pool.js';
import { generateId } from '../../shared/ids.js';

export type EventStatus = 'draft' | 'published' | 'cancelled';

export interface OrganizerEventDto {
  id: string;
  organizerId: string;
  name: string;
  startsAt: string;
  location: string;
  capacity: number;
  priceCents: number;
  status: EventStatus;
  occupiedSeats: number;
  availableSeats: number;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShowcaseEventDto {
  id: string;
  name: string;
  startsAt: string;
  location: string;
  capacity: number;
  priceCents: number;
  availableSeats: number;
}

export interface PartnerEventDto {
  id: string;
  name: string;
  startsAt: string;
  priceCents: number;
  availableSeats: number;
}

interface EventRow {
  id: string;
  organizer_id: string;
  name: string;
  starts_at: Date | string;
  location: string;
  capacity: number;
  price_cents: number;
  status: EventStatus;
  cancelled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  occupied_seats?: number;
}

export class EventDomainError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'EventDomainError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const ISO_DATETIME_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?$/;

export function parseFutureIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = ISO_DATETIME_REGEX.exec(trimmed);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] !== undefined ? Number(match[6]) : 0;
  const tzOffset = match[8];

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }

  if (tzOffset && tzOffset !== 'Z') {
    const [tzH, tzM] = tzOffset.slice(1).split(':').map(Number);
    if (tzH > 23 || tzM > 59) return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;

  if (parsed.getTime() <= Date.now()) {
    return null;
  }

  return parsed;
}

interface ValidatedEventFields {
  name: string;
  location: string;
  startsAt: Date;
  capacity: number;
  priceCents: number;
}

function validateEventPayload(raw: {
  name: unknown;
  location: unknown;
  startsAt: unknown;
  capacity: unknown;
  priceCents: unknown;
}): ValidatedEventFields {
  if (typeof raw.name !== 'string' || raw.name.trim().length < 1 || raw.name.trim().length > 300) {
    throw new EventDomainError(422, 'invalid_request', 'Nome do evento inválido.');
  }

  if (
    typeof raw.location !== 'string' ||
    raw.location.trim().length < 1 ||
    raw.location.trim().length > 300
  ) {
    throw new EventDomainError(422, 'invalid_request', 'Local do evento inválido.');
  }

  const startsAt = parseFutureIsoDate(raw.startsAt);
  if (!startsAt) {
    throw new EventDomainError(
      422,
      'invalid_request',
      'Data/hora de início inválida ou não está no futuro.',
    );
  }

  if (
    typeof raw.capacity !== 'number' ||
    !Number.isInteger(raw.capacity) ||
    !Number.isSafeInteger(raw.capacity) ||
    raw.capacity < 1
  ) {
    throw new EventDomainError(422, 'invalid_request', 'Lotação deve ser inteiro >= 1.');
  }

  if (
    typeof raw.priceCents !== 'number' ||
    !Number.isInteger(raw.priceCents) ||
    !Number.isSafeInteger(raw.priceCents) ||
    raw.priceCents <= 0
  ) {
    throw new EventDomainError(422, 'invalid_request', 'Preço deve ser inteiro maior que zero.');
  }

  return {
    name: raw.name.trim(),
    location: raw.location.trim(),
    startsAt,
    capacity: raw.capacity,
    priceCents: raw.priceCents,
  };
}

export function computeAvailableSeats(
  status: EventStatus,
  capacity: number,
  occupiedSeats: number,
): number {
  if (status === 'cancelled') {
    return 0;
  }
  return Math.max(0, capacity - occupiedSeats);
}

function toOrganizerEventDto(row: EventRow, occupiedSeats: number): OrganizerEventDto {
  return {
    id: row.id,
    organizerId: row.organizer_id,
    name: row.name,
    startsAt: new Date(row.starts_at).toISOString(),
    location: row.location,
    capacity: row.capacity,
    priceCents: row.price_cents,
    status: row.status,
    occupiedSeats,
    availableSeats: computeAvailableSeats(row.status, row.capacity, occupiedSeats),
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function createOrganizerEvent(
  organizerId: string,
  input: unknown,
): Promise<OrganizerEventDto> {
  if (!isPlainObject(input)) {
    throw new EventDomainError(422, 'invalid_request', 'Corpo da requisição inválido.');
  }

  const validated = validateEventPayload({
    name: input.name,
    location: input.location,
    startsAt: input.startsAt,
    capacity: input.capacity,
    priceCents: input.priceCents,
  });

  const id = generateId('evt');

  const { rows } = await pool.query<EventRow>(
    `INSERT INTO events (id, organizer_id, name, starts_at, location, capacity, price_cents, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
     RETURNING id, organizer_id, name, starts_at, location, capacity, price_cents, status, cancelled_at, created_at, updated_at`,
    [
      id,
      organizerId,
      validated.name,
      validated.startsAt.toISOString(),
      validated.location,
      validated.capacity,
      validated.priceCents,
    ],
  );

  return toOrganizerEventDto(rows[0], 0);
}

export async function listOrganizerEvents(organizerId: string): Promise<OrganizerEventDto[]> {
  const { rows } = await pool.query<EventRow>(
    `SELECT
       e.id,
       e.organizer_id,
       e.name,
       e.starts_at,
       e.location,
       e.capacity,
       e.price_cents,
       e.status,
       e.cancelled_at,
       e.created_at,
       e.updated_at,
       COALESCE(t.occupied_seats, 0)::int AS occupied_seats
     FROM events e
     LEFT JOIN (
       SELECT event_id, COUNT(*)::int AS occupied_seats
       FROM tickets
       WHERE status IN ('pending', 'confirmed')
       GROUP BY event_id
     ) t ON t.event_id = e.id
     WHERE e.organizer_id = $1
     ORDER BY e.created_at DESC, e.id DESC`,
    [organizerId],
  );

  return rows.map((row) => toOrganizerEventDto(row, row.occupied_seats ?? 0));
}

export async function getOrganizerEvent(
  organizerId: string,
  eventId: string,
): Promise<OrganizerEventDto> {
  const { rows } = await pool.query<EventRow>(
    `SELECT
       e.id,
       e.organizer_id,
       e.name,
       e.starts_at,
       e.location,
       e.capacity,
       e.price_cents,
       e.status,
       e.cancelled_at,
       e.created_at,
       e.updated_at,
       COALESCE(t.occupied_seats, 0)::int AS occupied_seats
     FROM events e
     LEFT JOIN (
       SELECT event_id, COUNT(*)::int AS occupied_seats
       FROM tickets
       WHERE status IN ('pending', 'confirmed')
       GROUP BY event_id
     ) t ON t.event_id = e.id
     WHERE e.id = $1`,
    [eventId],
  );

  if (rows.length === 0) {
    throw new EventDomainError(404, 'not_found', 'Evento não encontrado.');
  }

  const row = rows[0];
  if (row.organizer_id !== organizerId) {
    throw new EventDomainError(403, 'forbidden', 'Acesso negado.');
  }

  return toOrganizerEventDto(row, row.occupied_seats ?? 0);
}

export async function updateOrganizerEvent(
  organizerId: string,
  eventId: string,
  input: unknown,
): Promise<OrganizerEventDto> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<EventRow>(
      `SELECT id, organizer_id, name, starts_at, location, capacity, price_cents, status, cancelled_at, created_at, updated_at
       FROM events
       WHERE id = $1
       FOR UPDATE`,
      [eventId],
    );

    if (rows.length === 0) {
      throw new EventDomainError(404, 'not_found', 'Evento não encontrado.');
    }

    const current = rows[0];
    if (current.organizer_id !== organizerId) {
      throw new EventDomainError(403, 'forbidden', 'Acesso negado.');
    }

    if (current.status === 'cancelled') {
      throw new EventDomainError(409, 'event_cancelled', 'Evento cancelado não pode ser editado.');
    }

    if (!isPlainObject(input)) {
      throw new EventDomainError(422, 'invalid_request', 'Corpo da requisição inválido.');
    }

    const hasEditableField =
      'name' in input ||
      'startsAt' in input ||
      'location' in input ||
      'capacity' in input ||
      'priceCents' in input;

    if (!hasEditableField) {
      throw new EventDomainError(422, 'invalid_request', 'Nenhum campo informado para edição.');
    }

    const rawName = 'name' in input ? input.name : current.name;
    const rawLocation = 'location' in input ? input.location : current.location;
    const rawStartsAt =
      'startsAt' in input ? input.startsAt : new Date(current.starts_at).toISOString();
    const rawCapacity = 'capacity' in input ? input.capacity : current.capacity;
    const rawPriceCents = 'priceCents' in input ? input.priceCents : current.price_cents;

    const validated = validateEventPayload({
      name: rawName,
      location: rawLocation,
      startsAt: rawStartsAt,
      capacity: rawCapacity,
      priceCents: rawPriceCents,
    });

    const occRes = await client.query<{ occupied: number }>(
      `SELECT COUNT(*)::int AS occupied
       FROM tickets
       WHERE event_id = $1 AND status IN ('pending', 'confirmed')`,
      [eventId],
    );
    const occupiedSeats = occRes.rows[0]?.occupied ?? 0;

    if (validated.capacity < occupiedSeats) {
      throw new EventDomainError(
        409,
        'capacity_below_occupied',
        'A lotação não pode ser menor que o total de vagas ocupadas.',
      );
    }

    const updatedRes = await client.query<EventRow>(
      `UPDATE events
       SET name = $2,
           starts_at = $3,
           location = $4,
           capacity = $5,
           price_cents = $6,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, organizer_id, name, starts_at, location, capacity, price_cents, status, cancelled_at, created_at, updated_at`,
      [
        eventId,
        validated.name,
        validated.startsAt.toISOString(),
        validated.location,
        validated.capacity,
        validated.priceCents,
      ],
    );

    return toOrganizerEventDto(updatedRes.rows[0], occupiedSeats);
  });
}

export async function publishOrganizerEvent(
  organizerId: string,
  eventId: string,
): Promise<OrganizerEventDto> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<EventRow>(
      `SELECT id, organizer_id, name, starts_at, location, capacity, price_cents, status, cancelled_at, created_at, updated_at
       FROM events
       WHERE id = $1
       FOR UPDATE`,
      [eventId],
    );

    if (rows.length === 0) {
      throw new EventDomainError(404, 'not_found', 'Evento não encontrado.');
    }

    const current = rows[0];
    if (current.organizer_id !== organizerId) {
      throw new EventDomainError(403, 'forbidden', 'Acesso negado.');
    }

    if (current.status === 'cancelled') {
      throw new EventDomainError(
        409,
        'event_cancelled',
        'Evento cancelado não pode ser republicado.',
      );
    }

    const occRes = await client.query<{ occupied: number }>(
      `SELECT COUNT(*)::int AS occupied
       FROM tickets
       WHERE event_id = $1 AND status IN ('pending', 'confirmed')`,
      [eventId],
    );
    const occupiedSeats = occRes.rows[0]?.occupied ?? 0;

    if (current.status === 'published') {
      return toOrganizerEventDto(current, occupiedSeats);
    }

    const updatedRes = await client.query<EventRow>(
      `UPDATE events
       SET status = 'published',
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, organizer_id, name, starts_at, location, capacity, price_cents, status, cancelled_at, created_at, updated_at`,
      [eventId],
    );

    return toOrganizerEventDto(updatedRes.rows[0], occupiedSeats);
  });
}

export async function listShowcaseEvents(): Promise<ShowcaseEventDto[]> {
  const { rows } = await pool.query<EventRow>(
    `SELECT
       e.id,
       e.name,
       e.starts_at,
       e.location,
       e.capacity,
       e.price_cents,
       e.status,
       COALESCE(t.occupied_seats, 0)::int AS occupied_seats
     FROM events e
     LEFT JOIN (
       SELECT event_id, COUNT(*)::int AS occupied_seats
       FROM tickets
       WHERE status IN ('pending', 'confirmed')
       GROUP BY event_id
     ) t ON t.event_id = e.id
     WHERE e.status = 'published'
     ORDER BY e.starts_at ASC, e.created_at ASC, e.id ASC`,
  );

  return rows.map((row) => {
    const occupied = row.occupied_seats ?? 0;
    return {
      id: row.id,
      name: row.name,
      startsAt: new Date(row.starts_at).toISOString(),
      location: row.location,
      capacity: row.capacity,
      priceCents: row.price_cents,
      availableSeats: computeAvailableSeats(row.status, row.capacity, occupied),
    };
  });
}

export async function listPartnerEvents(): Promise<PartnerEventDto[]> {
  const { rows } = await pool.query<EventRow>(
    `SELECT
       e.id,
       e.name,
       e.starts_at,
       e.capacity,
       e.price_cents,
       e.status,
       COALESCE(t.occupied_seats, 0)::int AS occupied_seats
     FROM events e
     LEFT JOIN (
       SELECT event_id, COUNT(*)::int AS occupied_seats
       FROM tickets
       WHERE status IN ('pending', 'confirmed')
       GROUP BY event_id
     ) t ON t.event_id = e.id
     WHERE e.status = 'published'
     ORDER BY e.starts_at ASC, e.created_at ASC, e.id ASC`,
  );

  return rows.map((row) => {
    const occupied = row.occupied_seats ?? 0;
    return {
      id: row.id,
      name: row.name,
      startsAt: new Date(row.starts_at).toISOString(),
      priceCents: row.price_cents,
      availableSeats: computeAvailableSeats(row.status, row.capacity, occupied),
    };
  });
}
