# Relatório de Avaliação Independente — F05 (`eval-01`)

- **Feature**: `F05` — Cancelamento Irreversível e Estorno Assíncrono (`F05-cancellation-refunds`)
- **Data da avaliação**: `2026-11-28T07:26:45-03:00`
- **Branch avaliada**: `feat/f05-cancellation-refunds`
- **Commit avaliado**: `5dd8a28ddc1b64819ec4321bc6bae94223ecbe21` (`5dd8a28`)
- **Ferramenta e Modelo**: `Google Antigravity (Subagente feature-evaluator de contexto isolado) — Gemini 4 Carbon (High)`
- **Veredito Final**: **APROVADO**

---

## 1. Resumo Executivo e Tabela de Verificação do Contrato

O ambiente real em containers Docker (`catraca-db-1` + `catraca-app-1`) foi inicializado com `npm run up` no diretório isolado `.worktrees/f05` a partir do commit `5dd8a28ddc1b64819ec4321bc6bae94223ecbe21`, operando no modo padrão do gateway simulado (sem `GATEWAY_DELAY_MULTIPLIER` e sem chaves externas, aplicando os atrasos reais de 2–5s e 30–40s). Todos os itens `CT-F05-01` a `CT-F05-04` foram exercitados empiricamente via requisições HTTP reais contra `http://localhost:3000`, execução real das views SPA (`renderOrganizerEventView`, `mountCancelWidget`, `renderShowcaseView` e `renderMyTicketsView`), cronometragem real de 46 segundos frente aos timers tardios do gateway simulado, inspeção direta das linhas persistidas no PostgreSQL e execução completa de `$env:GATE_PROJECT="catraca-eval-f05"; npm run gates`, encerrando limpamente o ambiente com `npm run down`.

| Item do Contrato | Critérios PRD / Regras | Descrição Resumida | Veredito |
| :--- | :--- | :--- | :--- |
| **CT-F05-01** | `CA-F05-01` (`R11`, `R05`), `CF-08` (`F02 -> F05`), `CF-09` (`F03 -> F05`) | Organizador A criou e publicou **E3** (`evt_189521359143`, lotação `5`, `R$ 50,00`); comprou `$T5` (`tkt_79ae82d17ef9`) com `4000000000000003` e `$T6` (`tkt_a731782a576c`) com `4000000000000001` (além de 2 ingressos na vitrine); após `$T6` confirmar em `t = +3788ms` e antes de 30s (`t = +3802ms`), `POST /api/organizer/events/evt_189521359143/cancel` respondeu `200` em `5ms` com `{"id":"evt_189521359143","status":"cancelled","availableSeats":0}`, removeu imediatamente E3 de `GET /api/events` e `GET /api/partner/events`, bloqueou compras com `404 {"error":"event_not_available"}` e bloqueou `PATCH`, `POST /publish` e novo `POST /cancel` com `409` e na UI de gestão. | **APROVADO** |
| **CT-F05-02** | `CA-F05-02` (`R11`), `CF-09` (`F03 -> F05`), `R09` | Em **`343ms`** após o cancelamento (`302,7ms` no relógio transacional do PostgreSQL, muito abaixo do SLA máximo de 10s), `$T6` (`tkt_a731782a576c`) e `tkt_5db2fe72c59e` transicionaram de `confirmed` para `"status": "refunded"` (`estornado`), e `$T5` (`tkt_79ae82d17ef9`) e `tkt_fd8dea402576` transicionaram de `pending` para `"status": "cancelled"` (`cancelado`), tanto em `GET /api/partner/tickets/:id` quanto em `GET /api/my-tickets` e na view `/my-tickets`. | **APROVADO** |
| **CT-F05-03** | `CA-F05-03` (`R11`), `CF-09` (`F03 -> F05`) | Após aguardar **`46.015ms`** reais desde a compra inicial de `$T5` (superando integralmente a janela de 30–40s dos cartões lentos `0003` e `0004`), `GET /api/partner/tickets/tkt_79ae82d17ef9` permaneceu com `"status": "cancelled"` (e `tkt_fd8dea402576` permaneceu `"cancelled"`, `tkt_a731782a576c`/`tkt_5db2fe72c59e` permaneceram `"refunded"`), com `updated_at` inalterado no PostgreSQL. | **APROVADO** |
| **CT-F05-04** | `CF-07` (`F01 -> F05`), `R13` | Evento publicado do Organizador A (`evt_8150f3d8ec1f`) rejeitou tentativas de `POST /cancel` deslogado (`401 {"error":"unauthenticated"}`), como Participante (`403 {"error":"forbidden"}`) e como Organizador B (`403 {"error":"forbidden"}`, inclusive sobre E3 já cancelado, sem vazar estado), permanecendo `published` com `availableSeats: 8` na gestão, vitrine e API de parceiros. | **APROVADO** |

