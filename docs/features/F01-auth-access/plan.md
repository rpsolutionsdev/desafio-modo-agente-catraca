# Plano — F01: Autenticação, Contas e Controle de Acesso

## Etapas de Implementação
1. **Criptografia e Sessão (`src/modules/auth/crypto.ts` e `session.ts`)**
   - Implementar hash/verificação de senha com `crypto.scryptSync` e geração/validação de token HMAC assinado.
2. **Middlewares de Segurança (`src/modules/auth/middleware.ts`)**
   - Implementar `attachUser`, `requireAuth`, `requireParticipant`, `requireOrganizer` e `requirePartnerApiKey` (`401 {"error":"unauthorized"}`).
3. **Rotas de Autenticação (`src/modules/auth/routes.ts`)**
   - Implementar `POST /api/auth/register` (restrito a `participant`), `POST /api/auth/login`, `POST /api/auth/logout` e `GET /api/auth/me`.
   - Expor guarda base em `/api/organizer/*` e `/api/partner/*`.
4. **Interface Web de Conta e Navegação (`src/web/views/auth.js` e `src/web/app.js`)**
   - Criar telas `/login` e `/register`, botão de logout no topo e guarda de rota impedindo visitantes e participantes de acessarem `/organizer*` (**R13**).
5. **Testes Automatizados (`tests/f01-auth-access.test.ts`)**
   - Cobrir cadastro de participante, login/logout das contas da seed, bloqueio de auto-cadastro de organizador, isolamento da área de organizador para visitante/participante e validação `401 unauthorized` em `/api/partner/*`.
