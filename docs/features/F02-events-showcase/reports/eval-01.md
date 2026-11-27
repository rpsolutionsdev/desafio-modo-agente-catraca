# Relatório de Avaliação Independente — F02 (`eval-01`)

- **Feature**: `F02` — Ciclo de Vida de Eventos e Vitrine Pública (`F02-events-showcase`)
- **Data da avaliação**: `2026-11-27T18:58:59-03:00`
- **Branch avaliada**: `feat/f02-events-showcase`
- **Commit avaliado**: `06a6f80a40a83924b057b9f41fa8529dade279f4` (`06a6f80`)
- **Ferramenta e Modelo**: `Google Antigravity (Subagente feature-evaluator de contexto isolado) — Gemini 4 Carbon (High)`
- **Veredito Final**: **APROVADO**

---

## 1. Resumo Executivo e Tabela de Verificação do Contrato

O ambiente real em containers Docker (`catraca-db-1` + `catraca-app-1`) foi inicializado com `npm run up` a partir do commit `06a6f80a40a83924b057b9f41fa8529dade279f4`, exercitado empiricamente por requisições HTTP reais contra `http://localhost:3000`, inspeção direta de persistência e concorrência/ocupação no PostgreSQL, verificação real dos módulos e views da SPA (`/`, `/organizer`, `/organizer/events/:eventId`) e execução completa de `npm run gates` enquanto o ambiente estava ativo, finalizando com `npm run down`.

| Item do Contrato | Critérios PRD / Regras | Descrição Resumida | Veredito |
| :--- | :--- | :--- | :--- |
| **CT-F02-01** | `CA-F02-01` (`R01`) | Criação e edição de eventos rejeitam datas passadas, datas inválidas no calendário, lotação `<= 0` ou fracionária, preço `<= 0` ou fracionário e textos em branco (`422 {"error":"invalid_request"}` + mensagens claras na UI), aceitando apenas dados válidos com início no futuro. | **APROVADO** |
| **CT-F02-02** | `CA-F02-02` (`R02`), `CA-F02-05` (`R05`) | Evento E1 criado pelo Organizador A nasce `draft`, permanecendo oculto de `GET /api/events`, da vitrine `/` e de `GET /api/partner/events`; após `POST /api/organizer/events/:id/publish`, aparece em ambos com `priceCents: 10000` e `availableSeats: 2` e formato estrito na API de parceiros. | **APROVADO** |
| **CT-F02-03** | `CA-F02-03` (`R03`), `CA-F02-04` (`R04`), `R05` | Página própria `/organizer/events/$E1` carrega a gestão do evento (com publicação, edição e slots para `F04`/`F05`/`F06`), aceita alteração de preço e aumento de lotação via `PATCH`, e impõe trava transacional `FOR UPDATE` (`409 capacity_below_occupied`) contra redução abaixo das vagas ocupadas (`pending + confirmed`). | **APROVADO** |
| **CT-F02-04** | `CA-F02-06` (`R13`), `CF-01` (`F01 -> F02`) | Isolamento estrito: Organizador B recebe `200 []` em `GET /api/organizer/events` e `403 {"error":"forbidden"}` ao acessar/editar/publicar E1 diretamente; Participante recebe `403` e Visitante deslogado recebe `401`, sem vazamento de dados de E1 na API nem na SPA `/organizer/events/$E1`; `GET /api/partner/events` sem `X-Api-Key` válida retorna `401 {"error":"unauthorized"}`. | **APROVADO** |

---

## 2. Mapeamento PRD -> Contrato

| Critério no PRD | Regras de Negócio | Itens do Contrato Avaliados | Resultado |
| :--- | :--- | :--- | :--- |
| `CA-F02-01` | `R01` | `CT-F02-01` | **APROVADO** |
| `CA-F02-02` | `R02` | `CT-F02-02` | **APROVADO** |
| `CA-F02-03` | `R03` | `CT-F02-03` | **APROVADO** |
| `CA-F02-04` | `R04` | `CT-F02-03` | **APROVADO** |
| `CA-F02-05` | `R05` | `CT-F02-02`, `CT-F02-03` | **APROVADO** |
| `CA-F02-06` | `R13` | `CT-F02-04` | **APROVADO** |
| `CF-01` (`F01 -> F02`) | `R13` | `CT-F02-04` | **APROVADO** |

