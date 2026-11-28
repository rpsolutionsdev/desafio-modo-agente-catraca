import { escapeHtml } from './auth.js';

export function mountCancelWidget(
  slotContainer,
  { event, onCancelled, onUnauthorized, onForbidden } = {},
) {
  if (!slotContainer || !event) return;

  if (event.status === 'cancelled') {
    slotContainer.innerHTML = `
      <div class="card" data-section="event-cancel" data-cancel-state="cancelled">
        <h2 style="margin-top: 0;">Cancelamento do evento</h2>
        <div class="alert error" id="cancel-event-status-banner" style="margin-bottom: 0;">
          Evento <strong>${escapeHtml(event.name)}</strong> cancelado de forma irreversível. O evento foi retirado da vitrine e da API de parceiros, possui 0 vagas disponíveis e está com edição e republicação bloqueadas. Todos os ingressos confirmados são estornados e os pendentes são cancelados em até 10 segundos.
        </div>
      </div>
    `;
    return;
  }

  if (event.status !== 'published') {
    slotContainer.innerHTML = '';
    return;
  }

  slotContainer.innerHTML = `
    <div class="card" data-section="event-cancel" data-cancel-state="published">
      <h2 style="margin-top: 0;">Cancelar evento</h2>
      <p style="color: var(--muted); margin-top: 0;">
        Atenção: o cancelamento é irreversível. O evento sairá imediatamente da vitrine pública e da API de parceiros, terá vagas disponíveis zeradas, ficará com edição e republicação bloqueadas e, em até 10 segundos, estornará todos os ingressos confirmados e cancelará os pendentes.
      </p>
      <div id="cancel-event-error" class="alert error" hidden></div>
      <button type="button" id="cancel-event-btn" class="danger">
        Cancelar evento
      </button>
    </div>
  `;

  const cancelBtn = slotContainer.querySelector('#cancel-event-btn');
  const errorBox = slotContainer.querySelector('#cancel-event-error');

  cancelBtn?.addEventListener('click', async () => {
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Cancelando...';
    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = '';
    }

    try {
      const res = await fetch(`/api/organizer/events/${encodeURIComponent(event.id)}/cancel`, {
        method: 'POST',
        credentials: 'same-origin',
      });

      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }

      if (res.status === 403) {
        onForbidden?.();
        return;
      }

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (errorBox) {
          errorBox.textContent =
            body.error === 'cannot_cancel_event'
              ? 'Apenas eventos publicados podem ser cancelados.'
              : 'Não foi possível cancelar o evento.';
          errorBox.hidden = false;
        }
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Cancelar evento';
        return;
      }

      await onCancelled?.(body);
    } catch {
      if (errorBox) {
        errorBox.textContent = 'Erro de conexão ao tentar cancelar o evento.';
        errorBox.hidden = false;
      }
      if (slotContainer.contains(cancelBtn)) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Cancelar evento';
      }
    }
  });
}
