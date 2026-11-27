# Relatório de Avaliação Independente — F03 (`eval-01`)

- **Feature**: `F03` — Compra de Ingressos, Lotação Concorrente, Gateway Simulado e API de Parceiros (`F03-purchases-gateway`)
- **Data da avaliação**: `2026-11-27T19:29:20-03:00`
- **Branch avaliada**: `feat/f03-purchases-gateway`
- **Commit avaliado**: `97b0680f7e5c8b7de6fe7b7fdf3c7af2c602ad26` (`97b0680`)
- **Ferramenta e Modelo**: `Google Antigravity (Subagente feature-evaluator de contexto isolado) — Gemini 4 Carbon (High)`
- **Veredito Final**: **APROVADO**

---

## 1. Resumo Executivo e Tabela de Verificação do Contrato

O ambiente real em containers Docker (`catraca-db-1` + `catraca-app-1`) foi inicializado com `npm run up` a partir do commit `97b0680f7e5c8b7de6fe7b7fdf3c7af2c602ad26`, operando no modo padrão do gateway simulado (sem `GATEWAY_DELAY_MULTIPLIER` e sem chaves externas, aplicando os atrasos reais de 2–5s e 30–40s). Todos os itens `CT-F03-01` a `CT-F03-05` foram exercitados empiricamente via requisições HTTP reais contra `http://localhost:3000`, execução real das views SPA (`/` e `/my-tickets`), Rajadas concorrentes reais (`Promise.all` de 30 `fetch` simultâneos em duas rodadas independentes), inspeção direta das linhas persistidas no PostgreSQL e execução completa de `npm run gates` com o ambiente ativo, finalizando com `npm run down`.

| Item do Contrato | Critérios PRD / Regras | Descrição Resumida | Veredito |
| :--- | :--- | :--- | :--- |
| **CT-F03-01** | `CA-F03-01` (`R06`), `CA-F03-03` (`R08`), `CA-F03-05` (`R09`), `CF-02` (`F01 -> F03`) | Participante recém-criada (`Marina Avaliadora`) comprou E1 (`evt_a7b062cbc652`, lotação 2, R$ 100,00) com `4000000000000001`; compra retornou `202` em `8ms` com `status: "pending"`, reduziu vagas para `1`, exibiu imediatamente `pendente` em `/my-tickets` (`t = +28ms`) e confirmou assincronamente em `3244ms` (`<= 5s`) exibindo nome de E1, badge `confirmado` e código único `RWAANZYC`. | **APROVADO** |
| **CT-F03-02** | `CA-F03-01` (`R06`), `CA-F03-03` (`R08`), `CA-F03-04` (`R07`), `CA-F03-06`, `R05` | Compra da 2ª vaga de E1 pela API de parceiros com `4000000000000004` (`tkt_670252e2a06a`) retornou `202` em `5ms` com `status: "pending"` e levou `availableSeats` a `0`; antes de 30s (`t = +41ms` e `t = +28030ms`) novas compras retornaram `409 {"error":"sold_out"}` e a vitrine renderizou `Ingressos esgotados` sem formulário; transição real ocorreu em `31627ms` (janela 30–40s) e em `t = +45386ms` `GET /api/partner/tickets/$T2` retornou `status: "declined"` com `availableSeats` de volta a `1`. | **APROVADO** |
| **CT-F03-03** | `R03`, `CF-03` (`F02 -> F03`) | Com 2 vagas ocupadas em E1 (`tkt_6395d2f9f753` + `tkt_13cd30507e4c` a `priceCents: 10000`), `PATCH` reduzindo `capacity` para `1` foi rejeitado com `409 {"error":"capacity_below_occupied"}` (tanto com 1 confirmada + 1 pendente quanto com 2 confirmadas); `PATCH` para `capacity: 3` e `priceCents: 15000` (R$ 150,00) retornou `200`; 3ª compra (`tkt_9f96325801b8`) gravou `15000` preservando `10000` nas compras anteriores. | **APROVADO** |
| **CT-F03-04** | `CA-F03-04` (`R07`) | Em duas rodadas independentes em eventos novos publicados de lotação `5` (`E4 = evt_18c9087299a7` e `E5 = evt_60b9fd5ea789`), 30 `POST /api/partner/events/$E/purchases` simultâneos (`Promise.all`) resultaram em exatamente **`5` x `202`** e **`25` x `409 {"error":"sold_out"}`** na Rodada 1 (`209ms`) e exatamente **`5` x `202`** e **`25` x `409 {"error":"sold_out"}`** na Rodada 2 (`104ms`), com zero overselling no banco. | **APROVADO** |
| **CT-F03-05** | `CA-F03-02`, `CA-F03-06`, `CF-02`, `CF-03` | Matriz completa de erros e contratos verificada: `401 {"error":"unauthorized"}` sem/com chave inválida em compra e consulta (prioritário sobre `422`/`404`); `422 {"error":"invalid_request"}` para `"cardNumber":"123"`, letras/espaços/17 dígitos, e-mail inválido, campos ausentes e JSON malformado (prioritário sobre `404`/`409`); `404 {"error":"event_not_available"}` para rascunho e inexistente; `404 {"error":"ticket_not_found"}` para ingresso inexistente; e `200` com payload exato ao consultar na API de parceiros o ingresso `tkt_6395d2f9f753` comprado na vitrine. | **APROVADO** |