---

## 3. Evidências Empíricas por Item do Contrato

### 3.1. Pré-requisito: Subida do Ambiente Real (`npm run up`) e Autenticação da Seed

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

Healthcheck e autenticação inicial das contas provisionadas pela seed (`F01`):
```text
GET http://localhost:3000/api/health -> HTTP 200 {"status":"ok"}
POST /api/auth/login (org.a@catraca.local) -> HTTP 200 (id: usr_seed_org_a, role: organizer)
POST /api/auth/login (org.b@catraca.local) -> HTTP 200 (id: usr_seed_org_b, role: organizer)
POST /api/auth/login (participante@catraca.local) -> HTTP 200 (id: usr_seed_participant, role: participant)
```

Verificação dos módulos estáticos servidos pelo container `catraca-app-1`:
```text
GET /index.html             -> HTTP 200 (text/html; charset=UTF-8)
GET /styles.css             -> HTTP 200 (text/css; charset=UTF-8)
GET /app.js                 -> HTTP 200 (application/javascript; charset=UTF-8)
GET /views/auth.js          -> HTTP 200 (application/javascript; charset=UTF-8)
GET /views/showcase.js      -> HTTP 200 (application/javascript; charset=UTF-8)
GET /views/organizer-list.js  -> HTTP 200 (application/javascript; charset=UTF-8)
GET /views/organizer-event.js -> HTTP 200 (application/javascript; charset=UTF-8)
```

---

### 3.2. `CT-F02-01` — Validações de Domínio na Criação e na Edição (`R01`)

- **Veredito**: **APROVADO**
- **Ações executadas contra `http://localhost:3000` (como Organizador A autenticado)**:
  1. Tentativas de `POST /api/organizer/events` com data de ontem (`now - 24h`), data de 1 segundo atrás (`now - 1s`), data inexistente no calendário (`2028-02-30T20:00:00Z`), lotação `0`, `-3` e `2.5`, preço `0`, `-100` e `99.5`, nome em branco (`"   "`), local vazio (`""`) e JSON malformado.
  2. Criação de evento futuro válido (`evt_35c4b78ce33d`, `capacity: 10`, `priceCents: 5000`, `startsAt` em `+7 dias`).
  3. Tentativas de `PATCH /api/organizer/events/evt_35c4b78ce33d` com data de ontem, `capacity: 0`, `priceCents: 0`, nome em branco, local em branco e objeto vazio `{}`.
  4. Leitura subsequente via `GET /api/organizer/events/evt_35c4b78ce33d` para comprovar que nenhuma tentativa inválida corrompeu os dados persistidos.
  5. Verificação das mensagens de erro de validação renderizadas na UI (`describeValidationHint` + `#create-event-error` / `#edit-event-error`).

