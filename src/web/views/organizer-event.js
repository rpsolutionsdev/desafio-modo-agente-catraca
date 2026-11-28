import { escapeHtml, renderOrganizerGuardBlockedView } from './auth.js';
import { renderCheckinWidget } from './checkin-widget.js';
import { renderDashboardWidget } from './dashboard-widget.js';
import {
  describeValidationHint,
  formatDateTimeBR,
  formatEventStatusLabel,
  formatPriceBRL,
  formatPriceInputBRL,
  parsePriceInputToCents,
  toDatetimeLocalValue,
} from './showcase.js';
import { mountCancelWidget } from './cancel-widget.js';

function statusBadgeStyle(status) {
  if (status === 'published') return 'background: #dcfce7; color: #166534;';
  if (status === 'cancelled') return 'background: #fee2e2; color: #991b1b;';
  return 'background: #fef3c7; color: #92400e;';
}

function renderForbiddenEventView(container) {
  container.innerHTML = `
    <div class="card" data-view="access-denied" data-reason="forbidden">
      <h1>Acesso negado</h1>
      <div class="alert error">Você não tem permissão para acessar ou gerenciar este evento.</div>
      <a href="/organizer" class="btn secondary" data-link>Voltar para Meus eventos</a>
    </div>
  `;
}

function renderNotFoundEventView(container) {
  container.innerHTML = `
    <div class="card" data-view="event-not-found">
      <h1>Evento indisponível</h1>
      <div class="alert error">O evento solicitado não foi encontrado ou não está disponível.</div>
      <a href="/organizer" class="btn secondary" data-link>Voltar para Meus eventos</a>
    </div>
  `;
}

