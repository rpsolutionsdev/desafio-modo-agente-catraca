export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderLoginView(container, { onSuccess }) {
  container.innerHTML = `
    <div class="card" style="max-width: 460px; margin: 2rem auto;" data-view="login">
      <h1>Entrar</h1>
      <p style="color: var(--muted); margin-top: 0;">Acesse sua conta na Catraca.</p>
      <div id="login-error" class="alert error" hidden></div>
      <form id="login-form">
        <label for="login-email">E-mail</label>
        <input id="login-email" name="email" type="email" autocomplete="email" required />

        <label for="login-password">Senha</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" required />

        <button type="submit" id="login-submit">Entrar</button>
      </form>
      <p style="margin-top: 1rem; margin-bottom: 0; font-size: 0.9rem;">
        Ainda não tem conta? <a href="/register" data-link>Criar conta de participante</a>
      </p>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const errorBox = container.querySelector('#login-error');
  const submitBtn = container.querySelector('#login-submit');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = '';
    }

    const formData = new FormData(form);
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');

    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (errorBox) {
          errorBox.textContent =
            res.status === 401
              ? 'E-mail ou senha inválidos.'
              : 'Não foi possível entrar. Verifique os dados informados.';
          errorBox.hidden = false;
        }
        return;
      }

      if (typeof onSuccess === 'function') {
        onSuccess(body.user);
      }
    } catch {
      if (errorBox) {
        errorBox.textContent = 'Erro de conexão ao tentar entrar.';
        errorBox.hidden = false;
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

export function renderRegisterView(container, { onSuccess }) {
  container.innerHTML = `
    <div class="card" style="max-width: 460px; margin: 2rem auto;" data-view="register">
      <h1>Criar conta</h1>
      <p style="color: var(--muted); margin-top: 0;">
        Cadastre-se como participante para comprar e acompanhar seus ingressos.
      </p>
      <div id="register-error" class="alert error" hidden></div>
      <form id="register-form">
        <label for="register-name">Nome completo</label>
        <input id="register-name" name="name" type="text" autocomplete="name" required />

        <label for="register-email">E-mail</label>
        <input id="register-email" name="email" type="email" autocomplete="email" required />

        <label for="register-password">Senha (mínimo 6 caracteres)</label>
        <input
          id="register-password"
          name="password"
          type="password"
          minlength="6"
          autocomplete="new-password"
          required
        />

        <button type="submit" id="register-submit">Criar conta</button>
      </form>
      <p style="margin-top: 1rem; margin-bottom: 0; font-size: 0.9rem;">
        Já possui conta? <a href="/login" data-link>Entrar</a>
      </p>
    </div>
  `;

  const form = container.querySelector('#register-form');
  const errorBox = container.querySelector('#register-error');
  const submitBtn = container.querySelector('#register-submit');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = '';
    }

    const formData = new FormData(form);
    const name = String(formData.get('name') || '').trim();
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');

    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name, email, password }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (errorBox) {
          if (res.status === 409 && body.error === 'email_in_use') {
            errorBox.textContent = 'Este e-mail já está em uso.';
          } else {
            errorBox.textContent =
              'Dados inválidos. Informe nome, e-mail válido e senha com no mínimo 6 caracteres.';
          }
          errorBox.hidden = false;
        }
        return;
      }

      if (typeof onSuccess === 'function') {
        onSuccess(body.user);
      }
    } catch {
      if (errorBox) {
        errorBox.textContent = 'Erro de conexão ao criar conta.';
        errorBox.hidden = false;
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

export function renderOrganizerGuardBlockedView(container, user) {
  if (!user) {
    container.innerHTML = `
      <div class="card" data-view="access-denied" data-reason="unauthenticated">
        <h1>Acesso restrito</h1>
        <div class="alert error">Autenticação necessária. Entre na sua conta para continuar.</div>
        <a href="/login" class="btn" data-link>Ir para login</a>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="card" data-view="access-denied" data-reason="forbidden">
      <h1>Acesso negado</h1>
      <div class="alert error">Você não tem permissão para acessar esta página.</div>
      <a href="/" class="btn secondary" data-link>Voltar para a vitrine</a>
    </div>
  `;
}