- **Evidências HTTP e UI**:
```text
POST /api/organizer/events (startsAt = ontem)            -> HTTP 422 {"error":"invalid_request"}
POST /api/organizer/events (startsAt = now - 1s)         -> HTTP 422 {"error":"invalid_request"}
POST /api/organizer/events (startsAt = 2028-02-30)       -> HTTP 422 {"error":"invalid_request"}
POST /api/organizer/events (capacity = 0)                -> HTTP 422 {"error":"invalid_request"}
POST /api/organizer/events (capacity = -3)               -> HTTP 422 {"error":"invalid_request"}
POST /api/organizer/events (capacity = 2.5)              -> HTTP 422 {"error":"invalid_request"}
POST /api/organizer/events (priceCents = 0)              -> HTTP 422 {"error":"invalid_request"}
POST /api/organizer/events (priceCents = -100)           -> HTTP 422 {"error":"invalid_request"}
POST /api/organizer/events (priceCents = 99.5)           -> HTTP 422 {"error":"invalid_request"}
POST /api/organizer/events (name = "   ")                -> HTTP 422 {"error":"invalid_request"}
POST /api/organizer/events (location = "")               -> HTTP 422 {"error":"invalid_request"}
POST /api/organizer/events (JSON malformado)             -> HTTP 422 {"error":"invalid_request"}

POST /api/organizer/events (dados válidos futuros)       -> HTTP 201
Body: {"id":"evt_35c4b78ce33d","organizerId":"usr_seed_org_a","name":"Workshop Validação R01","startsAt":"2026-12-04T21:56:42.157Z","location":"Auditório Centro","capacity":10,"priceCents":5000,"status":"draft","occupiedSeats":0,"availableSeats":10,"cancelledAt":null,...}

PATCH /api/organizer/events/evt_35c4b78ce33d (startsAt = ontem) -> HTTP 422 {"error":"invalid_request"}
PATCH /api/organizer/events/evt_35c4b78ce33d (capacity = 0)     -> HTTP 422 {"error":"invalid_request"}
PATCH /api/organizer/events/evt_35c4b78ce33d (priceCents = 0)   -> HTTP 422 {"error":"invalid_request"}
PATCH /api/organizer/events/evt_35c4b78ce33d (name = "  ")      -> HTTP 422 {"error":"invalid_request"}
PATCH /api/organizer/events/evt_35c4b78ce33d (location = "  ")  -> HTTP 422 {"error":"invalid_request"}
PATCH /api/organizer/events/evt_35c4b78ce33d ({})               -> HTTP 422 {"error":"invalid_request"}
```
- **Mensagens verificadas na UI (`#create-event-error` / `#edit-event-error`)**:
  - Data passada: `"A data e hora de início devem estar no futuro."`
  - Lotação `0`: `"A lotação deve ser um número inteiro maior ou igual a 1."`
  - Preço `0`: `"O preço deve ser maior que zero."`

---

### 3.3. `CT-F02-02` — Rascunho Oculto vs. Evento Publicado na Vitrine e na API de Parceiros (`R02`, `R05`)

- **Veredito**: **APROVADO**
- **Ações executadas**:
  1. Como Organizador A, criação do evento **E1** (`Show Acústico E1 — Segredo de A`, lotação `2`, R$ 100,00 -> `priceCents: 10000`, data futura em `+14 dias`) sem publicar -> `id: evt_2e38176d7295`.
  2. Com E1 em `status: "draft"`, consulta à vitrine pública (`GET /` e `GET /api/events`) e à API de parceiros (`GET /api/partner/events` com `X-Api-Key: catraca-partner-secret-key`).
  3. Publicação de E1 via `POST /api/organizer/events/evt_2e38176d7295/publish`.
  4. Nova consulta a `GET /api/events`, `GET /api/partner/events` e renderização real da view `renderShowcaseView` (`/`).

- **Evidências HTTP e UI**:
```text
POST /api/organizer/events (criação de E1) -> HTTP 201
Body: {"id":"evt_2e38176d7295","organizerId":"usr_seed_org_a","name":"Show Acústico E1 — Segredo de A","startsAt":"2026-12-11T21:56:42.157Z","location":"Porão Jazz Club — Rua Secreta 42","capacity":2,"priceCents":10000,"status":"draft","occupiedSeats":0,"availableSeats":2,"cancelledAt":null,"createdAt":"2026-11-27T21:56:42.255Z","updatedAt":"2026-11-27T21:56:42.255Z"}

# Enquanto rascunho (draft):
GET /api/events -> HTTP 200 []
GET /api/partner/events (com X-Api-Key válida) -> HTTP 200 []
GET / (HTML inicial) -> HTTP 200 (nenhuma menção a E1)

# Publicação de E1:
POST /api/organizer/events/evt_2e38176d7295/publish -> HTTP 200
Body: {"id":"evt_2e38176d7295","organizerId":"usr_seed_org_a","name":"Show Acústico E1 — Segredo de A","startsAt":"2026-12-11T21:56:42.157Z","location":"Porão Jazz Club — Rua Secreta 42","capacity":2,"priceCents":10000,"status":"published","occupiedSeats":0,"availableSeats":2,"cancelledAt":null,"createdAt":"2026-11-27T21:56:42.255Z","updatedAt":"2026-11-27T21:56:42.273Z"}

# Após publicação (published):
GET /api/events -> HTTP 200
Body: [{"id":"evt_2e38176d7295","name":"Show Acústico E1 — Segredo de A","startsAt":"2026-12-11T21:56:42.157Z","location":"Porão Jazz Club — Rua Secreta 42","capacity":2,"priceCents":10000,"availableSeats":2}]

GET /api/partner/events (com X-Api-Key válida) -> HTTP 200
Body: [{"id":"evt_2e38176d7295","name":"Show Acústico E1 — Segredo de A","startsAt":"2026-12-11T21:56:42.157Z","priceCents":10000,"availableSeats":2}]
```
- **Conformidade estrita com `CA-F02-05` (`R05`)**: cada item de `GET /api/partner/events` retorna exclusivamente as chaves `["availableSeats", "id", "name", "priceCents", "startsAt"]`, e eventos ainda `draft` (`evt_35c4b78ce33d` naquele instante) permanecem ocultos tanto da vitrine quanto da API de parceiros.