export async function renderOrganizerEventView(container, { eventId, user }) {
  if (!user || user.role !== 'organizer') {
    renderOrganizerGuardBlockedView(container, user);
    return;
  }

  container.innerHTML = `
    <div class="card" data-view="organizer-event-loading">
      <p style="margin: 0;">Carregando...</p>
    </div>
  `;

  let currentEvent;
  try {
    const res = await fetch(`/api/organizer/events/${encodeURIComponent(eventId)}`, {
      credentials: 'same-origin',
    });

    if (res.status === 401) {
      renderOrganizerGuardBlockedView(container, null);
      return;
    }

    if (res.status === 403) {
      renderForbiddenEventView(container);
      return;
    }

    if (res.status === 404 || !res.ok) {
      renderNotFoundEventView(container);
      return;
    }

    currentEvent = await res.json();
  } catch {
    renderNotFoundEventView(container);
    return;
  }

  if (!container.isConnected) return;

  let activeDashboardWidget = null;

  function renderDetail(flashMessage = '') {
    if (activeDashboardWidget && typeof activeDashboardWidget.destroy === 'function') {
      activeDashboardWidget.destroy();
      activeDashboardWidget = null;
    }

    const isCancelled = currentEvent.status === 'cancelled';
    const isDraft = currentEvent.status === 'draft';
    const disabledAttr = isCancelled ? 'disabled' : '';

    container.innerHTML = `
      <div data-view="organizer-event-detail" data-event-id="${escapeHtml(currentEvent.id)}">
        <div style="margin-bottom: 1rem;">
          <a href="/organizer" class="btn secondary" data-link>Voltar para Meus eventos</a>
        </div>

        <div class="card" data-section="event-overview">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
            <div>
              <h1 style="margin: 0 0 0.35rem 0;" id="detail-event-name">${escapeHtml(currentEvent.name)}</h1>
              <span class="badge" id="detail-event-status" style="${statusBadgeStyle(currentEvent.status)}">
                ${escapeHtml(formatEventStatusLabel(currentEvent.status))}
              </span>
            </div>
            <div id="publish-action-container">
              ${
                isDraft
                  ? '<button type="button" id="publish-event-btn">Publicar</button>'
                  : ''
              }
            </div>
          </div>

          <div id="publish-feedback" class="alert success" ${flashMessage ? '' : 'hidden'}>${escapeHtml(flashMessage)}</div>
          <div id="publish-error" class="alert error" hidden></div>

          <div class="stats-grid" style="margin-top: 1rem;">
            <div class="stat-box">
              <div class="stat-label">Início</div>
              <div class="stat-value" style="font-size: 1rem;" id="detail-event-starts-at">
                ${escapeHtml(formatDateTimeBR(currentEvent.startsAt))}
              </div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Local</div>
              <div class="stat-value" style="font-size: 1rem;" id="detail-event-location">
                ${escapeHtml(currentEvent.location)}
              </div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Preço atual</div>
              <div class="stat-value" style="font-size: 1.1rem;" id="detail-event-price">
                ${escapeHtml(formatPriceBRL(currentEvent.priceCents))}
              </div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Lotação / Disponíveis</div>
              <div class="stat-value" style="font-size: 1.1rem;" id="detail-event-capacity">
                ${escapeHtml(currentEvent.capacity)} / ${escapeHtml(currentEvent.availableSeats)}
              </div>
            </div>
          </div>
        </div>

        <div id="event-dashboard-slot" data-event-id="${escapeHtml(currentEvent.id)}"></div>

        <div class="card" data-section="event-edit">
          <h2 style="margin-top: 0;">Editar evento</h2>
          ${
            isCancelled
              ? '<div class="alert info">Este evento está cancelado. Edição e republicação estão bloqueadas.</div>'
              : ''
          }
          <div id="edit-event-error" class="alert error" hidden></div>
          <div id="edit-event-success" class="alert success" hidden></div>

          <form id="edit-event-form" novalidate>
            <label for="edit-event-name">Nome do evento</label>
            <input
              id="edit-event-name"
              name="name"
              type="text"
              value="${escapeHtml(currentEvent.name)}"
              ${disabledAttr}
              required
            />

            <label for="edit-event-starts-at">Data e hora de início</label>
            <input
              id="edit-event-starts-at"
              name="startsAt"
              type="datetime-local"
              value="${escapeHtml(toDatetimeLocalValue(currentEvent.startsAt))}"
              ${disabledAttr}
              required
            />

            <label for="edit-event-location">Local</label>
            <input
              id="edit-event-location"
              name="location"
              type="text"
              value="${escapeHtml(currentEvent.location)}"
              ${disabledAttr}
              required
            />

            <label for="edit-event-capacity">Lotação máxima</label>
            <input
              id="edit-event-capacity"
              name="capacity"
              type="number"
              step="1"
              value="${escapeHtml(currentEvent.capacity)}"
              ${disabledAttr}
              required
            />

            <label for="edit-event-price">Preço do ingresso (R$)</label>
            <input
              id="edit-event-price"
              name="price"
              type="text"
              inputmode="decimal"
              value="${escapeHtml(formatPriceInputBRL(currentEvent.priceCents))}"
              ${disabledAttr}
              required
            />

            <button type="submit" id="edit-event-submit" ${disabledAttr}>Salvar alterações</button>
          </form>
        </div>

        <div id="event-checkin-slot" data-event-id="${escapeHtml(currentEvent.id)}"></div>
        <div id="event-cancel-slot" data-event-id="${escapeHtml(currentEvent.id)}"></div>
      </div>
    `;

    const publishBtn = container.querySelector('#publish-event-btn');
    const publishError = container.querySelector('#publish-error');

    publishBtn?.addEventListener('click', async () => {
      publishBtn.disabled = true;
      if (publishError) {
        publishError.hidden = true;
        publishError.textContent = '';
      }

      try {
        const res = await fetch(
          `/api/organizer/events/${encodeURIComponent(currentEvent.id)}/publish`,
          {
            method: 'POST',
            credentials: 'same-origin',
          },
        );

        if (res.status === 401) {
          renderOrganizerGuardBlockedView(container, null);
          return;
        }
        if (res.status === 403) {
          renderForbiddenEventView(container);
          return;
        }

        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (publishError) {
            publishError.textContent =
              body.error === 'event_cancelled'
                ? 'Evento cancelado não pode ser publicado.'
                : 'Não foi possível publicar o evento.';
            publishError.hidden = false;
          }
          publishBtn.disabled = false;
          return;
        }

        currentEvent = body;
        renderDetail('Evento publicado com sucesso! Agora ele está visível na vitrine e na API de parceiros.');
      } catch {
        if (publishError) {
          publishError.textContent = 'Erro de conexão ao tentar publicar o evento.';
          publishError.hidden = false;
        }
        publishBtn.disabled = false;
      }
    });

    const editForm = container.querySelector('#edit-event-form');
    const editError = container.querySelector('#edit-event-error');
    const editSuccess = container.querySelector('#edit-event-success');
    const editSubmit = container.querySelector('#edit-event-submit');

    editForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (isCancelled) return;

      if (editError) {
        editError.hidden = true;
        editError.textContent = '';
      }
      if (editSuccess) {
        editSuccess.hidden = true;
        editSuccess.textContent = '';
      }

      const formData = new FormData(editForm);
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

      if (editSubmit) editSubmit.disabled = true;

      try {
        const res = await fetch(`/api/organizer/events/${encodeURIComponent(currentEvent.id)}`, {
          method: 'PATCH',
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

        if (res.status === 401) {
          renderOrganizerGuardBlockedView(container, null);
          return;
        }
        if (res.status === 403) {
          renderForbiddenEventView(container);
          return;
        }

        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (editError) {
            if (res.status === 409 && body.error === 'capacity_below_occupied') {
              editError.textContent =
                'Não é possível definir a lotação abaixo do total de vagas já ocupadas.';
            } else if (res.status === 409 && body.error === 'event_cancelled') {
              editError.textContent = 'Este evento está cancelado e não pode ser editado.';
            } else {
              editError.textContent = describeValidationHint({
                name,
                location,
                startsAtIso,
                capacity,
                priceCents,
              });
            }
            editError.hidden = false;
          }
          return;
        }

        currentEvent = body;
        renderDetail();
        const updatedSuccess = container.querySelector('#edit-event-success');
        if (updatedSuccess) {
          updatedSuccess.textContent = 'Alterações salvas com sucesso!';
          updatedSuccess.hidden = false;
        }
      } catch {
        if (editError) {
          editError.textContent = 'Erro de conexão ao salvar alterações do evento.';
          editError.hidden = false;
        }
      } finally {
        if (editSubmit && container.contains(editSubmit)) {
          editSubmit.disabled = false;
        }
      }
    });

    const dashboardSlot = container.querySelector('#event-dashboard-slot');
    if (dashboardSlot) {
      activeDashboardWidget = renderDashboardWidget(dashboardSlot, {
        eventId: currentEvent.id,
        eventContainer: container,
        onUnauthorized: () => {
          activeDashboardWidget?.destroy?.();
          activeDashboardWidget = null;
          renderOrganizerGuardBlockedView(container, null);
        },
        onForbidden: () => {
          activeDashboardWidget?.destroy?.();
          activeDashboardWidget = null;
          renderForbiddenEventView(container);
        },
        onLoaded: (metrics) => {
          if (!container.isConnected) return;
          if (typeof metrics.availableSeats === 'number') {
            currentEvent = {
              ...currentEvent,
              status: metrics.status || currentEvent.status,
              availableSeats: metrics.availableSeats,
            };
            const capEl = container.querySelector('#detail-event-capacity');
            if (capEl) {
              capEl.textContent = `${currentEvent.capacity} / ${currentEvent.availableSeats}`;
            }
          }
        },
      });
    }

    const checkinSlot = container.querySelector('#event-checkin-slot');
    if (checkinSlot) {
      renderCheckinWidget(checkinSlot, {
        eventId: currentEvent.id,
        onUnauthorized: () => {
          renderOrganizerGuardBlockedView(container, null);
        },
        onForbidden: () => {
          renderForbiddenEventView(container);
        },
        onCheckinSuccess: async (checkinResult) => {
          try {
            const refreshRes = await fetch(
              `/api/organizer/events/${encodeURIComponent(currentEvent.id)}`,
              { credentials: 'same-origin' },
            );
            if (refreshRes.ok) {
              currentEvent = await refreshRes.json();
              if (!container.isConnected) return;

              const nameEl = container.querySelector('#detail-event-name');
              if (nameEl) nameEl.textContent = currentEvent.name;

              const statusEl = container.querySelector('#detail-event-status');
              if (statusEl) {
                statusEl.textContent = formatEventStatusLabel(currentEvent.status);
                statusEl.setAttribute('style', statusBadgeStyle(currentEvent.status));
              }

              const startsAtEl = container.querySelector('#detail-event-starts-at');
              if (startsAtEl) startsAtEl.textContent = formatDateTimeBR(currentEvent.startsAt);

              const locationEl = container.querySelector('#detail-event-location');
              if (locationEl) locationEl.textContent = currentEvent.location;

              const priceEl = container.querySelector('#detail-event-price');
              if (priceEl) priceEl.textContent = formatPriceBRL(currentEvent.priceCents);

              const capEl = container.querySelector('#detail-event-capacity');
              if (capEl) {
                capEl.textContent = `${currentEvent.capacity} / ${currentEvent.availableSeats}`;
              }
            }
          } catch {
            // Falha silenciosa na atualização complementar do resumo para preservar o feedback de R10
          }

          if (typeof CustomEvent === 'function') {
            container.dispatchEvent(
              new CustomEvent('catraca:checkin-success', { detail: checkinResult }),
            );
          }
        },
      });
    }

    const cancelSlot = container.querySelector('#event-cancel-slot');
    if (cancelSlot) {
      mountCancelWidget(cancelSlot, {
        event: currentEvent,
        onUnauthorized: () => {
          renderOrganizerGuardBlockedView(container, null);
        },
        onForbidden: () => {
          renderForbiddenEventView(container);
        },
        onCancelled: async () => {
          try {
            const refreshedRes = await fetch(
              `/api/organizer/events/${encodeURIComponent(currentEvent.id)}`,
              { credentials: 'same-origin' },
            );
            if (refreshedRes.ok) {
              currentEvent = await refreshedRes.json();
            } else {
              currentEvent = {
                ...currentEvent,
                status: 'cancelled',
                availableSeats: 0,
                cancelledAt: new Date().toISOString(),
              };
            }
          } catch {
            currentEvent = {
              ...currentEvent,
              status: 'cancelled',
              availableSeats: 0,
              cancelledAt: new Date().toISOString(),
            };
          }
          if (!container.isConnected) return;
          renderDetail(
            'Evento cancelado com sucesso. Vendas, edição e republicação foram bloqueadas e o processamento de estornos concluirá em até 10 segundos.',
          );
        },
      });
    }
  }

  renderDetail();
}
