# Relatório de Avaliação Independente — F01 (`eval-01`)

- **Feature**: `F01` — Autenticação, Contas e Controle de Acesso (`F01-auth-access`)
- **Data da avaliação**: `2026-11-27T18:25:00-03:00`
- **Branch avaliada**: `feat/f01-auth-access`
- **Commit avaliado**: `e6814f76019454b87e01f4d690a27adbcab69241` (`e6814f7`)
- **Ferramenta e Modelo**: `Google Antigravity (Subagente feature-evaluator de contexto isolado) — Gemini 4 Carbon (High)`
- **Veredito Final**: **APROVADO**

---

## 1. Resumo Executivo e Tabela de Verificação do Contrato

O ambiente completo em containers Docker (`catraca-db-1` + `catraca-app-1`) foi inicializado com `npm run up`, exercitado empiricamente via requisições HTTP reais contra `http://localhost:3000`, inspeção direta da persistência no PostgreSQL, verificação dos módulos e views da SPA (`/register`, `/login`, `/organizer`) e execução de `npm run gates` em paralelo com o ambiente ativo, seguido de `npm run down`.

| Item do Contrato | Critérios PRD / Regras | Descrição Resumida | Veredito |
| :--- | :--- | :--- | :--- |
| **CT-F01-01** | `CA-F01-01` | Cadastro de participante inédito (`201`, `role: "participant"`), sessão ativa em `/api/auth/me` (`200`), encerramento em `/api/auth/logout` (`200`) e invalidação subsequente (`401`), com suporte na UI (`/register`, `/login`, botão `Sair`). | **APROVADO** |
| **CT-F01-02** | `CA-F01-02` | Login das 3 contas da seed (`200` com papéis corretos), ausência de opção de cadastro de organizador na UI `/register`, bloqueio de escalação via `"role":"organizer"` no payload (cria sempre `"participant"`) e reexecução idempotente da seed. | **APROVADO** |
| **CT-F01-03** | `CA-F01-03`, `R13`, `CF-01` (parcial) | Isolamento estrito da área de organizador: visitante deslogado recebe `401` e participante autenticado recebe `403` em `/api/organizer/*`; na SPA `/organizer*`, nenhum dado interno de organizador é exibido para visitantes ou participantes. | **APROVADO** |
| **CT-F01-04** | `CA-F01-04`, `CF-01` (parcial) | Proteção de `/api/partner/*` via `X-Api-Key`: chamadas sem cabeçalho ou com chave inválida respondem `401` com JSON exato `{"error":"unauthorized"}`. | **APROVADO** |

---

## 2. Mapeamento PRD -> Contrato

| Critério no PRD | Regra de Negócio | Itens Avaliados | Resultado |
| :--- | :--- | :--- | :--- |
| `CA-F01-01` | — | `CT-F01-01` | **APROVADO** |
| `CA-F01-02` | — | `CT-F01-02` | **APROVADO** |
| `CA-F01-03` | `R13` | `CT-F01-03` | **APROVADO** |
| `CA-F01-04` | — | `CT-F01-04` | **APROVADO** |
| `CF-01` (`F01 -> F02`, parcial de guarda) | `R13` | `CT-F01-03`, `CT-F01-04` | **APROVADO** |

---

## 3. Evidências Empíricas por Item do Contrato

### 3.1. Pré-requisito: Subida do Ambiente Real (`npm run up`)

Comando executado:
```bash
npm run up
```

Saída observada:
```text
[catraca:up] Compilando aplicação TypeScript...
[catraca:up] Subindo containers (PostgreSQL + App + Migrations + Seed)...
 Container catraca-db-1  Healthy
 Container catraca-app-1  Healthy
[catraca:up] Produto pronto em http://localhost:3000
[catraca:up] API de Parceiros pronta em http://localhost:3000
```

Healthcheck HTTP:
```text
GET http://localhost:3000/api/health -> HTTP 200
Body: {"status":"ok"}
```

---

### 3.2. `CT-F01-01` — Cadastro de Participante, Sessão (`/api/auth/me`) e Logout