---

### 3.4. `CT-F02-03` — Página Dedicada de Gestão (`/organizer/events/$E1`), Edição de Preço/Lotação e Trava `R03`/`R05`

- **Veredito**: **APROVADO**
- **Ações executadas**:
  1. Acesso a `GET /organizer/events/evt_2e38176d7295` e execução real de `renderOrganizerEventView` autenticada como Organizador A contra `GET /api/organizer/events/evt_2e38176d7295`.
  2. Edição de E1 via `PATCH /api/organizer/events/evt_2e38176d7295` aumentando `capacity` de `2` para `5` e alterando `priceCents` de `10000` (R$ 100,00) para `15000` (R$ 150,00).
  3. Conferência imediata na vitrine (`/` e `GET /api/events`) e em `GET /api/partner/events`.
  4. Verificação empírica da trava transacional `SELECT ... FOR UPDATE` (`R03` + `R05`) no PostgreSQL real: inserção de 2 ingressos `confirmed`, 1 `pending` e 1 `declined` no evento auxiliar `evt_35c4b78ce33d`, seguida de publicação e tentativas de `PATCH` para `capacity: 2` (`< 3` ocupadas) e `capacity: 3` (`== 3` ocupadas).

- **Evidências HTTP, UI e Banco de Dados**:
```text
GET /organizer/events/evt_2e38176d7295 -> HTTP 200 (shell SPA)
GET /api/organizer/events/evt_2e38176d7295 (Organizador A) -> HTTP 200

PATCH /api/organizer/events/evt_2e38176d7295 (capacity: 5, priceCents: 15000) -> HTTP 200
Body: {"id":"evt_2e38176d7295","organizerId":"usr_seed_org_a","name":"Show Acústico E1 — Segredo de A","startsAt":"2026-12-11T21:56:42.157Z","location":"Porão Jazz Club — Rua Secreta 42","capacity":5,"priceCents":15000,"status":"published","occupiedSeats":0,"availableSeats":5,...}

GET /api/partner/events (após edição de E1) -> HTTP 200
Body: [{"id":"evt_2e38176d7295","name":"Show Acústico E1 — Segredo de A","startsAt":"2026-12-11T21:56:42.157Z","priceCents":15000,"availableSeats":5}]
```
- **Estrutura verificada na página `/organizer/events/evt_2e38176d7295` (`R04`)**:
  - Renderiza `data-view="organizer-event-detail"` com cabeçalho `#detail-event-name`, `#detail-event-status`, indicadores `#detail-event-starts-at`, `#detail-event-location`, `#detail-event-price`, `#detail-event-capacity`, botão `#publish-event-btn` (quando `draft`), formulário `#edit-event-form` e os slots de integração `#event-dashboard-slot`, `#event-checkin-slot` e `#event-cancel-slot`.
  - Na vitrine (`renderShowcaseView`), E1 renderiza `R$ 150,00` e `Vagas disponíveis: 5`.