---

## 2. Mapeamento PRD -> Contrato

| Critério no PRD | Regras de Negócio | Itens do Contrato Avaliados | Resultado |
| :--- | :--- | :--- | :--- |
| `CA-F05-01` | `R11`, `R05` | `CT-F05-01` | **APROVADO** |
| `CA-F05-02` | `R11` | `CT-F05-02` | **APROVADO** |
| `CA-F05-03` | `R11` | `CT-F05-03` | **APROVADO** |
| `CF-07` (`F01 -> F05`) | `R13` | `CT-F05-04` | **APROVADO** |
| `CF-08` (`F02 -> F05`) | `R02`, `R05`, `R11` | `CT-F05-01` | **APROVADO** |
| `CF-09` (`F03 -> F05`) | `R08`, `R11` | `CT-F05-01`, `CT-F05-02`, `CT-F05-03` | **APROVADO** |

---

## 3. Evidências Empíricas por Item do Contrato

### 3.1. Pré-requisito: Subida do Ambiente Real no Modo Padrão (`npm run up`)

Comando executado em `.worktrees/f05`:
```bash
npm run up
```

Containers e variáveis de ambiente verificados em execução (`docker ps` + `docker exec catraca-app-1 env`):
```text
NAMES           STATUS                    PORTS
catraca-app-1   Up 23 seconds (healthy)   0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp
catraca-db-1    Up 26 seconds (healthy)   5432/tcp

AUTH_SECRET=catraca-local-session-secret-2026
DATABASE_URL=postgres://catraca:catraca@db:5432/catraca
NODE_ENV=production
PARTNER_API_KEY=catraca-partner-secret-key
PORT=3000
# Sem GATEWAY_DELAY_MULTIPLIER e sem chaves externas -> atrasos reais de 2-5s e 30-40s ativos
```

Healthcheck e rotas/módulos estáticos da SPA verificados:
```text
GET http://localhost:3000/api/health              -> HTTP 200 {"status":"ok"}
GET http://localhost:3000/                        -> HTTP 200 (text/html; charset=UTF-8)
GET http://localhost:3000/organizer/events/evt_x  -> HTTP 200 (text/html; charset=UTF-8)
GET http://localhost:3000/views/cancel-widget.js  -> HTTP 200 (application/javascript; charset=UTF-8)
GET http://localhost:3000/views/organizer-event.js-> HTTP 200 (application/javascript; charset=UTF-8)
GET http://localhost:3000/views/my-tickets.js     -> HTTP 200 (application/javascript; charset=UTF-8)
```

---

### 3.2. `CT-F05-01` — Cancelamento Irreversível de E3 Publicado, Saída Imediata da Vitrine/Parceiros e Bloqueio de Compras, Edição e Republicação (`R11`, `R05`, `CF-08`, `CF-09`)