---

## 2. Mapeamento PRD -> Contrato

| Critério no PRD | Regras de Negócio | Itens do Contrato Avaliados | Resultado |
| :--- | :--- | :--- | :--- |
| `CA-F03-01` | `R05`, `R06` | `CT-F03-01`, `CT-F03-02` | **APROVADO** |
| `CA-F03-02` | `R06` | `CT-F03-05` | **APROVADO** |
| `CA-F03-03` | `R05`, `R08` | `CT-F03-01`, `CT-F03-02` | **APROVADO** |
| `CA-F03-04` | `R07` | `CT-F03-02`, `CT-F03-04` | **APROVADO** |
| `CA-F03-05` | `R09` | `CT-F03-01` | **APROVADO** |
| `CA-F03-06` | — | `CT-F03-02`, `CT-F03-05` | **APROVADO** |
| `CF-02` (`F01 -> F03`) | `R06`, `R09` | `CT-F03-01`, `CT-F03-05` | **APROVADO** |
| `CF-03` (`F02 -> F03`) | `R02`, `R03`, `R05` | `CT-F03-03`, `CT-F03-05` | **APROVADO** |

---

## 3. Evidências Empíricas por Item do Contrato

### 3.1. Pré-requisito: Subida do Ambiente Real no Modo Padrão (`npm run up`)

Comando executado:
```bash
npm run up
```

Containers e variáveis de ambiente verificados em execução (`docker ps` + `docker exec catraca-app-1 env`):
```text
NAMES           STATUS                        PORTS
catraca-app-1   Up (healthy)                  0.0.0.0:3000->3000/tcp
catraca-db-1    Up (healthy)                  5432/tcp

AUTH_SECRET=catraca-local-session-secret-2026
DATABASE_URL=postgres://catraca:catraca@db:5432/catraca
NODE_ENV=production
PARTNER_API_KEY=catraca-partner-secret-key
PORT=3000
# Sem GATEWAY_DELAY_MULTIPLIER e sem chaves externas -> atrasos reais de 2-5s e 30-40s ativos
```

Healthcheck e rotas estáticas da SPA verificados:
```text
GET http://localhost:3000/api/health          -> HTTP 200 {"status":"ok"}
GET http://localhost:3000/                    -> HTTP 200 (text/html; charset=UTF-8)
GET http://localhost:3000/my-tickets          -> HTTP 200 (text/html; charset=UTF-8)
GET http://localhost:3000/app.js              -> HTTP 200 (application/javascript; charset=UTF-8)
GET http://localhost:3000/views/showcase.js   -> HTTP 200 (application/javascript; charset=UTF-8)
GET http://localhost:3000/views/my-tickets.js -> HTTP 200 (application/javascript; charset=UTF-8)
```

---

### 3.2. `CT-F03-01` — Cadastro de Participante, Compra na Vitrine com `0001` e Transição `pendente -> confirmado` em até 5s (`R06`, `R08`, `R09`, `CF-02`)

