import { escapeHtml } from './auth.js';

export function formatPriceBRL(priceCents) {
  const cents = Number(priceCents || 0);
  const negative = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const reais = Math.floor(abs / 100);
  const centavos = String(abs % 100).padStart(2, '0');
  const reaisFormatted = reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative}R$ ${reaisFormatted},${centavos}`;
}

export function formatPriceInputBRL(priceCents) {
  const cents = Math.max(0, Math.trunc(Number(priceCents || 0)));
  const reais = Math.floor(cents / 100);
  const centavos = String(cents % 100).padStart(2, '0');
  return `${reais},${centavos}`;
}

export function parsePriceInputToCents(raw) {
  if (raw === null || raw === undefined) return null;
  let str = String(raw).trim().replace(/^R\$\s*/i, '').trim();
  if (!str) return null;

  if (!/^-?[\d.,]+$/.test(str)) return null;
  if (str.startsWith('-')) return -1;

  const hasComma = str.includes(',');
  const hasDot = str.includes('.');

  if (hasComma && hasDot) {
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    if (lastComma > lastDot) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = str.split(',');
    if (parts.length > 2) return null;
    str = `${parts[0]}.${parts[1]}`;
  } else if (hasDot) {
    const parts = str.split('.');
    if (parts.length > 2) return null;
  }

  if (!/^\d+(\.\d{1,2})?$/.test(str)) return null;
  const [intPart, decPart = ''] = str.split('.');
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

export function formatDateTimeBR(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toDatetimeLocalValue(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatEventStatusLabel(status) {
  if (status === 'draft') return 'rascunho';
  if (status === 'published') return 'publicado';
  if (status === 'cancelled') return 'cancelado';
  return String(status || '');
}

export function describeValidationHint({ name, location, startsAtIso, capacity, priceCents }) {
  if (!name || !name.trim()) {
    return 'Informe o nome do evento.';
  }
  if (!location || !location.trim()) {
    return 'Informe o local do evento.';
  }
  if (!startsAtIso || Number.isNaN(new Date(startsAtIso).getTime())) {
    return 'Informe uma data e hora de início válidas.';
  }
  if (new Date(startsAtIso).getTime() <= Date.now()) {
    return 'A data e hora de início devem estar no futuro.';
  }
  if (!Number.isInteger(capacity) || capacity < 1) {
    return 'A lotação deve ser um número inteiro maior ou igual a 1.';
  }
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    return 'O preço deve ser maior que zero.';
  }
  return 'Dados inválidos. Verifique os campos preenchidos (data futura, lotação >= 1 e preço > 0).';
}

export async function renderShowcaseView(container) {
  container.innerHTML = `
    <div class="card" data-view="showcase">
      <h1 style="margin-top: 0;">Eventos disponíveis</h1>
      <p style="color: var(--muted); margin-top: 0;">
        Confira os próximos eventos publicados na vitrine da Catraca.
      </p>
      <div id="showcase-events-list">Carregando eventos...</div>
    </div>
  `;

  const listEl = container.querySelector('#showcase-events-list');

  try {
    const res = await fetch('/api/events', { credentials: 'same-origin' });
    if (!res.ok) {
      if (listEl && container.isConnected) {
        listEl.innerHTML =
          '<div class="alert error">Não foi possível carregar a vitrine de eventos.</div>';
      }
      return;
    }

    const events = await res.json();
    if (!listEl || !container.isConnected) return;

    if (!Array.isArray(events) || events.length === 0) {
      listEl.innerHTML =
        '<p style="color: var(--muted); margin-bottom: 0;">Nenhum evento publicado disponível no momento.</p>';
      return;
    }

    listEl.innerHTML = `
      <div class="grid">
        ${events
          .map((ev) => {
            const soldOut = Number(ev.availableSeats) <= 0;
            const availabilityHtml = soldOut
              ? `<span class="badge" data-availability="sold-out" style="background: #fee2e2; color: #991b1b;">Ingressos esgotados</span>`
              : `<span class="badge" data-availability="available" style="background: #dcfce7; color: #166534;">Vagas disponíveis: ${escapeHtml(ev.availableSeats)}</span>`;

            return `
              <article class="card" style="margin-bottom: 0;" data-event-card="${escapeHtml(ev.id)}">
                <h2 style="margin-top: 0; margin-bottom: 0.5rem; font-size: 1.2rem;">
                  ${escapeHtml(ev.name)}
                </h2>
                <p style="margin: 0.25rem 0; color: var(--muted); font-size: 0.92rem;">
                  <strong>Data/hora:</strong> ${escapeHtml(formatDateTimeBR(ev.startsAt))}
                </p>
                <p style="margin: 0.25rem 0; color: var(--muted); font-size: 0.92rem;">
                  <strong>Local:</strong> ${escapeHtml(ev.location)}
                </p>
                <p style="margin: 0.5rem 0; font-size: 1.1rem; font-weight: 700;">
                  ${escapeHtml(formatPriceBRL(ev.priceCents))}
                </p>
                <div style="margin-top: 0.5rem;">
                  ${availabilityHtml}
                </div>
                <div
                  class="event-purchase-slot"
                  id="event-purchase-slot-${escapeHtml(ev.id)}"
                  data-event-id="${escapeHtml(ev.id)}"
                  data-available-seats="${escapeHtml(ev.availableSeats)}"
                  style="margin-top: 0.85rem;"
                ></div>
              </article>
            `;
          })
          .join('')}
      </div>
    `;
  } catch {
    if (listEl && container.isConnected) {
      listEl.innerHTML =
        '<div class="alert error">Erro de conexão ao carregar a vitrine de eventos.</div>';
    }
  }
}
