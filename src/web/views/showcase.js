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

export function isValidShowcaseCardNumber(value) {
  return typeof value === 'string' && /^\d{16}$/.test(value);
}

function renderPurchaseSlotContent(ev, user) {
  const soldOut = Number(ev.availableSeats) <= 0;
  if (soldOut) {
    return `<div class="alert error" data-sold-out-notice style="margin: 0;">Ingressos esgotados</div>`;
  }

  if (!user) {
    return `<a href="/login" class="btn secondary" data-link>Entrar para comprar ingresso</a>`;
  }

  if (user.role !== 'participant') {
    return `<p style="margin: 0; font-size: 0.88rem; color: var(--muted);">Entre com uma conta de participante para comprar ingressos.</p>`;
  }

  return `
    <div data-purchase-feedback hidden></div>
    <form class="showcase-purchase-form" data-event-id="${escapeHtml(ev.id)}">
      <label for="card-number-${escapeHtml(ev.id)}">Cartão de crédito (16 dígitos)</label>
      <input
        id="card-number-${escapeHtml(ev.id)}"
        name="cardNumber"
        type="text"
        inputmode="numeric"
        maxlength="16"
        placeholder="4000000000000001"
        autocomplete="off"
        required
      />
      <button type="submit" data-purchase-submit="${escapeHtml(ev.id)}">Comprar ingresso</button>
    </form>
  `;
}

function markEventCardSoldOut(cardEl, slotEl, { preserveFeedback = false } = {}) {
  const badgeEl = cardEl?.querySelector('[data-availability]');
  if (badgeEl) {
    badgeEl.setAttribute('data-availability', 'sold-out');
    badgeEl.setAttribute('style', 'background: #fee2e2; color: #991b1b;');
    badgeEl.textContent = 'Ingressos esgotados';
  }
  if (!slotEl) return;
  slotEl.setAttribute('data-available-seats', '0');

  const formEl = slotEl.querySelector('form.showcase-purchase-form');
  if (formEl) {
    formEl.remove();
  }

  if (!preserveFeedback) {
    slotEl.innerHTML = `<div class="alert error" data-sold-out-notice style="margin: 0;">Ingressos esgotados</div>`;
  } else if (!slotEl.querySelector('[data-sold-out-notice]')) {
    const notice = document.createElement('div');
    notice.className = 'alert error';
    notice.setAttribute('data-sold-out-notice', '');
    notice.style.margin = '0.5rem 0 0';
    notice.textContent = 'Ingressos esgotados';
    slotEl.appendChild(notice);
  }
}

export async function renderShowcaseView(container, { user = null } = {}) {
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
                >${renderPurchaseSlotContent(ev, user)}</div>
              </article>
            `;
          })
          .join('')}
      </div>
    `;

    const forms = listEl.querySelectorAll('form.showcase-purchase-form');
    forms.forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const eventId = form.getAttribute('data-event-id') || '';
        const slotEl = form.closest('.event-purchase-slot');
        const cardEl = form.closest('[data-event-card]');
        const feedbackEl = slotEl?.querySelector('[data-purchase-feedback]');
        const submitBtn = form.querySelector('button[type="submit"]');
        const cardInput = form.querySelector('input[name="cardNumber"]');

        if (feedbackEl) {
          feedbackEl.hidden = true;
          feedbackEl.innerHTML = '';
        }

        const cardNumber = String(cardInput?.value || '').trim();
        if (!isValidShowcaseCardNumber(cardNumber)) {
          if (feedbackEl) {
            feedbackEl.innerHTML =
              '<div class="alert error">Informe um número de cartão válido com exatamente 16 dígitos numéricos.</div>';
            feedbackEl.hidden = false;
          }
          return;
        }

        if (submitBtn) submitBtn.disabled = true;

        try {
          const purchaseRes = await fetch(`/api/events/${encodeURIComponent(eventId)}/purchases`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ cardNumber }),
          });

          const body = await purchaseRes.json().catch(() => ({}));

          if (purchaseRes.status === 202) {
            if (cardInput) cardInput.value = '';
            if (feedbackEl) {
              feedbackEl.innerHTML = `
                <div class="alert success" data-purchase-success>
                  Ingresso reservado! Status: <strong>pendente</strong> — Código: <strong>${escapeHtml(body.code)}</strong>.
                  <a href="/my-tickets" data-link style="margin-left: 0.35rem; font-weight: 700;">Ver em Meus ingressos</a>
                </div>
              `;
              feedbackEl.hidden = false;
            }

            const prevSeats = Number(slotEl?.getAttribute('data-available-seats') || '1');
            const nextSeats = Math.max(0, prevSeats - 1);
            if (nextSeats <= 0) {
              markEventCardSoldOut(cardEl, slotEl, { preserveFeedback: true });
            } else {
              slotEl?.setAttribute('data-available-seats', String(nextSeats));
              const badgeEl = cardEl?.querySelector('[data-availability]');
              if (badgeEl) {
                badgeEl.textContent = `Vagas disponíveis: ${nextSeats}`;
              }
            }
            return;
          }

          if (purchaseRes.status === 409 && body.error === 'sold_out') {
            markEventCardSoldOut(cardEl, slotEl, { preserveFeedback: false });
            return;
          }

          if (purchaseRes.status === 404 && body.error === 'event_not_available') {
            form.remove();
            if (feedbackEl) {
              feedbackEl.innerHTML =
                '<div class="alert error">Este evento não está mais disponível para compra.</div>';
              feedbackEl.hidden = false;
            }
            return;
          }

          if (feedbackEl) {
            const msg =
              purchaseRes.status === 422
                ? 'Informe um número de cartão válido com exatamente 16 dígitos numéricos.'
                : 'Não foi possível concluir a compra. Tente novamente.';
            feedbackEl.innerHTML = `<div class="alert error">${escapeHtml(msg)}</div>`;
            feedbackEl.hidden = false;
          }
        } catch {
          if (feedbackEl) {
            feedbackEl.innerHTML =
              '<div class="alert error">Erro de conexão ao realizar a compra.</div>';
            feedbackEl.hidden = false;
          }
        } finally {
          if (submitBtn && submitBtn.isConnected) {
            submitBtn.disabled = false;
          }
        }
      });
    });
  } catch {
    if (listEl && container.isConnected) {
      listEl.innerHTML =
        '<div class="alert error">Erro de conexão ao carregar a vitrine de eventos.</div>';
    }
  }
}