- **Veredito**: **APROVADO**
- **Ações executadas contra `http://localhost:3000`**:
  1. Registro de nova conta de participante via `POST /api/auth/register` (`Marina Avaliadora`, `marina.eval.f03@catraca.local`) capturando o cookie `catraca_session`.
  2. Como Organizador A (`org.a@catraca.local`), criação e publicação do evento **E1** (`Show Acústico E1 — Avaliação F03`, `capacity: 2`, `priceCents: 10000` = R$ 100,00) -> `id: evt_a7b062cbc652`.
  3. Verificação da vitrine (`renderShowcaseView`) autenticada como Marina: exibição de `Show Acústico E1 — Avaliação F03`, `R$ 100,00`, `Vagas disponíveis: 2` e formulário `form.showcase-purchase-form`.
  4. Disparo da compra unitária na vitrine `POST /api/events/evt_a7b062cbc652/purchases` com `{"cardNumber":"4000000000000001"}`.
  5. Leitura imediata (`t = +28ms`) de `GET /api/my-tickets`, renderização de `/my-tickets` (`renderMyTicketsView`), checagem de ocupação imediata em `GET /api/events` e `GET /api/partner/events` e checagem de isolamento de "Meus ingressos" contra outro participante, visitante e organizador.
  6. Recarregamento de `GET /api/my-tickets` e `/my-tickets` dentro da janela de 5 segundos.

- **Evidências HTTP e UI**:
```text
POST /api/auth/register -> HTTP 201 (Set-Cookie: catraca_session=...)
Body: {"user":{"id":"usr_1d5d5f1bcd5c","name":"Marina Avaliadora","email":"marina.eval.f03@catraca.local","role":"participant"},...}

POST /api/organizer/events -> HTTP 201 (evt_a7b062cbc652, status: "draft", capacity: 2, priceCents: 10000)
POST /api/organizer/events/evt_a7b062cbc652/publish -> HTTP 200 (status: "published", availableSeats: 2)

# Compra unitária na vitrine (respondeu em 8ms sem aguardar o gateway):
POST /api/events/evt_a7b062cbc652/purchases {"cardNumber":"4000000000000001"} -> HTTP 202 (8ms)
Body: {"ticketId":"tkt_6395d2f9f753","code":"RWAANZYC","status":"pending"}

# Consulta imediata (t = +28ms após a compra):
GET /api/my-tickets (Marina) -> HTTP 200
Body: [{"ticketId":"tkt_6395d2f9f753","code":"RWAANZYC","eventId":"evt_a7b062cbc652","eventName":"Show Acústico E1 — Avaliação F03","eventStartsAt":"2026-12-11T22:26:56.037Z","eventLocation":"Casa de Cultura Catraca","priceCents":10000,"status":"pending","statusLabel":"pendente","checkedIn":false,"createdAt":"2026-11-27T22:26:56.060Z"}]

GET /api/events -> availableSeats de E1 caiu imediatamente de 2 para 1
GET /api/partner/events -> availableSeats de E1 caiu imediatamente de 2 para 1

# Isolamento de GET /api/my-tickets:
GET /api/my-tickets (participante@catraca.local) -> HTTP 200 []
GET /api/my-tickets (Visitante deslogado)        -> HTTP 401 {"error":"unauthenticated"}
GET /api/my-tickets (Organizador A)              -> HTTP 403 {"error":"forbidden"}

# Confirmação assíncrona pelo gateway simulado em t = +3244ms (dentro da janela real 2s..5s):
GET /api/my-tickets (Marina, t = +3244ms) -> HTTP 200
Body: [{"ticketId":"tkt_6395d2f9f753","code":"RWAANZYC","eventId":"evt_a7b062cbc652","eventName":"Show Acústico E1 — Avaliação F03","priceCents":10000,"status":"confirmed","statusLabel":"confirmado","checkedIn":false,...}]
```
- **Evidência na UI `/my-tickets` (`renderMyTicketsView`)**:
  - Imediatamente (`t = +28ms`): renderizou o card `data-ticket-card="tkt_6395d2f9f753"` com título `Show Acústico E1 — Avaliação F03`, badge `data-ticket-status="pending"` com texto exato `pendente` e `<code data-ticket-code-value>RWAANZYC</code>`.
  - Após recarregar em `t = +3244ms` (`<= 5s`): renderizou o mesmo card com badge `data-ticket-status="confirmed"` com texto exato `confirmado`, código único `RWAANZYC` e `Valor: R$ 100,00`.