- **Comprovação empírica da trava `R03` + `R05` com ingressos persistidos**:
```text
# Em evt_35c4b78ce33d (capacity=10) com 2 confirmed + 1 pending + 1 declined:
POST /api/organizer/events/evt_35c4b78ce33d/publish -> HTTP 200 (occupiedSeats: 3, availableSeats: 7; ingresso declined ignorado conforme R05)
PATCH /api/organizer/events/evt_35c4b78ce33d {"capacity":2} -> HTTP 409 {"error":"capacity_below_occupied"}
PATCH /api/organizer/events/evt_35c4b78ce33d {"capacity":3} -> HTTP 200 (capacity: 3, occupiedSeats: 3, availableSeats: 0)
# Na vitrine (/), o cartão com availableSeats == 0 renderiza o badge "Ingressos esgotados".
```
- **Estado persistido verificado diretamente no PostgreSQL (`catraca-db-1`)**:
```text
        id        |  organizer_id  |              name               | capacity | price_cents |  status   
------------------+----------------+---------------------------------+----------+-------------+-----------
 evt_35c4b78ce33d | usr_seed_org_a | Workshop Validação R01          |        3 |        5000 | published
 evt_2e38176d7295 | usr_seed_org_a | Show Acústico E1 — Segredo de A |        5 |       15000 | published
(2 rows)
```

---

### 3.5. `CT-F02-04` — Isolamento Total por Organizador/Perfil (`R13`) e Proteção `X-Api-Key` (`CF-01`)

- **Veredito**: **APROVADO**
- **Ações executadas**:
  1. **Como Organizador B (`org.b@catraca.local`)**: listagem em `GET /api/organizer/events` e renderização de `/organizer`; acesso direto a `GET /api/organizer/events/evt_2e38176d7295`, tentativas de `PATCH /api/organizer/events/evt_2e38176d7295` e `POST /api/organizer/events/evt_35c4b78ce33d/publish`, além da abertura direta da página `/organizer/events/evt_2e38176d7295`.
  2. **Como Participante da seed (`participante@catraca.local`)**: chamadas a todas as rotas `GET/POST /api/organizer/events` e `GET/PATCH/POST /api/organizer/events/evt_2e38176d7295*`, além da abertura direta de `/organizer/events/evt_2e38176d7295`.
  3. **Como Visitante deslogado (sem cookie e sem Bearer)**: chamadas a todas as rotas `/api/organizer/events*` e abertura direta de `/organizer/events/evt_2e38176d7295`.
  4. **Autenticação da API de Parceiros (`CF-01`)**: chamadas a `GET /api/partner/events` sem `X-Api-Key`, com `X-Api-Key` inválida e com cookie de sessão de Organizador A mas sem `X-Api-Key`.

- **Evidências HTTP**:
```text
# 1. Organizador B tentando ver ou operar eventos de Organizador A:
GET /api/organizer/events (Organizador B)                           -> HTTP 200 []
GET /api/organizer/events/evt_2e38176d7295 (Organizador B)          -> HTTP 403 {"error":"forbidden"}
PATCH /api/organizer/events/evt_2e38176d7295 (Organizador B)        -> HTTP 403 {"error":"forbidden"}
POST /api/organizer/events/evt_35c4b78ce33d/publish (Organizador B) -> HTTP 403 {"error":"forbidden"}

# 2. Participante autenticado (seed):
GET /api/organizer/events (Participante)                            -> HTTP 403 {"error":"forbidden"}
POST /api/organizer/events (Participante)                           -> HTTP 403 {"error":"forbidden"}
GET /api/organizer/events/evt_2e38176d7295 (Participante)           -> HTTP 403 {"error":"forbidden"}
PATCH /api/organizer/events/evt_2e38176d7295 (Participante)         -> HTTP 403 {"error":"forbidden"}
POST /api/organizer/events/evt_2e38176d7295/publish (Participante)  -> HTTP 403 {"error":"forbidden"}

# 3. Visitante deslogado:
GET /api/organizer/events (Visitante)                               -> HTTP 401 {"error":"unauthenticated"}
POST /api/organizer/events (Visitante)                              -> HTTP 401 {"error":"unauthenticated"}
GET /api/organizer/events/evt_2e38176d7295 (Visitante)              -> HTTP 401 {"error":"unauthenticated"}
PATCH /api/organizer/events/evt_2e38176d7295 (Visitante)            -> HTTP 401 {"error":"unauthenticated"}
POST /api/organizer/events/evt_2e38176d7295/publish (Visitante)     -> HTTP 401 {"error":"unauthenticated"}

# 4. API de Parceiros sem X-Api-Key ou com chave inválida:
GET /api/partner/events (sem X-Api-Key)                             -> HTTP 401 {"error":"unauthorized"}
GET /api/partner/events (X-Api-Key: chave-errada)                   -> HTTP 401 {"error":"unauthorized"}
GET /api/partner/events (cookie Organizador A, sem X-Api-Key)       -> HTTP 401 {"error":"unauthorized"}
```

