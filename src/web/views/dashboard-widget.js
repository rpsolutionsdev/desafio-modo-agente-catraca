import { escapeHtml } from './auth.js';
import { formatPriceBRL } from './showcase.js';

export function renderDashboardWidget(
  slotContainer,
  {
    eventId,
    eventContainer = null,
    onUnauthorized,
    onForbidden,
    onLoaded,
    apiBaseUrl = '',
    autoSettleRefresh = typeof window !== 'undefined',
  } = {},
) {
  if (!slotContainer || !eventId) {
    return {
      ready: Promise.resolve(null),
      refresh: () => Promise.resolve(null),
      destroy: () => {},
    };
  }

  slotContainer.innerHTML = `
    <div class="card" data-section="event-dashboard" data-event-id="${escapeHtml(eventId)}">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.75rem;">
        <h2 style="margin: 0;">Painel do evento</h2>
        <button type="button" id="dashboard-refresh-btn" class="secondary">Atualizar painel</button>
      </div>

      <div id="dashboard-error" class="alert error" hidden></div>

      <div class="stats-grid" data-dashboard-metrics>
        <div class="stat-box">
          <div class="stat-label">Confirmados</div>
          <div class="stat-value" id="dashboard-confirmed">—</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Pendentes</div>
          <div class="stat-value" id="dashboard-pending">—</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Check-ins</div>
          <div class="stat-value" id="dashboard-checkins">—</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Vagas disponíveis</div>
          <div class="stat-value" id="dashboard-available-seats">—</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Receita</div>
          <div class="stat-value" id="dashboard-revenue">—</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Estornados</div>
          <div class="stat-value" id="dashboard-refunded">—</div>
        </div>
      </div>
    </div>
  `;

  const refreshBtn = slotContainer.querySelector('#dashboard-refresh-btn');
  const errorBox = slotContainer.querySelector('#dashboard-error');
  const confirmedEl = slotContainer.querySelector('#dashboard-confirmed');
  const pendingEl = slotContainer.querySelector('#dashboard-pending');
  const checkinsEl = slotContainer.querySelector('#dashboard-checkins');
  const availableSeatsEl = slotContainer.querySelector('#dashboard-available-seats');
  const revenueEl = slotContainer.querySelector('#dashboard-revenue');
  const refundedEl = slotContainer.querySelector('#dashboard-refunded');

  let destroyed = false;
  let latestRequestId = 0;
  let settleTimer = null;
  let settleRetries = 0;

  function clearSettleTimer() {
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  }

  async function loadDashboard() {
    if (destroyed || slotContainer.isConnected === false) {
      return null;
    }

    clearSettleTimer();
    const requestId = ++latestRequestId;

    if (refreshBtn) {
      refreshBtn.disabled = true;
    }

    try {
      const res = await fetch(
        `${apiBaseUrl}/api/organizer/events/${encodeURIComponent(eventId)}/dashboard`,
        {
          method: 'GET',
          credentials: 'same-origin',
        },
      );

      if (destroyed || slotContainer.isConnected === false || requestId !== latestRequestId) {
        return null;
      }

      if (res.status === 401) {
        if (typeof onUnauthorized === 'function') {
          onUnauthorized();
        }
        return null;
      }

      if (res.status === 403) {
        if (typeof onForbidden === 'function') {
          onForbidden();
        }
        return null;
      }

      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        if (errorBox) {
          errorBox.textContent = 'Não foi possível carregar os indicadores do painel.';
          errorBox.hidden = false;
        }
        return null;
      }

      if (errorBox) {
        errorBox.hidden = true;
        errorBox.textContent = '';
      }

      if (confirmedEl) confirmedEl.textContent = String(body.confirmed ?? 0);
      if (pendingEl) pendingEl.textContent = String(body.pending ?? 0);
      if (checkinsEl) checkinsEl.textContent = String(body.checkIns ?? 0);
      if (availableSeatsEl) availableSeatsEl.textContent = String(body.availableSeats ?? 0);
      if (revenueEl) {
        revenueEl.textContent =
          typeof body.revenueFormatted === 'string' && body.revenueFormatted.length > 0
            ? body.revenueFormatted
            : formatPriceBRL(body.revenueCents ?? 0);
      }
      if (refundedEl) refundedEl.textContent = String(body.refunded ?? 0);

      if (typeof onLoaded === 'function') {
        onLoaded(body);
      }

      // Quando o evento acabou de ser cancelado e o estorno assíncrono (< 10s) ainda está em andamento,
      // reconsulta automaticamente na interface até os confirmados/pendentes zerarem.
      if (
        autoSettleRefresh &&
        !destroyed &&
        body.status === 'cancelled' &&
        (Number(body.confirmed) > 0 || Number(body.pending) > 0) &&
        settleRetries < 12
      ) {
        settleRetries += 1;
        settleTimer = setTimeout(() => {
          settleTimer = null;
          void loadDashboard();
        }, 450);
        if (typeof settleTimer?.unref === 'function') {
          settleTimer.unref();
        }
      } else {
        settleRetries = 0;
      }

      return body;
    } catch {
      if (!destroyed && slotContainer.isConnected !== false && requestId === latestRequestId) {
        if (errorBox) {
          errorBox.textContent = 'Erro de conexão ao carregar o painel do evento.';
          errorBox.hidden = false;
        }
      }
      return null;
    } finally {
      if (
        !destroyed &&
        refreshBtn &&
        (!slotContainer.contains || slotContainer.contains(refreshBtn)) &&
        requestId === latestRequestId
      ) {
        refreshBtn.disabled = false;
      }
    }
  }

  refreshBtn?.addEventListener('click', () => {
    void loadDashboard();
  });

  const handleCheckinSuccess = () => {
    void loadDashboard();
  };

  if (eventContainer && typeof eventContainer.addEventListener === 'function') {
    eventContainer.addEventListener('catraca:checkin-success', handleCheckinSuccess);
  }

  function destroy() {
    destroyed = true;
    clearSettleTimer();
    if (eventContainer && typeof eventContainer.removeEventListener === 'function') {
      eventContainer.removeEventListener('catraca:checkin-success', handleCheckinSuccess);
    }
  }

  const ready = loadDashboard();

  return {
    ready,
    refresh: loadDashboard,
    destroy,
  };
}

export const mountDashboardWidget = renderDashboardWidget;