---

### 3.3. `CT-F03-02` — Cartão Lento `0004` via API de Parceiros, Esgotamento durante `pending` (`409 sold_out` + `Ingressos esgotados`) e Liberação de Vaga após 45s (`R05`, `R06`, `R07`, `R08`)

- **Veredito**: **APROVADO**
- **Ações executadas**:
  1. Com E1 tendo `capacity: 2` e `1` vaga ocupada (`tkt_6395d2f9f753`), compra da 2ª vaga (`$T2`) via `POST /api/partner/events/evt_a7b062cbc652/purchases` com `X-Api-Key: catraca-partner-secret-key` e cartão lento `4000000000000004`.
  2. Antes de 30s (`t = +41ms` e novamente em `t = +28030ms`): consulta a `GET /api/partner/events`, `GET /api/events`, renderização da vitrine `/` (como participante e como visitante), consulta a `GET /api/partner/tickets/$T2` e tentativas adicionais de compra via API de parceiros e vitrine.
  3. Paralelamente, em evento auxiliar `evt_9ea30adbf406`, exercitados os demais sufixos de `CA-F03-03` (`0002`, `9999` e `0003`) no relógio real do container.
  4. Monitoramento do instante real de transição de `$T2` e conferência oficial após 45s (`t = +45386ms`) em `GET /api/partner/tickets/$T2`, `GET /api/partner/events` e `GET /api/events`.

- **Evidências HTTP e UI**:
```text
# 1. Compra da 2ª vaga de E1 via API de Parceiros com cartão 0004 (respondeu em 5ms):
POST /api/partner/events/evt_a7b062cbc652/purchases {"buyerEmail":"parceiro.lento@externo.local","cardNumber":"4000000000000004"}
-> HTTP 202 (5ms)
Body: {"ticketId":"tkt_670252e2a06a","code":"22Y2QF54","status":"pending"}

# 2. Antes de 30s (t = +41ms):
GET /api/partner/events -> {"id":"evt_a7b062cbc652","name":"Show Acústico E1 — Avaliação F03","startsAt":"2026-12-11T22:26:56.037Z","priceCents":10000,"availableSeats":0}
GET /api/events         -> {"id":"evt_a7b062cbc652",...,"capacity":2,"priceCents":10000,"availableSeats":0}
GET /api/partner/tickets/tkt_670252e2a06a -> HTTP 200 {"ticketId":"tkt_670252e2a06a","code":"22Y2QF54","eventId":"evt_a7b062cbc652","status":"pending","checkedIn":false}

POST /api/partner/events/evt_a7b062cbc652/purchases (nova tentativa) -> HTTP 409 {"error":"sold_out"}
POST /api/events/evt_a7b062cbc652/purchases (nova tentativa vitrine) -> HTTP 409 {"error":"sold_out"}

# 3. Nova checagem antes de 30s (t = +28030ms):
GET /api/partner/tickets/tkt_670252e2a06a -> status permanece "pending"
POST /api/partner/events/evt_a7b062cbc652/purchases -> HTTP 409 {"error":"sold_out"}

# 4. Transição real observada em t = +31627ms (dentro da janela regulamentar 30s..40s) e consulta oficial após 45s (t = +45386ms):
GET /api/partner/tickets/tkt_670252e2a06a (t = +45386ms) -> HTTP 200
Body: {"ticketId":"tkt_670252e2a06a","code":"22Y2QF54","eventId":"evt_a7b062cbc652","status":"declined","checkedIn":false}

GET /api/partner/events (t = +45386ms) -> {"id":"evt_a7b062cbc652",...,"priceCents":10000,"availableSeats":1}
GET /api/events (t = +45386ms)         -> {"id":"evt_a7b062cbc652",...,"availableSeats":1}
```
- **HTML renderizado na vitrine `/` durante `availableSeats == 0`**:
```html
<span class="badge" data-availability="sold-out" style="background: #fee2e2; color: #991b1b;">Ingressos esgotados</span>
<div class="event-purchase-slot" id="event-purchase-slot-evt_a7b062cbc652" data-event-id="evt_a7b062cbc652" data-available-seats="0" style="margin-top: 0.85rem;"><div class="alert error" data-sold-out-notice style="margin: 0;">Ingressos esgotados</div></div>
```
  (Sem formulário `form.showcase-purchase-form` tanto para participante logada quanto para visitante.)
