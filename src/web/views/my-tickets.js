import { escapeHtml } from './auth.js';
import { formatDateTimeBR, formatPriceBRL } from './showcase.js';

export const TICKET_STATUS_LABELS = {
  pending: 'pendente',
  confirmed: 'confirmado',
  declined: 'recusado',
  cancelled: 'cancelado',
  refunded: 'estornado',
};

export function formatTicketStatusLabel(status) {
  if (status && Object.prototype.hasOwnProperty.call(TICKET_STATUS_LABELS, status)) {
    return TICKET_STATUS_LABELS[status];
  }
  return String(status || '');
}

function getTicketStatusBadgeStyle(status) {
  switch (status) {
    case 'confirmed':
      return 'background: #dcfce7; color: #166534;';
    case 'pending':
      return 'background: #fef3c7; color: #92400e;';
    case 'declined':
      return 'background: #fee2e2; color: #991b1b;';
    case 'cancelled':
      return 'background: #e2e8f0; color: #334155;';
    case 'refunded':
      return 'background: #e0f2fe; color: #075985;';
    default:
      return '';
  }
}

export async function renderMyTicketsView(container, { user = null } = {}) {
  if (!user) {
    container.innerHTML = `
      <div class="card" data-view="my-tickets-guest">
        <h1 style="margin-top: 0;">Meus ingressos</h1>
        <div class="alert info">Entre como participante para visualizar seus ingressos.</div>
        <a href="/login" class="btn" data-link>Entrar</a>
      </div>
    `;
    return;
  }

  if (user.role !== 'participant') {
    container.innerHTML = `
      <div class="card" data-view="access-denied">
        <h1 style="margin-top: 0;">Acesso restrito</h1>
        <div class="alert error">A página "Meus ingressos" é exclusiva para contas de participante.</div>
        <a href="/organizer" class="btn secondary" data-link>Ir para Meus eventos</a>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="card" data-view="my-tickets">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
        <h1 style="margin: 0;">Meus ingressos</h1>
        <button type="button" id="refresh-my-tickets" class="secondary">Atualizar</button>
      </div>
      <p style="color: var(--muted); margin-top: 0.5rem;">
        Acompanhe o status e o código único de cada ingresso adquirido pela sua conta.
      </p>
      <div id="my-tickets-list">Carregando ingressos...</div>
    </div>
  `;

  const listEl = container.querySelector('#my-tickets-list');
  const refreshBtn = container.querySelector('#refresh-my-tickets');

  async function loadTickets() {
    if (!listEl || !container.isConnected) return;
    if (refreshBtn) refreshBtn.disabled = true;

    try {
      const res = await fetch('/api/my-tickets', {
        method: 'GET',
        credentials: 'same-origin',
      });

      if (!res.ok) {
        if (listEl && container.isConnected) {
          listEl.innerHTML =
            '<div class="alert error">Não foi possível carregar seus ingressos.</div>';
        }
        return;
      }

      const tickets = await res.json();
      if (!listEl || !container.isConnected) return;

      if (!Array.isArray(tickets) || tickets.length === 0) {
        listEl.innerHTML = `
          <p style="color: var(--muted); margin-bottom: 0.75rem;">
            Você ainda não possui ingressos comprados.
          </p>
          <a href="/" class="btn" data-link>Explorar eventos na vitrine</a>
        `;
        return;
      }

      listEl.innerHTML = `
        <div class="grid">
          ${tickets
            .map((ticket) => {
              const statusLabel =
                ticket.statusLabel || formatTicketStatusLabel(ticket.status);
              const badgeStyle = getTicketStatusBadgeStyle(ticket.status);
              return `
                <article
                  class="card"
                  style="margin-bottom: 0;"
                  data-ticket-card="${escapeHtml(ticket.ticketId)}"
                  data-ticket-code="${escapeHtml(ticket.code)}"
                >
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.5rem;">
                    <h2 style="margin: 0; font-size: 1.15rem;" data-ticket-event-name>
                      ${escapeHtml(ticket.eventName)}
                    </h2>
                    <span
                      class="badge"
                      data-ticket-status="${escapeHtml(ticket.status)}"
                      style="${badgeStyle}"
                    >${escapeHtml(statusLabel)}</span>
                  </div>
                  <p style="margin: 0.35rem 0; font-size: 0.95rem;">
                    <strong>Código:</strong>
                    <code
                      data-ticket-code-value
                      style="font-size: 1rem; font-weight: 700; background: #f1f5f9; padding: 0.15rem 0.45rem; border-radius: 4px;"
                    >${escapeHtml(ticket.code)}</code>
                  </p>
                  <p style="margin: 0.25rem 0; color: var(--muted); font-size: 0.9rem;">
                    <strong>Data/hora:</strong> ${escapeHtml(formatDateTimeBR(ticket.eventStartsAt))}
                  </p>
                  <p style="margin: 0.25rem 0; color: var(--muted); font-size: 0.9rem;">
                    <strong>Local:</strong> ${escapeHtml(ticket.eventLocation)}
                  </p>
                  <p style="margin: 0.35rem 0 0; font-weight: 600; font-size: 0.95rem;">
                    Valor: ${escapeHtml(formatPriceBRL(ticket.priceCents))}
                  </p>
                </article>
              `;
            })
            .join('')}
        </div>
      `;
    } catch {
      if (listEl && container.isConnected) {
        listEl.innerHTML =
          '<div class="alert error">Erro de conexão ao carregar seus ingressos.</div>';
      }
    } finally {
      if (refreshBtn && container.isConnected) {
        refreshBtn.disabled = false;
      }
    }
  }

  refreshBtn?.addEventListener('click', () => {
    void loadTickets();
  });

  await loadTickets();
}
