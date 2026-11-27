import { escapeHtml, renderOrganizerGuardBlockedView } from './auth.js';
import {
  describeValidationHint,
  formatDateTimeBR,
  formatEventStatusLabel,
  formatPriceBRL,
  parsePriceInputToCents,
} from './showcase.js';

function statusBadgeStyle(status) {
  if (status === 'published') return 'background: #dcfce7; color: #166534;';
  if (status === 'cancelled') return 'background: #fee2e2; color: #991b1b;';
  return 'background: #fef3c7; color: #92400e;';
}

export async function renderOrganizerListView(container, { user }) {
  if (!user || user.role !== 'organizer') {
    renderOrganizerGuardBlockedView(container, user);
    return;
  }

  container.innerHTML = `
    <div data-view="organizer-home">
      <div class="card">
        <h1 style="margin-top: 0;">Área do Organizador</h1>
        <p style="color: var(--muted); margin-top: 0; margin-bottom: 0;">
          Bem-vindo(a), ${escapeHtml(user.name)}. Gerencie seus eventos com segurança e isolamento.
        </p>
      </div>

      <div class="card" data-section="create-event">
        <h2 style="margin-top: 0;">Criar novo evento</h2>
        <p style="color: var(--muted); margin-top: 0; font-size: 0.9rem;">
          Todo evento é criado como <strong>rascunho</strong> e só aparece na vitrine após ser publicado.
        </p>
        <div id="create-event-error" class="alert error" hidden></div>
        <div id="create-event-success" class="alert success" hidden></div>
        <form id="create-event-form" novalidate>
          <label for="event-name">Nome do evento</label>
          <input id="event-name" name="name" type="text" required />

          <label for="event-starts-at">Data e hora de início</label>
          <input id="event-starts-at" name="startsAt" type="datetime-local" required />

          <label for="event-location">Local</label>
          <input id="event-location" name="location" type="text" required />

          <label for="event-capacity">Lotação máxima</label>
          <input id="event-capacity" name="capacity" type="number" step="1" required />

          <label for="event-price">Preço do ingresso (R$)</label>
          <input
            id="event-price"
            name="price"
            type="text"
            inputmode="decimal"
            placeholder="Ex: 100,00"
            required
          />

          <button type="submit" id="create-event-submit">Criar evento</button>
        </form>
      </div>

      <div class="card" data-section="organizer-events">
        <h2 style="margin-top: 0;">Meus eventos</h2>
        <div id="organizer-events-list">Carregando eventos...</div>
      </div>
    </div>
  `;

  const listEl = container.querySelector('#organizer-events-list');
  const form = container.querySelector('#create-event-form');
  const errorBox = container.querySelector('#create-event-error');
  const successBox = container.querySelector('#create-event-success');
  const submitBtn = container.querySelector('#create-event-submit');

  async function loadEvents() {
    if (!listEl) return;
    try {
      const res = await fetch('/api/organizer/events', { credentials: 'same-origin' });
      if (res.status === 401 || res.status === 403) {
        renderOrganizerGuardBlockedView(container, res.status === 401 ? null : user);
        return;
      }
      if (!res.ok) {
        listEl.innerHTML = '<div class="alert error">Erro ao carregar eventos do organizador.</div>';
        return;
      }

      const events = await res.json();
      if (!Array.isArray(events) || events.length === 0) {
        listEl.innerHTML =
          '<p style="color: var(--muted); margin-bottom: 0;">Nenhum evento cadastrado ainda.</p>';
        return;
      }

      listEl.innerHTML = `
        <div class="grid">
          ${events
            .map(
              (ev) => `
                <article class="card" style="margin-bottom: 0;" data-organizer-event-card="${escapeHtml(ev.id)}">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                    <h3 style="margin: 0; font-size: 1.1rem;">${escapeHtml(ev.name)}</h3>
                    <span class="badge" style="${statusBadgeStyle(ev.status)}">
                      ${escapeHtml(formatEventStatusLabel(ev.status))}
                    </span>
                  </div>
                  <p style="margin: 0.4rem 0 0.2rem; color: var(--muted); font-size: 0.9rem;">
                    <strong>Início:</strong> ${escapeHtml(formatDateTimeBR(ev.startsAt))}
                  </p>
                  <p style="margin: 0.2rem 0; color: var(--muted); font-size: 0.9rem;">
                    <strong>Local:</strong> ${escapeHtml(ev.location)}
                  </p>
                  <p style="margin: 0.2rem 0; color: var(--muted); font-size: 0.9rem;">
                    <strong>Preço:</strong> ${escapeHtml(formatPriceBRL(ev.priceCents))}
                  </p>
                  <p style="margin: 0.2rem 0 0.85rem; color: var(--muted); font-size: 0.9rem;">
                    <strong>Lotação:</strong> ${escapeHtml(ev.capacity)} (Disponíveis: ${escapeHtml(ev.availableSeats)})
                  </p>
                  <a href="/organizer/events/${encodeURIComponent(ev.id)}" class="btn" data-link>
                    Gerenciar evento
                  </a>
                </article>
              `,
            )
            .join('')}
        </div>
      `;
    } catch {
      if (listEl) {
        listEl.innerHTML = '<div class="alert error">Erro de conexão ao carregar seus eventos.</div>';
      }
    }
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = '';
    }
    if (successBox) {
      successBox.hidden = true;
      successBox.innerHTML = '';
    }

    const formData = new FormData(form);
    const name = String(formData.get('name') || '').trim();
    const startsAtRaw = String(formData.get('startsAt') || '').trim();
    const location = String(formData.get('location') || '').trim();
    const capacityRaw = String(formData.get('capacity') || '').trim();
    const priceRaw = String(formData.get('price') || '').trim();

    let startsAtIso = '';
    if (startsAtRaw) {
      const parsedDate = new Date(startsAtRaw);
      startsAtIso = Number.isNaN(parsedDate.getTime()) ? startsAtRaw : parsedDate.toISOString();
    }

    const capacity =
      capacityRaw !== '' && /^-?\d+$/.test(capacityRaw) ? Number(capacityRaw) : Number.NaN;
    const parsedPrice = parsePriceInputToCents(priceRaw);
    const priceCents = parsedPrice === null ? -1 : parsedPrice;

    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch('/api/organizer/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name,
          startsAt: startsAtIso,
          location,
          capacity: Number.isNaN(capacity) ? capacityRaw : capacity,
          priceCents,
        }),
      });

      if (res.status === 401 || res.status === 403) {
        renderOrganizerGuardBlockedView(container, res.status === 401 ? null : user);
        return;
      }

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (errorBox) {
          errorBox.textContent = describeValidationHint({
            name,
            location,
            startsAtIso,
            capacity,
            priceCents,
          });
          errorBox.hidden = false;
        }
        return;
      }

      form.reset();
      if (successBox) {
        successBox.innerHTML = `Evento <strong>${escapeHtml(body.name)}</strong> criado como rascunho. <a href="/organizer/events/${encodeURIComponent(body.id)}" data-link>Abrir página de gestão</a>`;
        successBox.hidden = false;
      }
      await loadEvents();
    } catch {
      if (errorBox) {
        errorBox.textContent = 'Erro de conexão ao tentar criar o evento.';
        errorBox.hidden = false;
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  await loadEvents();
}