- **Comprovação complementar de todos os demais sufixos do gateway (`CA-F03-03`) no container real**:
  - Final `0002` (`tkt_73a8e46dcd20`) -> `declined` em `<= 5.2s` (renderizado como badge `recusado` em `/my-tickets`).
  - Final genérico `9999` (`tkt_0201bb09ee8d`) -> `declined` em `<= 5.2s`.
  - Final `0003` (`tkt_e902b6911922`) -> permaneceu `pending` em `t = +5.2s` e `t = +28.0s`, transicionando para `confirmed` em `t = +35745ms` (janela real `30s..40s`).

---

### 3.4. `CT-F03-03` — Trava de Redução de Lotação (`R03`) e Preservação Histórica de `priceCents` (`CF-03`)

- **Veredito**: **APROVADO**
- **Ações executadas**:
  1. Compra da 2ª vaga de E1 (`tkt_13cd30507e4c`, código `QBMHY4XA`) ao preço vigente de R$ 100,00 (`10000`).
  2. Com 2 vagas ocupadas em E1, tentativa como Organizador A de reduzir `capacity` para `1` via `PATCH /api/organizer/events/evt_a7b062cbc652` — testada tanto com `1 confirmed + 1 pending` quanto após `2 confirmed`.
  3. Edição de E1 via `PATCH /api/organizer/events/evt_a7b062cbc652` alterando `capacity` para `3` e `priceCents` para `15000` (R$ 150,00).
  4. Compra da 3ª vaga (`tkt_9f96325801b8`, código `DMWJ2U5C`) com `4000000000000001` e verificação dos valores gravados via `GET /api/my-tickets`, `/my-tickets` e consulta SQL direta no PostgreSQL.

- **Evidências HTTP e Banco de Dados**:
```text
POST /api/events/evt_a7b062cbc652/purchases {"cardNumber":"4000000000000001"} -> HTTP 202
Body: {"ticketId":"tkt_13cd30507e4c","code":"QBMHY4XA","status":"pending"}

# Tentativa de reduzir lotação para 1 com 2 vagas ocupadas:
PATCH /api/organizer/events/evt_a7b062cbc652 {"capacity":1} (1 confirmed + 1 pending) -> HTTP 409 {"error":"capacity_below_occupied"}
PATCH /api/organizer/events/evt_a7b062cbc652 {"capacity":1} (2 confirmed)             -> HTTP 409 {"error":"capacity_below_occupied"}

# Aumento de lotação para 3 e alteração de preço para R$ 150,00:
PATCH /api/organizer/events/evt_a7b062cbc652 {"capacity":3,"priceCents":15000} -> HTTP 200
Body: {"id":"evt_a7b062cbc652",...,"capacity":3,"priceCents":15000,"status":"published","occupiedSeats":2,"availableSeats":1,...}

# Compra da 3ª vaga já sob o novo preço:
POST /api/events/evt_a7b062cbc652/purchases {"cardNumber":"4000000000000001"} -> HTTP 202
Body: {"ticketId":"tkt_9f96325801b8","code":"DMWJ2U5C","status":"pending"}
```

- **Consulta direta ao PostgreSQL (`catraca-db-1`) comprovando `price_cents` histórico**:
```text
        id        |   code   | channel  | price_cents |  status   | checked_in 
------------------+----------+----------+-------------+-----------+------------
 tkt_6395d2f9f753 | RWAANZYC | showcase |       10000 | confirmed | f
 tkt_670252e2a06a | 22Y2QF54 | partner  |       10000 | declined  | f
 tkt_13cd30507e4c | QBMHY4XA | showcase |       10000 | confirmed | f
 tkt_9f96325801b8 | DMWJ2U5C | showcase |       15000 | confirmed | f
(4 rows)
```
  Na UI `/my-tickets`, os ingressos `RWAANZYC` e `QBMHY4XA` exibem `Valor: R$ 100,00` enquanto `DMWJ2U5C` exibe `Valor: R$ 150,00`.

---

### 3.5. `CT-F03-04` — Concorrência Real em Duas Rodadas Independentes (30 `POST` Simultâneos contra Lotação 5) (`R07`)