- **Evidências de ausência total de vazamento na UI (`/organizer` e `/organizer/events/evt_2e38176d7295`)**:
  - `GET /organizer/events/evt_2e38176d7295` entrega exclusivamente o shell estático vazio (`<main id="app-root"></main>`), sem SSR de dados sensíveis.
  - Em `/organizer`, Organizador B vê apenas `<p style="color: var(--muted); margin-bottom: 0;">Nenhum evento cadastrado ainda.</p>`.
  - Ao abrir `/organizer/events/evt_2e38176d7295`:
    - **Organizador B** vê `<div class="card" data-view="access-denied" data-reason="forbidden"><h1>Acesso negado</h1><div class="alert error">Você não tem permissão para acessar ou gerenciar este evento.</div>...</div>` (zero campos de E1 expostos).
    - **Participante** é bloqueado pela guarda de rota com `<div class="card" data-view="access-denied" data-reason="forbidden"><h1>Acesso negado</h1>...</div>`.
    - **Visitante deslogado** é bloqueado pela guarda de rota com `<div class="card" data-view="access-denied" data-reason="unauthenticated"><h1>Acesso restrito</h1>...</div>`.

---

## 4. Execução dos Gates de Qualidade (`npm run gates`) e Encerramento (`npm run down`)

Com o ambiente principal ativo em `http://localhost:3000`, `npm run gates` foi executado em container PostgreSQL isolado (`catraca-gates`), validando artefatos SDD, `tsc --noEmit`, migrações + seed idempotente e todas as suítes automatizadas (`F01`, `F02` e `Harness`):

```text
[catraca:gates] Subindo PostgreSQL efêmero isolado (catraca-gates)...
[catraca:gates] 1/4 Verificando artefatos SDD e project-state.json...
[verify-artifacts] Artefatos SDD e project-state.json verificados com sucesso.
[catraca:gates] 2/4 Executando typecheck (tsc --noEmit)...
[catraca:gates] 3/4 Validando migrações e seed idempotente...
[migrate] Aplicada migração: 001_initial_schema.sql
[seed] Contas da seed garantidas com sucesso (2 organizadores + 1 participante).
[seed] Contas da seed garantidas com sucesso (2 organizadores + 1 participante).
[catraca:gates] 4/4 Executando suíte de testes automatizados...
ok 1 - F01 — Autenticação, Contas e Controle de Acesso (6 subtests)
ok 2 - F02 — Ciclo de Vida de Eventos e Vitrine Pública (5 subtests)
ok 3 - Harness Base & Seed Idempotency (2 subtests)
# tests 13 | suites 3 | pass 13 | fail 0
[catraca:gates] Todos os gates passaram com sucesso!
```

Em seguida, o ambiente foi encerrado limpamente com `npm run down`:
```text
[catraca:down] Todos os containers e portas do projeto foram encerrados.
```

---

## 5. Conclusão e Veredito Final

Todos os itens verificáveis do contrato (`CT-F02-01`, `CT-F02-02`, `CT-F02-03` e `CT-F02-04`), bem como os critérios `CA-F02-01`..`CA-F02-06`, o critério cross-feature `CF-01` (`F01 -> F02`), as regras `R01`, `R02`, `R03`, `R04`, `R05` e `R13` e todos os gates de qualidade foram comprovados empiricamente sem ressalvas e sem qualquer modificação em código de produção.

**Veredito Final**: **`APROVADO`**
