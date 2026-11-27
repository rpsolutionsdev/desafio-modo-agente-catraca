import {
  escapeHtml,
  renderLoginView,
  renderOrganizerGuardBlockedView,
  renderRegisterView,
} from './views/auth.js';
import { renderShowcaseView } from './views/showcase.js';
import { renderMyTicketsView } from './views/my-tickets.js';
import { renderOrganizerListView } from './views/organizer-list.js';
import { renderOrganizerEventView } from './views/organizer-event.js';

const root = document.getElementById('app-root');
const header = document.getElementById('app-header');

const state = {
  user: null,
  ready: false,
};

async function fetchCurrentUser() {
  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (res.ok) {
      const data = await res.json();
      state.user = data.user || null;
    } else {
      state.user = null;
    }
  } catch {
    state.user = null;
  } finally {
    state.ready = true;
  }
}

export function navigate(path, { replace = false } = {}) {
  if (replace) {
    window.history.replaceState({}, '', path);
  } else if (window.location.pathname !== path) {
    window.history.pushState({}, '', path);
  }
  renderHeader();
  renderRoute();
}

function renderHeader() {
  if (!header) return;

  const user = state.user;
  let navItems = `<a href="/" class="btn secondary" data-link>Vitrine</a>`;

  if (!user) {
    navItems += `
      <a href="/login" class="btn secondary" data-link>Entrar</a>
      <a href="/register" class="btn" data-link>Criar conta</a>
    `;
  } else if (user.role === 'participant') {
    navItems += `
      <a href="/my-tickets" class="btn secondary" data-link>Meus ingressos</a>
      <span class="badge" id="session-user">${escapeHtml(user.name)}</span>
      <button type="button" id="logout-btn" class="secondary">Sair</button>
    `;
  } else if (user.role === 'organizer') {
    navItems += `
      <a href="/organizer" class="btn secondary" data-link>Meus eventos</a>
      <span class="badge" id="session-user">${escapeHtml(user.name)}</span>
      <button type="button" id="logout-btn" class="secondary">Sair</button>
    `;
  }

  header.innerHTML = `
    <a href="/" data-link style="color: var(--text); text-decoration: none; font-size: 1.15rem;">
      <strong>Catraca</strong>
    </a>
    <nav class="nav-links">${navItems}</nav>
  `;

  const logoutBtn = header.querySelector('#logout-btn');
  logoutBtn?.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } finally {
      state.user = null;
      navigate('/login');
    }
  });
}

function renderNotFound(container) {
  container.innerHTML = `
    <div class="card" data-view="not-found">
      <h1>Página não encontrada</h1>
      <p style="color: var(--muted);">O endereço solicitado não existe.</p>
      <a href="/" class="btn secondary" data-link>Voltar para a vitrine</a>
    </div>
  `;
}

function renderRoute() {
  if (!root) return;
  if (!state.ready) {
    root.innerHTML = '<div class="card"><p>Carregando...</p></div>';
    return;
  }

  const rawPath = window.location.pathname || '/';
  const path = rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;

  // Guarda estrita R13: visitantes e participantes jamais acessam /organizer*
  if (path === '/organizer' || path.startsWith('/organizer/')) {
    if (!state.user || state.user.role !== 'organizer') {
      renderOrganizerGuardBlockedView(root, state.user);
      return;
    }

    if (path === '/organizer') {
      void renderOrganizerListView(root, { user: state.user });
      return;
    }

    const eventMatch = path.match(/^\/organizer\/events\/([^/]+)$/);
    if (eventMatch) {
      void renderOrganizerEventView(root, {
        eventId: decodeURIComponent(eventMatch[1]),
        user: state.user,
      });
      return;
    }

    renderNotFound(root);
    return;
  }

  if (path === '/') {
    void renderShowcaseView(root, { user: state.user });
    return;
  }

  if (path === '/login') {
    renderLoginView(root, {
      onSuccess: (user) => {
        state.user = user;
        navigate(user.role === 'organizer' ? '/organizer' : '/');
      },
    });
    return;
  }

  if (path === '/register') {
    renderRegisterView(root, {
      onSuccess: (user) => {
        state.user = user;
        navigate('/');
      },
    });
    return;
  }

  if (path === '/my-tickets') {
    void renderMyTicketsView(root, { user: state.user });
    return;
  }

  renderNotFound(root);
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const target = event.target instanceof Element ? event.target.closest('a[data-link]') : null;
  if (!target) return;

  const href = target.getAttribute('href');
  if (!href || !href.startsWith('/')) return;

  event.preventDefault();
  navigate(href);
});

window.addEventListener('popstate', () => {
  renderHeader();
  renderRoute();
});

async function bootstrap() {
  if (root) {
    root.innerHTML = '<div class="card"><p>Carregando...</p></div>';
  }
  await fetchCurrentUser();
  renderHeader();
  renderRoute();
}

void bootstrap();