- **Veredito**: **APROVADO**
- **Ações executadas contra `http://localhost:3000`**:
  1. Pré-checagem em evento `draft` (`evt_54bffdf6fb02`): tentativa de cancelamento retornou `409 {"error":"cannot_cancel_event"}`, e a view `renderOrganizerEventView` exibiu `#publish-event-btn` sem renderizar `#cancel-event-btn`.
  2. Autenticado como Organizador A (`org.a@catraca.local` via cookie `catraca_session`), criação e publicação do evento **E3** (`Show Cancelamento E3 — Avaliação F05`, `capacity: 5`, `priceCents: 5000` = R$ 50,00) -> `id: evt_189521359143`. Na UI de gestão publicada, verificada a presença de `#cancel-event-btn` dentro de `data-cancel-state="published"` e campos de edição habilitados.
  3. Compra de `$T5` via API de Parceiros com cartão lento `4000000000000003` (janela 30–40s) -> `tkt_79ae82d17ef9` (`code: D3QA2XLY`, `status: "pending"` em `9ms`), seguida imediatamente da compra de `$T6` via API de Parceiros com cartão rápido `4000000000000001` (janela 2–5s) -> `tkt_a731782a576c` (`code: BS8MSTKF`, `status: "pending"` em `5ms`), além de 2 ingressos comprados na vitrine pelo Participante (`tkt_fd8dea402576` com cartão lento `4000000000000004` e `tkt_5db2fe72c59e` com cartão rápido `4000000000000001`), totalizando 4 de 5 vagas ocupadas (`availableSeats: 1`).
  4. Aguardada a confirmação assíncrona de `$T6` e `tkt_5db2fe72c59e` (`t = +3788ms` desde a compra de `$T5`), confirmando que `$T5` e `tkt_fd8dea402576` permaneciam `pending` e que E3 estava visível em `GET /api/events` e `GET /api/partner/events` com `availableSeats: 1`.
  5. Em `t = +3802ms` desde a compra de `$T5` (bem antes dos 30s), acionado `POST /api/organizer/events/evt_189521359143/cancel` e executadas imediatamente (`+39ms`) todas as verificações de remoção da vitrine/parceiros, bloqueio de compra e bloqueio de edição/republicação/novo cancelamento, além do teste interativo de clique em `#cancel-event-btn` na UI (`evt_b56bbc3acdc8`).

- **Evidências HTTP e UI**:
```text
# Pré-checagem em evento rascunho (evt_54bffdf6fb02):
POST /api/organizer/events/evt_54bffdf6fb02/cancel -> HTTP 409 {"error":"cannot_cancel_event"}

# Criação e publicação de E3 (lotação 5, R$ 50,00 = 5000):
POST /api/organizer/events -> HTTP 201 (id: "evt_189521359143", status: "draft", capacity: 5, priceCents: 5000)
POST /api/organizer/events/evt_189521359143/publish -> HTTP 200 (status: "published", availableSeats: 5)

# Compras em E3:
POST /api/partner/events/evt_189521359143/purchases {"buyerEmail":"comprador.t5.lento@parceiro.local","cardNumber":"4000000000000003"}
-> HTTP 202 (9ms) {"ticketId":"tkt_79ae82d17ef9","code":"D3QA2XLY","status":"pending"}

POST /api/partner/events/evt_189521359143/purchases {"buyerEmail":"comprador.t6.rapido@parceiro.local","cardNumber":"4000000000000001"}
-> HTTP 202 (5ms) {"ticketId":"tkt_a731782a576c","code":"BS8MSTKF","status":"pending"}

POST /api/events/evt_189521359143/purchases {"cardNumber":"4000000000000004"} (Participante vitrine)
-> HTTP 202 {"ticketId":"tkt_fd8dea402576","code":"AUALHNFU","status":"pending"}

POST /api/events/evt_189521359143/purchases {"cardNumber":"4000000000000001"} (Participante vitrine)
-> HTTP 202 {"ticketId":"tkt_5db2fe72c59e","code":"STBDFBHZ","status":"pending"}

# Estado imediatamente antes do cancelamento (t = +3788ms desde a compra de $T5):
GET /api/partner/tickets/tkt_a731782a576c ($T6) -> {"ticketId":"tkt_a731782a576c","code":"BS8MSTKF","eventId":"evt_189521359143","status":"confirmed","checkedIn":false}
GET /api/partner/tickets/tkt_79ae82d17ef9 ($T5) -> {"ticketId":"tkt_79ae82d17ef9","code":"D3QA2XLY","eventId":"evt_189521359143","status":"pending","checkedIn":false}
GET /api/events                                 -> E3 presente com availableSeats: 1
GET /api/partner/events                         -> E3 presente com availableSeats: 1

# Cancelamento de E3 antes de 30s (em t = +3802ms desde a compra de $T5):
POST /api/organizer/events/evt_189521359143/cancel -> HTTP 200 (5ms)
Body: {"id":"evt_189521359143","status":"cancelled","availableSeats":0}

# Verificações imediatas (+39ms após o cancelamento):
GET /api/events         -> E3 ausente (inShowcaseAfter: false; renderShowcaseView não contém evt_189521359143)
GET /api/partner/events -> E3 ausente (inPartnerEventsAfter: false)
GET /api/organizer/events/evt_189521359143 -> HTTP 200 {"id":"evt_189521359143","status":"cancelled","availableSeats":0,"occupiedSeats":4,"cancelledAt":"2026-11-28T10:25:09.181Z",...}

POST /api/partner/events/evt_189521359143/purchases (cartão válido) -> HTTP 404 {"error":"event_not_available"}
POST /api/events/evt_189521359143/purchases (vitrine cartão válido) -> HTTP 404 {"error":"event_not_available"}
POST /api/partner/events/evt_189521359143/purchases (cartão "123")  -> HTTP 422 {"error":"invalid_request"} (preserva precedência CA-F03-02)

PATCH /api/organizer/events/evt_189521359143 {"name":"Tentativa Editar E3 Cancelado","capacity":10,"priceCents":8000}
-> HTTP 409 {"error":"event_cancelled"}

POST /api/organizer/events/evt_189521359143/publish -> HTTP 409 {"error":"event_cancelled"}
POST /api/organizer/events/evt_189521359143/cancel  -> HTTP 409 {"error":"cannot_cancel_event"}
```

