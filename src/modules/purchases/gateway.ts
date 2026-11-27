import crypto from 'node:crypto';
import { pool } from '../../db/pool.js';
import { config } from '../../shared/config.js';

export type GatewayTerminalStatus = 'confirmed' | 'declined';

export interface GatewayOutcome {
  targetStatus: GatewayTerminalStatus;
  baseDelayMs: number;
  effectiveDelayMs: number;
}

function randomIntInclusive(min: number, max: number): number {
  return crypto.randomInt(min, max + 1);
}

/**
 * Calcula deterministicamente o status alvo e sorteia o atraso dentro da janela
 * regulamentar da regra R08:
 * - Final 0001 -> confirmed em 2100..3800ms (2s..5s)
 * - Final 0002 -> declined  em 2100..3800ms (2s..5s)
 * - Final 0003 -> confirmed em 31000..37000ms (30s..40s)
 * - Final 0004 -> declined  em 31000..37000ms (30s..40s)
 * - Qualquer outro final -> declined em 2100..3800ms (2s..5s)
 */
export function computeGatewayOutcome(
  cardNumber: string,
  delayMultiplier: number = config.gatewayDelayMultiplier,
): GatewayOutcome {
  const suffix = cardNumber.slice(-4);

  let targetStatus: GatewayTerminalStatus;
  let baseDelayMs: number;

  switch (suffix) {
    case '0001':
      targetStatus = 'confirmed';
      baseDelayMs = randomIntInclusive(2100, 3800);
      break;
    case '0002':
      targetStatus = 'declined';
      baseDelayMs = randomIntInclusive(2100, 3800);
      break;
    case '0003':
      targetStatus = 'confirmed';
      baseDelayMs = randomIntInclusive(31000, 37000);
      break;
    case '0004':
      targetStatus = 'declined';
      baseDelayMs = randomIntInclusive(31000, 37000);
      break;
    default:
      targetStatus = 'declined';
      baseDelayMs = randomIntInclusive(2100, 3800);
      break;
  }

  const multiplier =
    Number.isFinite(delayMultiplier) && delayMultiplier > 0 ? delayMultiplier : 1;
  const effectiveDelayMs = Math.max(10, Math.round(baseDelayMs * multiplier));

  return {
    targetStatus,
    baseDelayMs,
    effectiveDelayMs,
  };
}

/**
 * Atualiza o ingresso apenas se continuar 'pending' e o evento não estiver 'cancelled' (R08, R11).
 */
export async function applyGatewayResolution(
  ticketId: string,
  targetStatus: GatewayTerminalStatus,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE tickets t
     SET status = $2,
         updated_at = NOW()
     FROM events e
     WHERE t.id = $1
       AND t.event_id = e.id
       AND t.status = 'pending'
       AND e.status != 'cancelled'`,
    [ticketId, targetStatus],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Agenda a resolução assíncrona do gateway simulado sem bloquear a resposta da compra (R06, R08).
 */
export function scheduleSimulatedGateway(ticketId: string, cardNumber: string): GatewayOutcome {
  const outcome = computeGatewayOutcome(cardNumber, config.gatewayDelayMultiplier);

  const timer = setTimeout(() => {
    void applyGatewayResolution(ticketId, outcome.targetStatus).catch(() => {
      // Silencia falha caso o pool já tenha sido encerrado no encerramento de suíte de testes
    });
  }, outcome.effectiveDelayMs);

  timer.unref();

  return outcome;
}