- **Veredito**: **APROVADO**
- **Ações executadas**:
  - Criação e publicação de dois eventos novos independentes com `capacity: 5` (`priceCents: 7500`):
    - **Rodada 1 (`E4`)**: `evt_18c9087299a7` (`Evento Concorrência E4 — Lotação 5`)
    - **Rodada 2 (`E5`)**: `evt_60b9fd5ea789` (`Evento Concorrência E5 — Lotação 5`)
  - Em cada rodada, disparo simultâneo (`Promise.all` de 30 `fetch` paralelos contra `http://localhost:3000/api/partner/events/$E/purchases`) com `X-Api-Key: catraca-partner-secret-key` e `cardNumber: "4000000000000001"`.

- **Evidências HTTP e Contagem Exata**:
```text
# Rodada 1 — Evento E4 (evt_18c9087299a7, capacity = 5):
Requisições simultâneas disparadas: 30 (concluídas em 209ms)
Histograma de status HTTP: {"202": 5, "409": 25}
- 5 respostas HTTP 202 (códigos únicos: NUT5CGTW, U7AGMAKR, G2JV3KZG, 467GTFG5, 54WD2T6T)
- 25 respostas HTTP 409 com corpo exato {"error":"sold_out"}
- availableSeats imediatamente após a rajada: 0

# Rodada 2 — Evento E5 (evt_60b9fd5ea789, capacity = 5):
Requisições simultâneas disparadas: 30 (concluídas em 104ms)
Histograma de status HTTP: {"202": 5, "409": 25}
- 5 respostas HTTP 202 (códigos únicos: 2XQ5J2E8, ZXAZTNGK, 8SCBL5W3, H9ACT85W, C228XF9Z)
- 25 respostas HTTP 409 com corpo exato {"error":"sold_out"}
- availableSeats imediatamente após a rajada: 0
```

- **Auditoria no PostgreSQL (`catraca-db-1`) após confirmação**:
```text
                name                | channel |  status   | price_cents | total 
------------------------------------+---------+-----------+-------------+-------
 Evento Concorrência E4 — Lotação 5 | partner | confirmed |        7500 |     5
 Evento Concorrência E5 — Lotação 5 | partner | confirmed |        7500 |     5
```
  Zero overselling e zero erros `500` sob lock transacional `SELECT ... FROM events WHERE id = $1 FOR UPDATE`.

---

### 3.6. `CT-F03-05` — Matriz Completa de Erros e Contratos da API de Parceiros e Consulta Cross-Channel (`CA-F03-02`, `CA-F03-06`, `CF-02`, `CF-03`)