- **Evidência na UI `/organizer/events/:eventId` (`renderOrganizerEventView` + `mountCancelWidget`)**:
  - Para E3 cancelado (`evt_189521359143`): badge `#detail-event-status` exibe `cancelado`; `#detail-event-capacity` exibe `5 / 0`; `#publish-event-btn` e `#cancel-event-btn` estão ausentes (`false`); alerta informativo exibe `Este evento está cancelado. Edição e republicação estão bloqueadas.`; todos os 5 inputs (`#edit-event-name`, `#edit-event-starts-at`, `#edit-event-location`, `#edit-event-capacity`, `#edit-event-price`) e `#edit-event-submit` estão com `disabled = true`; e `#event-cancel-slot` renderiza `data-cancel-state="cancelled"` com `#cancel-event-status-banner`.
  - No fluxo interativo via clique no botão `#cancel-event-btn` em evento publicado dedicado (`evt_b56bbc3acdc8`): o clique disparou `POST /api/organizer/events/evt_b56bbc3acdc8/cancel`, re-renderizou a página em `data-cancel-state="cancelled"`, exibiu `Evento cancelado com sucesso.` e desabilitou `#edit-event-submit` removendo `#cancel-event-btn`.

---

### 3.3. `CT-F05-02` — Liquidação Assíncrona em até 10 Segundos (`confirmed -> refunded` / `estornado` e `pending -> cancelled` / `cancelado`) (`R11`, `CF-09`, `R09`)

- **Veredito**: **APROVADO**
- **Ações executadas**:
  - Polling imediato após o cancelamento de E3 em `GET /api/partner/tickets/:id` para `$T6`, `$T5`, `tkt_5db2fe72c59e` e `tkt_fd8dea402576`, seguido da consulta autenticada como Participante a `GET /api/my-tickets` e renderização da view `/my-tickets` (`renderMyTicketsView`).

- **Evidências HTTP, UI e Tempo Real**:
```text
# Tempo decorrido desde POST .../cancel até todos os 4 ingressos estarem liquidados:
settlementElapsedFromCancelMs = 343ms (limite máximo do contrato: <= 10.000ms)

# API de Parceiros (GET /api/partner/tickets/:id):
GET /api/partner/tickets/tkt_a731782a576c ($T6, era confirmed) -> HTTP 200
Body: {"ticketId":"tkt_a731782a576c","code":"BS8MSTKF","eventId":"evt_189521359143","status":"refunded","checkedIn":false}

GET /api/partner/tickets/tkt_79ae82d17ef9 ($T5, era pending) -> HTTP 200
Body: {"ticketId":"tkt_79ae82d17ef9","code":"D3QA2XLY","eventId":"evt_189521359143","status":"cancelled","checkedIn":false}

GET /api/partner/tickets/tkt_5db2fe72c59e (vitrine, era confirmed) -> HTTP 200
Body: {"ticketId":"tkt_5db2fe72c59e","code":"STBDFBHZ","eventId":"evt_189521359143","status":"refunded","checkedIn":false}

GET /api/partner/tickets/tkt_fd8dea402576 (vitrine, era pending) -> HTTP 200
Body: {"ticketId":"tkt_fd8dea402576","code":"AUALHNFU","eventId":"evt_189521359143","status":"cancelled","checkedIn":false}

# "Meus ingressos" do Participante (GET /api/my-tickets):
- tkt_5db2fe72c59e: {"ticketId":"tkt_5db2fe72c59e","code":"STBDFBHZ","eventId":"evt_189521359143","eventName":"Show Cancelamento E3 — Avaliação F05","priceCents":5000,"status":"refunded","statusLabel":"estornado","checkedIn":false,...}
- tkt_fd8dea402576: {"ticketId":"tkt_fd8dea402576","code":"AUALHNFU","eventId":"evt_189521359143","eventName":"Show Cancelamento E3 — Avaliação F05","priceCents":5000,"status":"cancelled","statusLabel":"cancelado","checkedIn":false,...}
```
- **Evidência na UI `/my-tickets` (`renderMyTicketsView`)**:
  - Renderizou `<span class="badge" data-ticket-status="refunded" ...>estornado</span>` para `STBDFBHZ` e `<span class="badge" data-ticket-status="cancelled" ...>cancelado</span>` para `AUALHNFU`.