- **Veredito**: **APROVADO**
- **Ações executadas contra `http://localhost:3000`**:
  1. `POST /api/auth/register` com `{ "name": "Mariana Avaliacao", "email": "eval_part_1795814530007@catraca.local", "password": "<REDACTED>" }`
  2. `GET /api/auth/me` enviando o cookie `catraca_session` recebido no cadastro
  3. `POST /api/auth/logout` enviando o cookie da sessão ativa
  4. `GET /api/auth/me` com o cookie limpo retornado pelo logout e também sem cabeçalho `Cookie`
  5. `POST /api/auth/login` com a conta recém-cadastrada e teste de conflito `409` ao repetir o mesmo e-mail
  6. Inspeção da view `/register` (`renderRegisterView` em `/views/auth.js`) e do cabeçalho de sessão (`#logout-btn` em `/app.js`)

- **Evidências HTTP e UI**:
```text
POST /api/auth/register -> HTTP 201
Set-Cookie: catraca_session=eyJzdWIiOiJ1c3JfMDBmZmZmM2E4OTVhIiwicm9sZSI6InBhcnRpY2lwYW50IiwiaWF0IjoxNzk1ODE0NTMwLCJleHAiOjE3OTY0MTkzMzB9.8GMu4BZA3asQkwoe_Iza23mlw5WEiYqj3AjtW2RjoRk; Max-Age=604800; Path=/; Expires=Fri, 04 Dec 2026 21:22:10 GMT; HttpOnly; SameSite=Lax
Body: {"user":{"id":"usr_00ffff3a895a","name":"Mariana Avaliacao","email":"eval_part_1795814530007@catraca.local","role":"participant"},"token":"..."}

GET /api/auth/me (com cookie catraca_session) -> HTTP 200
Body: {"user":{"id":"usr_00ffff3a895a","name":"Mariana Avaliacao","email":"eval_part_1795814530007@catraca.local","role":"participant"}}

POST /api/auth/logout -> HTTP 200
Set-Cookie: catraca_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax
Body: {"ok":true}

GET /api/auth/me (após logout com cookie limpo) -> HTTP 401
Body: {"error":"unauthenticated"}

GET /api/auth/me (deslogado sem cookie) -> HTTP 401
Body: {"error":"unauthenticated"}

POST /api/auth/login (participante recém-criado) -> HTTP 200
Body: {"user":{"id":"usr_00ffff3a895a","name":"Mariana Avaliacao","email":"eval_part_1795814530007@catraca.local","role":"participant"},"token":"..."}

POST /api/auth/register (mesmo e-mail) -> HTTP 409
Body: {"error":"email_in_use"}
```
- Na interface web, `GET /register` entrega o shell SPA (`HTTP 200`) e `renderRegisterView` renderiza `#register-form` com campos `name`, `email` e `password` (`minlength="6"`), autenticando a sessão e exibindo o botão `Sair` (`#logout-btn`) no cabeçalho, que aciona `POST /api/auth/logout` e redireciona para `/login`.

---

### 3.3. `CT-F01-02` — Login das Contas da Seed, Bloqueio de Auto-cadastro de Organizador e Idempotência da Seed

- **Veredito**: **APROVADO**
- **Ações executadas**:
  1. `POST /api/auth/login` com `org.a@catraca.local`, `org.b@catraca.local` e `participante@catraca.local` (credenciais documentadas no `README.md`).
  2. Tentativa de escalação de privilégio via `POST /api/auth/register` enviando `"role": "organizer"` no payload JSON.
  3. Verificação do DOM gerado por `renderRegisterView` para `/register`.
  4. Reexecução dupla de `node dist/db/seed.js` dentro do container `catraca-app-1` e inspeção direta da tabela `users` no PostgreSQL (`catraca-db-1`).