- **Veredito**: **APROVADO**
- **Evidências HTTP observadas contra `http://localhost:3000`**:
```text
# 1. Autenticação da API de Parceiros (401 prioritário sobre 422 e 404):
POST /api/partner/events/evt_a7b062cbc652/purchases (sem X-Api-Key, body inválido)           -> HTTP 401 {"error":"unauthorized"}
POST /api/partner/events/evt_inexistente/purchases (X-Api-Key errada, body inválido)         -> HTTP 401 {"error":"unauthorized"}
POST /api/partner/events/evt_a7b062cbc652/purchases (cookie de sessão válido, sem X-Api-Key) -> HTTP 401 {"error":"unauthorized"}
GET  /api/partner/tickets/tkt_6395d2f9f753 (sem X-Api-Key)                                   -> HTTP 401 {"error":"unauthorized"}
GET  /api/partner/tickets/tkt_inexistente (X-Api-Key errada)                                 -> HTTP 401 {"error":"unauthorized"}

# 2. Validação de payload/cartão/e-mail (422 prioritário sobre 404 e 409, sem criar ingresso):
POST /api/partner/events/evt_a7b062cbc652/purchases {"buyerEmail":"cliente@parceiro.local","cardNumber":"123"}               -> HTTP 422 {"error":"invalid_request"}
POST /api/partner/events/evt_nao_existe_422/purchases {"buyerEmail":"cliente@parceiro.local","cardNumber":"123"}             -> HTTP 422 {"error":"invalid_request"}
POST /api/partner/events/evt_8116c48c225d/purchases {"buyerEmail":"cliente@parceiro.local","cardNumber":"400000000000000A"}  -> HTTP 422 {"error":"invalid_request"}
POST /api/partner/events/evt_a7b062cbc652/purchases {"buyerEmail":"cliente@parceiro.local","cardNumber":"4000 0000 0000 0001"} -> HTTP 422 {"error":"invalid_request"}
POST /api/partner/events/evt_a7b062cbc652/purchases {"buyerEmail":"cliente@parceiro.local","cardNumber":"40000000000000019"} -> HTTP 422 {"error":"invalid_request"}
POST /api/partner/events/evt_nao_existe_email/purchases {"buyerEmail":"email-sem-arroba","cardNumber":"4000000000000001"}    -> HTTP 422 {"error":"invalid_request"}
POST /api/partner/events/evt_a7b062cbc652/purchases {"cardNumber":"4000000000000001"} (sem buyerEmail)                       -> HTTP 422 {"error":"invalid_request"}
POST /api/partner/events/evt_a7b062cbc652/purchases {}                                                                       -> HTTP 422 {"error":"invalid_request"}
POST /api/partner/events/evt_a7b062cbc652/purchases (JSON malformado)                                                        -> HTTP 422 {"error":"invalid_request"}
POST /api/events/evt_nao_existe/purchases {"cardNumber":"123"} (vitrine valida 16 dígitos antes de 404)                      -> HTTP 422 {"error":"invalid_request"}

# 3. Evento em rascunho (evt_8116c48c225d) ou inexistente -> 404 event_not_available:
POST /api/partner/events/evt_8116c48c225d/purchases (draft)          -> HTTP 404 {"error":"event_not_available"}
POST /api/partner/events/evt_inexistente_f03/purchases (inexistente) -> HTTP 404 {"error":"event_not_available"}
POST /api/events/evt_8116c48c225d/purchases (vitrine draft)          -> HTTP 404 {"error":"event_not_available"}
POST /api/events/evt_inexistente_f03/purchases (vitrine inexistente) -> HTTP 404 {"error":"event_not_available"}

# 4. Consulta de ingressos na API de Parceiros (inexistente vs. vitrine vs. parceiro):
GET /api/partner/tickets/tkt_inexistente_f03 -> HTTP 404 {"error":"ticket_not_found"}

GET /api/partner/tickets/tkt_6395d2f9f753 (comprado na vitrine) -> HTTP 200
Body: {"ticketId":"tkt_6395d2f9f753","code":"RWAANZYC","eventId":"evt_a7b062cbc652","status":"confirmed","checkedIn":false}

GET /api/partner/tickets/tkt_670252e2a06a (comprado via parceiro) -> HTTP 200
Body: {"ticketId":"tkt_670252e2a06a","code":"22Y2QF54","eventId":"evt_a7b062cbc652","status":"declined","checkedIn":false}
```

---

## 4. Execução dos Gates de Qualidade (`npm run gates`) e Encerramento (`npm run down`)

Com o ambiente principal ativo em `http://localhost:3000`, `npm run gates` foi executado em container PostgreSQL isolado (`catraca-gates`), validando artefatos SDD, `tsc --noEmit`, migrações + seed idempotente e todas as 4 suítes automatizadas (`F01`, `F02`, `F03` e `Harness`):

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
ok 3 - F03 — Compra de Ingressos, Lotação Concorrente, Gateway Simulado e API de Parceiros (7 subtests)
ok 4 - Harness Base & Seed Idempotency (2 subtests)
# tests 20 | suites 4 | pass 20 | fail 0
[catraca:gates] Todos os gates passaram com sucesso!
```

Em seguida, o ambiente foi encerrado limpamente com `npm run down`:
```text
[catraca:down] Todos os containers e portas do projeto foram encerrados.
```

---

## 5. Conclusão e Veredito Final

Todos os itens verificáveis do contrato (`CT-F03-01`, `CT-F03-02`, `CT-F03-03`, `CT-F03-04` e `CT-F03-05`), bem como os critérios `CA-F03-01`..`CA-F03-06`, os critérios cross-feature `CF-02` (`F01 -> F03`) e `CF-03` (`F02 -> F03`), as regras `R03`, `R05`, `R06`, `R07`, `R08` e `R09` e todos os gates de qualidade foram comprovados empiricamente sem ressalvas e sem qualquer modificação em código de produção.

**Veredito Final**: **`APROVADO`**
