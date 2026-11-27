# Spec — F01: Autenticação, Contas e Controle de Acesso

## 1. Escopo e Decisões Técnicas
- **Perfis suportados (`users.role`)**: `organizer` (provisionado exclusivamente pela seed) e `participant` (provisionado pela seed ou auto-cadastrado na web).
- **Hash de senha**: `scrypt` nativo do Node.js (`node:crypto`) com salt aleatório por usuário, evitando dependências nativas compiladas fora do Node LTS.
- **Sessão HTTP**: Token assinado via HMAC-SHA256 (`AUTH_SECRET`) gravado no cookie `catraca_session` (`HttpOnly`, `Path=/`, `SameSite=Lax`) e também aceito via header `Authorization: Bearer <token>` para facilitar testes automatizados.
- **Autenticação de Parceiro**: Middleware `requirePartnerApiKey` compara em tempo constante o cabeçalho `X-Api-Key` com `PARTNER_API_KEY` (padrão `catraca-partner-secret-key`). Na ausência ou divergência, retorna imediatamente `401` com JSON exato `{"error":"unauthorized"}`.

## 2. Modelo de Dados (`users`)
- `id` (`TEXT PRIMARY KEY`, formato `usr_<hex>`)
- `name` (`TEXT NOT NULL`)
- `email` (`TEXT NOT NULL UNIQUE`, normalizado em lowercase/trim)
- `password_hash` (`TEXT NOT NULL`)
- `role` (`TEXT NOT NULL CHECK (role IN ('organizer', 'participant'))`)
- `created_at` (`TIMESTAMPTZ NOT NULL DEFAULT NOW()`)

## 3. Endpoints HTTP
- `POST /api/auth/register`: recebe `{ name, email, password }`. Valida campos obrigatórios, formato de e-mail e senha mínima (6 caracteres). Cria sempre `role = 'participant'` (`201` + cookie de sessão). E-mail duplicado responde `409 {"error":"email_in_use"}`; dados inválidos respondem `422 {"error":"invalid_request"}`.
- `POST /api/auth/login`: recebe `{ email, password }`. Valida credenciais e retorna `200 { user: { id, name, email, role }, token }` + cookie `catraca_session`, ou `401 {"error":"invalid_credentials"}`.
- `POST /api/auth/logout`: limpa cookie `catraca_session` e responde `200 {"ok":true}`.
- `GET /api/auth/me`: retorna `200 { user }` quando autenticado ou `401 {"error":"unauthenticated"}`.

## 4. Guardas de Acesso (R13)
- `requireOrganizer`: exige sessão válida com `role === 'organizer'`. Visitante recebe `401 {"error":"unauthenticated"}`; participante recebe `403 {"error":"forbidden"}`.
- No frontend (`/organizer` e `/organizer/events/:id`), visitantes e participantes nunca renderizam conteúdo da área de organizador, exibindo bloqueio de acesso / redirecionamento para login.