- **Evidências HTTP, UI e Banco de Dados**:
```text
POST /api/auth/login (org.a@catraca.local) -> HTTP 200
Body: {"user":{"id":"usr_seed_org_a","name":"Organizador A","email":"org.a@catraca.local","role":"organizer"},"token":"..."}

POST /api/auth/login (org.b@catraca.local) -> HTTP 200
Body: {"user":{"id":"usr_seed_org_b","name":"Organizador B","email":"org.b@catraca.local","role":"organizer"},"token":"..."}

POST /api/auth/login (participante@catraca.local) -> HTTP 200
Body: {"user":{"id":"usr_seed_participant","name":"Participante Seed","email":"participante@catraca.local","role":"participant"},"token":"..."}

POST /api/auth/register (com {"role":"organizer"} no body) -> HTTP 201
Body: {"user":{"id":"usr_ccd502fff61f","name":"Tentativa Escalacao","email":"eval_esc_1795814530406@catraca.local","role":"participant"},"token":"..."}
```

- **HTML renderizado na tela `/register` (`renderRegisterView`)**: contém exclusivamente `input#register-name`, `input#register-email` e `input#register-password` e o texto *"Cadastre-se como participante para comprar e acompanhar seus ingressos."*, sem qualquer campo `role` ou opção de criar organizador.
- **Reexecução idempotente da seed e conferência no PostgreSQL**:
```text
$ docker compose exec -T app node dist/db/seed.js
[seed] Contas da seed garantidas com sucesso (2 organizadores + 1 participante).
$ docker compose exec -T app node dist/db/seed.js
[seed] Contas da seed garantidas com sucesso (2 organizadores + 1 participante).

$ docker compose exec -T db psql -U catraca -d catraca -c "SELECT id, name, email, role FROM users ORDER BY id;"
          id          |        name         |                 email                 |    role     
----------------------+---------------------+---------------------------------------+-------------
 usr_00ffff3a895a     | Mariana Avaliacao   | eval_part_1795814530007@catraca.local | participant
 usr_ccd502fff61f     | Tentativa Escalacao | eval_esc_1795814530406@catraca.local  | participant
 usr_seed_org_a       | Organizador A       | org.a@catraca.local                   | organizer
 usr_seed_org_b       | Organizador B       | org.b@catraca.local                   | organizer
 usr_seed_participant | Participante Seed   | participante@catraca.local            | participant
(5 rows)
```

---

### 3.4. `CT-F01-03` — Bloqueio de Visitantes e Participantes na Área de Organizador (`R13`)

- **Veredito**: **APROVADO**
- **Ações executadas**:
  1. Requisições deslogadas (`GET /api/organizer/events`, `POST /api/organizer/events`, `GET /api/organizer/events/evt_123`).
  2. Requisições autenticadas como Participante (via cookie `catraca_session` da seed e via `Authorization: Bearer` de participante recém-criado) às mesmas rotas `/api/organizer/*`.
  3. Requisição autenticada como Organizador A (`GET /api/organizer/events`) para contraprova.
  4. Inspeção do HTML entregue em `GET /organizer` e avaliação das views de bloqueio em `/app.js` e `renderOrganizerGuardBlockedView`.

- **Evidências HTTP e UI**:
```text
GET /api/organizer/events (visitante deslogado) -> HTTP 401
Body: {"error":"unauthenticated"}

POST /api/organizer/events (visitante deslogado) -> HTTP 401
Body: {"error":"unauthenticated"}

GET /api/organizer/events/evt_123 (visitante deslogado) -> HTTP 401
Body: {"error":"unauthenticated"}

GET /api/organizer/events (participante seed via Cookie) -> HTTP 403
Body: {"error":"forbidden"}

GET /api/organizer/events (participante novo via Bearer) -> HTTP 403
Body: {"error":"forbidden"}

POST /api/organizer/events (participante seed) -> HTTP 403
Body: {"error":"forbidden"}

GET /api/organizer/events/evt_123 (participante seed) -> HTTP 403
Body: {"error":"forbidden"}

GET /api/organizer/events (Organizador A autenticado) -> HTTP 200
Body: []
```
- **Proteção na Interface Web (`/organizer` e `/organizer/*` — R13)**:
  - `GET http://localhost:3000/organizer` retorna apenas o shell HTML vazio (`<header id="app-header"></header><main id="app-root"></main>`), sem qualquer vazamento de dados internos.
  - Em `app.js`, antes de montar qualquer tela em `/organizer` ou `/organizer/*`, a guarda verifica `if (!state.user || state.user.role !== 'organizer')` e interrompe a renderização chamando `renderOrganizerGuardBlockedView(root, state.user)` sem invocar endpoints de organizador:
    - Para **visitante deslogado**: renderiza `<div class="card" data-view="access-denied" data-reason="unauthenticated"><h1>Acesso restrito</h1><div class="alert error">Autenticação necessária. Entre na sua conta para continuar.</div>...</div>`.
    - Para **participante autenticado**: renderiza `<div class="card" data-view="access-denied" data-reason="forbidden"><h1>Acesso negado</h1><div class="alert error">Você não tem permissão para acessar esta página.</div>...</div>`.