---

### 3.4. `CT-F05-03` — Imunidade à Resposta Tardia do Gateway Simulado após 45 Segundos (`R11`, `CF-09`)

- **Veredito**: **APROVADO**
- **Ações executadas**:
  - Aguardada a passagem real de **`46.015ms`** desde o instante da compra inicial de `$T5` (`4000000000000003`, cujo timer no gateway simulado dispara entre `31.000ms` e `37.000ms`) e de `tkt_fd8dea402576` (`4000000000000004`, também entre `31.000ms` e `37.000ms`).
  - Reconsultados todos os ingressos via `GET /api/partner/tickets/:id`, `GET /api/my-tickets` e auditoria SQL direta na tabela `tickets` do container `catraca-db-1`.

- **Evidências HTTP após 46,01s (`totalElapsedFromT5Ms = 46015ms`)**:
```text
GET /api/partner/tickets/tkt_79ae82d17ef9 ($T5, cartão 0003) -> HTTP 200
Body: {"ticketId":"tkt_79ae82d17ef9","code":"D3QA2XLY","eventId":"evt_189521359143","status":"cancelled","checkedIn":false}

GET /api/partner/tickets/tkt_fd8dea402576 (vitrine, cartão 0004) -> HTTP 200
Body: {"ticketId":"tkt_fd8dea402576","code":"AUALHNFU","eventId":"evt_189521359143","status":"cancelled","checkedIn":false}

GET /api/partner/tickets/tkt_a731782a576c ($T6, cartão 0001) -> HTTP 200
Body: {"ticketId":"tkt_a731782a576c","code":"BS8MSTKF","eventId":"evt_189521359143","status":"refunded","checkedIn":false}

GET /api/partner/tickets/tkt_5db2fe72c59e (vitrine, cartão 0001) -> HTTP 200
Body: {"ticketId":"tkt_5db2fe72c59e","code":"STBDFBHZ","eventId":"evt_189521359143","status":"refunded","checkedIn":false}
```

- **Auditoria direta no PostgreSQL (`catraca-db-1`) após > 46s**:
```text
# Tabela events (cancelled_at de E3 = 10:25:09.181989+00):
        id        |                 name                 | capacity | price_cents |  status   |         cancelled_at          
------------------+--------------------------------------+----------+-------------+-----------+-------------------------------
 evt_189521359143 | Show Cancelamento E3 — Avaliação F05 |        5 |        5000 | cancelled | 2026-11-28 10:25:09.181989+00

# Tabela tickets (updated_at liquidado em 10:25:09.484712+00 — 302,7ms após cancelled_at — e intacto após o disparo tardio do gateway entre 10:25:36 e 10:25:42):
        id        |   code   |     event_id     | channel  | price_cents |  status   | checked_in |          created_at           |          updated_at           
------------------+----------+------------------+----------+-------------+-----------+------------+-------------------------------+-------------------------------
 tkt_79ae82d17ef9 | D3QA2XLY | evt_189521359143 | partner  |        5000 | cancelled | f          | 2026-11-28 10:25:05.385205+00 | 2026-11-28 10:25:09.484712+00
 tkt_a731782a576c | BS8MSTKF | evt_189521359143 | partner  |        5000 | refunded  | f          | 2026-11-28 10:25:05.393617+00 | 2026-11-28 10:25:09.484712+00
 tkt_fd8dea402576 | AUALHNFU | evt_189521359143 | showcase |        5000 | cancelled | f          | 2026-11-28 10:25:05.3996+00   | 2026-11-28 10:25:09.484712+00
 tkt_5db2fe72c59e | STBDFBHZ | evt_189521359143 | showcase |        5000 | refunded  | f          | 2026-11-28 10:25:05.405363+00 | 2026-11-28 10:25:09.484712+00
(4 rows)
```

