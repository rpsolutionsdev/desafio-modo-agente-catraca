import { escapeHtml } from './auth.js';

export function renderCheckinWidget(
  slotContainer,
  { eventId, onCheckinSuccess, onUnauthorized, onForbidden, apiBaseUrl = '' } = {},
) {
  if (!slotContainer || !eventId) return;

  slotContainer.innerHTML = `
    <div class="card" data-section="event-checkin" data-event-id="${escapeHtml(eventId)}">
      <h2 style="margin-top: 0;">Check-in de ingressos</h2>
      <p style="color: var(--muted); margin-top: 0;">
        Informe o código do ingresso para validar e registrar a entrada do participante.
      </p>

      <div
        id="checkin-feedback"
        data-checkin-feedback
        role="status"
        aria-live="polite"
        class="alert"
        hidden
      ></div>

      <form id="checkin-form" novalidate>
        <label for="checkin-code-input">Código do ingresso</label>
        <input
          id="checkin-code-input"
          name="code"
          type="text"
          autocomplete="off"
          placeholder="Ex.: K7Q2M9XA"
        />

        <button type="submit" id="checkin-submit-btn">Realizar check-in</button>
      </form>
    </div>
  `;

  const form = slotContainer.querySelector('#checkin-form');
  const codeInput = slotContainer.querySelector('#checkin-code-input');
  const submitBtn = slotContainer.querySelector('#checkin-submit-btn');
  const feedbackBox = slotContainer.querySelector('#checkin-feedback');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const code = codeInput ? String(codeInput.value ?? '').trim() : '';

    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch(
        `${apiBaseUrl}/api/organizer/events/${encodeURIComponent(eventId)}/checkin`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ code }),
        },
      );

      if (res.status === 401) {
        if (typeof onUnauthorized === 'function') {
          onUnauthorized();
        }
        return;
      }

      if (res.status === 403) {
        if (typeof onForbidden === 'function') {
          onForbidden();
        }
        return;
      }

      const body = await res.json().catch(() => ({}));
      const isAllowed = res.ok && body.allowed === true;
      const message =
        typeof body.message === 'string' && body.message.length > 0
          ? body.message
          : 'Não foi possível processar o check-in.';

      if (feedbackBox) {
        feedbackBox.textContent = message;
        feedbackBox.className = isAllowed ? 'alert success' : 'alert error';
        feedbackBox.dataset.checkinCode = String(body.code || '');
        feedbackBox.dataset.checkinAllowed = String(isAllowed);
        feedbackBox.hidden = false;
      }

      if (isAllowed) {
        if (codeInput) {
          codeInput.value = '';
        }
        if (typeof onCheckinSuccess === 'function') {
          await onCheckinSuccess(body);
        }
      }
    } catch {
      if (feedbackBox) {
        feedbackBox.textContent = 'Erro de conexão ao realizar check-in.';
        feedbackBox.className = 'alert error';
        feedbackBox.dataset.checkinCode = 'network_error';
        feedbackBox.dataset.checkinAllowed = 'false';
        feedbackBox.hidden = false;
      }
    } finally {
      if (submitBtn && slotContainer.contains(submitBtn)) {
        submitBtn.disabled = false;
      }
    }
  });
}