---

### 3.5. `CT-F01-04` — Autenticação da API de Parceiros via `X-Api-Key`

- **Veredito**: **APROVADO**
- **Ações executadas**:
  1. `GET /api/partner/events` sem header `X-Api-Key`.
  2. `GET /api/partner/events` com `X-Api-Key: chave-invalida` e com `X-Api-Key` vazio.
  3. `GET /api/partner/events` autenticado com cookie de sessão de organizador, porém sem `X-Api-Key`.
  4. `POST /api/partner/events/evt_1/purchases` com `X-Api-Key: chave-invalida`.
  5. `GET /api/partner/events` com `X-Api-Key: catraca-partner-secret-key` (contraprova).

- **Evidências HTTP**:
```text
GET /api/partner/events (sem X-Api-Key) -> HTTP 401
Body: {"error":"unauthorized"}

GET /api/partner/events (X-Api-Key: chave-invalida) -> HTTP 401
Body: {"error":"unauthorized"}

GET /api/partner/events (X-Api-Key vazia) -> HTTP 401
Body: {"error":"unauthorized"}

GET /api/partner/events (com cookie de Organizador A, sem X-Api-Key) -> HTTP 401
Body: {"error":"unauthorized"}

POST /api/partner/events/evt_1/purchases (X-Api-Key: chave-invalida) -> HTTP 401
Body: {"error":"unauthorized"}

GET /api/partner/events (X-Api-Key: catraca-partner-secret-key) -> HTTP 200
Body: []
```

---

## 4. Execução dos Gates de Qualidade (`npm run gates`) e Encerramento (`npm run down`)

Com o ambiente principal em execução, `npm run gates` foi executado validando artefatos SDD, `tsc --noEmit`, migrações + seed idempotente em container PostgreSQL isolado (`catraca-gates`) e toda a suíte automatizada:

```text
[catraca:gates] 1/4 Verificando artefatos SDD e project-state.json...
[verify-artifacts] Artefatos SDD e project-state.json verificados com sucesso.
[catraca:gates] 2/4 Executando typecheck (tsc --noEmit)...
[catraca:gates] 3/4 Validando migrações e seed idempotente...
[migrate] Aplicada migração: 001_initial_schema.sql
[seed] Contas da seed garantidas com sucesso (2 organizadores + 1 participante).
[seed] Contas da seed garantidas com sucesso (2 organizadores + 1 participante).
[catraca:gates] 4/4 Executando suíte de testes automatizados...
ok 1 - F01 — Autenticação, Contas e Controle de Acesso (6 subtests)
ok 2 - Harness Base & Seed Idempotency (2 subtests)
# tests 8 | suites 2 | pass 8 | fail 0
[catraca:gates] Todos os gates passaram com sucesso!
```

Em seguida, o ambiente foi encerrado limpamente com `npm run down`:
```text
[catraca:down] Todos os containers e portas do projeto foram encerrados.
```

---

## 5. Conclusão e Veredito Final

Todos os itens verificáveis do contrato (`CT-F01-01`, `CT-F01-02`, `CT-F01-03` e `CT-F01-04`), bem como os critérios de aceite `CA-F01-01`..`CA-F01-04`, a regra de negócio `R13` e os gates automatizados do projeto foram integralmente cumpridos sem qualquer ressalva e sem alteração em código de produção.

**Veredito Final**: **`APROVADO`**