---

### 3.5. `CT-F05-04` — Isolamento entre Organizadores e Controle de Acesso no Cancelamento (`R13`, `CF-07`)

- **Veredito**: **APROVADO**
- **Ações executadas**:
  - Criação e publicação de novo evento do Organizador A (`Evento Protegido Org A — CT-F05-04` -> `evt_8150f3d8ec1f`, `capacity: 8`, `priceCents: 6000`).
  - Tentativas de `POST /api/organizer/events/evt_8150f3d8ec1f/cancel` como Visitante deslogado, como Participante (`participante@catraca.local`) e como Organizador B (`org.b@catraca.local`), além de tentativa de Organizador B sobre E3 já cancelado (`evt_189521359143`) e checagem de isolamento na view `renderOrganizerEventView`.

- **Evidências HTTP e UI**:
```text
POST /api/organizer/events/evt_8150f3d8ec1f/cancel (Visitante deslogado) -> HTTP 401 {"error":"unauthenticated"}
POST /api/organizer/events/evt_8150f3d8ec1f/cancel (Participante)        -> HTTP 403 {"error":"forbidden"}
POST /api/organizer/events/evt_8150f3d8ec1f/cancel (Organizador B)       -> HTTP 403 {"error":"forbidden"}
POST /api/organizer/events/evt_189521359143/cancel (Org B em cancelado)  -> HTTP 403 {"error":"forbidden"} (não vaza 409)
POST /api/organizer/events/evt_nao_existe_f05/cancel (Organizador A)     -> HTTP 404 {"error":"not_found"}

# Estado preservado do evento do Organizador A após todas as tentativas indevidas:
GET /api/organizer/events/evt_8150f3d8ec1f (Org A) -> HTTP 200 {"status":"published","availableSeats":8,"cancelledAt":null,...}
GET /api/events                                    -> evt_8150f3d8ec1f presente
GET /api/partner/events                            -> evt_8150f3d8ec1f presente
```
- **Isolamento na UI (`/organizer/events/evt_8150f3d8ec1f`)**:
  - Organizador B recebe `data-view="access-denied" data-reason="forbidden"` (`Acesso negado`) sem vazamento do nome ou dados do evento; Participante e Visitante são bloqueados pela guarda de rota de organizador.

---

## 4. Execução dos Gates de Qualidade (`npm run gates`) e Encerramento (`npm run down`)

Com `$env:GATE_PROJECT="catraca-eval-f05"`, `npm run gates` foi executado em container PostgreSQL efêmero isolado (`catraca-eval-f05`), validando artefatos SDD, `tsc --noEmit`, migrações + seed idempotente e todas as 5 suítes automatizadas (`F01`, `F02`, `F03`, `F05` e `Harness`):

```text
[catraca:gates] Subindo PostgreSQL efêmero isolado (catraca-eval-f05)...
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
ok 3 - F03 — Compra de Ingressos, Lotação Concorrente, Gateway Simulado e API de Parceiros (7 subtests)
ok 4 - F05 — Cancelamento Irreversível e Estorno Assíncrono (6 subtests)
ok 5 - Harness Base & Seed Idempotency (2 subtests)
# tests 26 | suites 5 | pass 26 | fail 0
[catraca:gates] Todos os gates passaram com sucesso!
```

Em seguida, o ambiente foi encerrado com `npm run down`, liberando integralmente containers e a porta `3000`:
```text
[catraca:down] Todos os containers e portas do projeto foram encerrados.
```

---

## 5. Conclusão e Veredito Final

Todos os itens verificáveis do contrato (`CT-F05-01`, `CT-F05-02`, `CT-F05-03` e `CT-F05-04`), bem como os critérios `CA-F05-01`, `CA-F05-02` e `CA-F05-03`, os critérios cross-feature `CF-07` (`F01 -> F05`), `CF-08` (`F02 -> F05`) e `CF-09` (`F03 -> F05`), as regras de negócio `R02`, `R05`, `R08`, `R09`, `R11` e `R13` e todos os gates de qualidade foram comprovados empiricamente sem ressalvas e sem qualquer modificação em código de produção.

**Veredito Final**: **`APROVADO`**
