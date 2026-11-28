# Relatório de Avaliação Independente — F06 (`eval-01`)

- **Feature**: `F06` — Painel Operacional e Financeiro do Evento (`F06-event-dashboard`)
- **Data da avaliação**: `2026-11-28T08:19:47-03:00`
- **Branch avaliada**: `feat/f06-event-dashboard`
- **Commit avaliado**: `15bba967f45f177a55c68b75e8fc1e6509e7a928` (`15bba96`)
- **Ferramenta e Modelo**: `Google Antigravity (Subagente feature-evaluator de contexto isolado) — Gemini 4 Carbon (High)`
- **Veredito Final**: **APROVADO**

---

## 1. Resumo Executivo e Tabela de Verificação do Contrato

O ambiente completo em containers Docker (`catraca-db-1` + `catraca-app-1`) foi inicializado com `npm run up` a partir do commit `15bba967f45f177a55c68b75e8fc1e6509e7a928` (`15bba96`), operando estritamente no modo padrão do gateway simulado (sem `GATEWAY_DELAY_MULTIPLIER` e sem chaves externas, aplicando os atrasos reais de 2–5s para cartões rápidos e 30–40s para cartões lentos). Todos os itens do contrato (`CT-F06-01` a `CT-F06-04`) foram exercitados empiricamente por meio de requisições HTTP reais contra `http://localhost:3000`, navegação e inspeção real do DOM em navegador Chromium headless (`Microsoft Edge --headless=new` via Chrome DevTools Protocol), invocação direta do módulo `src/web/views/dashboard-widget.js`, auditoria SQL direta no container PostgreSQL `catraca-db-1` e execução completa da suíte `npm run gates`, encerrando limpamente o ambiente com `npm run down`.

| Item do Contrato | Critérios PRD / Regras | Descrição Resumida | Veredito |
| :--- | :--- | :--- | :--- |
| **CT-F06-01** | `CA-F06-01` (`R12`, `R03`, `R05`, `R04`), `CF-11` (`F02 -> F06`), `CF-12` (`F03 -> F06`) | Em **E1** (`evt_903be7d3d1c2`, lotação inicial `2`, `R$ 100,00`): 1ª compra na vitrine com `0001` confirmou `C1` (`tkt_aacc98d8268f`, código `CWSNK7D7`); compra na API de Parceiros com `0004` (`tkt_395f60c8ccbb`) manteve `Pendentes: 1` e `Vagas disponíveis: 0` (`409 sold_out` em tentativa extra, mantendo `Receita: R$ 100,00`); após `45.012ms`, `0004` recusou (`declined`), levando o painel a `Pendentes: 0` e `Vagas disponíveis: 1`; 2ª compra confirmada com `0001` (`tkt_502c6cfa630b`, `R$ 100,00`), trava `R03` validada (`409 capacity_below_occupied` ao tentar `capacity: 1`), edição de E1 para `capacity: 3` e `priceCents: 15000` (`R$ 150,00` preservando `Receita: R$ 200,00` e elevando `Vagas disponíveis: 1`) e 3ª compra confirmada com `0001` (`tkt_d8d903e98806`, `R$ 150,00`). Na API, no navegador headless e em `dashboard-widget.js`, o painel consolidou exatamente `Confirmados: 3`, `Pendentes: 0`, `Check-ins: 0`, `Vagas disponíveis: 0`, `Receita: R$ 350,00` e `Estornados: 0`. | **APROVADO** |
| **CT-F06-02** | `CA-F06-01` (`R12`), `CF-13` (`F04 -> F06`), `R10` | O check-in do ingresso confirmado `C1` (`CWSNK7D7`) na página `/organizer/events/evt_903be7d3d1c2` retornou `Entrada liberada`, disparou `catraca:checkin-success` atualizando imediatamente o widget e, após reload completo e consulta a `GET /api/organizer/events/evt_903be7d3d1c2/dashboard`, exibiu exatamente `Check-ins: 1` mantendo `Confirmados: 3` e `Receita: R$ 350,00` (e segunda tentativa de check-in de `C1` retornou `422 Ingresso já utilizado` sem alterar a contagem). | **APROVADO** |
| **CT-F06-03** | `CA-F06-01` (`R12`), `R11`, `R10`, `R05`, `CF-14` (`F05 -> F06`) | Em **E3** (`evt_fe5d758c1422`, lotação `5`, `R$ 50,00`) com 1 ingresso `confirmed` (`C6` = `tkt_30b714f44595`, código `APR4DPQ6`) e 1 ingresso `pending` (`tkt_3713db96f553`, cartão `0003`), E3 foi cancelado em `t = +2.629ms` (`< 30s`); a liquidação assíncrona concluiu em `352ms` (`<= 10s`); o check-in de `C6` na API e na UI retornou `Evento cancelado` (`422`, respeitando `R10`); e o painel exibiu `Confirmados: 0`, `Pendentes: 0`, `Check-ins: 0`, `Vagas disponíveis: 0`, `Receita: R$ 0,00` e `Estornados: 1`, permanecendo idêntico após `46.006ms` (após o callback tardio de `0003`). | **APROVADO** |
| **CT-F06-04** | `CF-10` (`F01 -> F06`), `R13` | `GET /api/organizer/events/evt_903be7d3d1c2/dashboard` retornou `401 {"error":"unauthenticated"}` para Visitante (sem sessão ou com Bearer inválido) e `403 {"error":"forbidden"}` para Participante e Organizador B (inclusive em evento cancelado `E3`). Na UI real (`/organizer/events/evt_903be7d3d1c2`), Visitante, Participante e Organizador B receberam tela de bloqueio (`data-view="access-denied"`) sem renderizar `[data-section="event-dashboard"]` e sem expor nome, números ou receita (`R$ 350,00`). | **APROVADO** |

---

## 2. Mapeamento PRD -> Contrato

| Critério no PRD | Regras de Negócio | Itens do Contrato Avaliados | Resultado |
| :--- | :--- | :--- | :--- |
| `CA-F06-01` | `R12`, `R04`, `R05`, `R03` | `CT-F06-01`, `CT-F06-02`, `CT-F06-03` | **APROVADO** |
| `CF-10` (`F01 -> F06`) | `R13` | `CT-F06-04` | **APROVADO** |
| `CF-11` (`F02 -> F06`) | `R03`, `R04`, `R05`, `R12` | `CT-F06-01` | **APROVADO** |
| `CF-12` (`F03 -> F06`) | `R05`, `R08`, `R12` | `CT-F06-01` | **APROVADO** |
| `CF-13` (`F04 -> F06`) | `R10`, `R12` | `CT-F06-02` | **APROVADO** |
| `CF-14` (`F05 -> F06`) | `R05`, `R10`, `R11`, `R12` | `CT-F06-03` | **APROVADO** |

---

## 3. Evidências Empíricas por Item do Contrato

### 3.1. Pré-requisito: Subida do Ambiente Real no Modo Padrão (`npm run up`)

Comando executado na raiz do repositório (`feat/f06-event-dashboard` em `15bba967f45f177a55c68b75e8fc1e6509e7a928`):
```bash
npm run up
```

Containers ativos e variáveis de ambiente verificadas (`docker ps` + `docker exec catraca-app-1 env`):
```text
NAMES           STATUS                        PORTS
catraca-app-1   Up About a minute (healthy)   0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp
catraca-db-1    Up About a minute (healthy)   5432/tcp

AUTH_SECRET=catraca-local-session-secret-2026
DATABASE_URL=postgres://catraca:catraca@db:5432/catraca
NODE_ENV=production
PARTNER_API_KEY=catraca-partner-secret-key
PORT=3000
# Sem GATEWAY_DELAY_MULTIPLIER e sem chaves externas -> janelas reais 2-5s e 30-40s ativas
```

Healthcheck e módulos estáticos da SPA verificados via HTTP:
```text
GET http://localhost:3000/api/health                -> HTTP 200 {"status":"ok"}
GET http://localhost:3000/                          -> HTTP 200 (text/html; charset=UTF-8)
GET http://localhost:3000/views/dashboard-widget.js -> HTTP 200 (application/javascript; charset=UTF-8, 6872 bytes)
GET http://localhost:3000/views/organizer-event.js  -> HTTP 200 (application/javascript; charset=UTF-8, 18048 bytes)
```

---

### 3.2. `CT-F06-01` — Consolidação de Vendas Vitrine + API de Parceiros, Pendentes/Recusados (`0004`), Aumento de Lotação e Receita com Preço Histórico (`R12`, `R03`, `R05`, `CF-11`, `CF-12`)

- **Veredito**: **APROVADO**
- **Ações executadas contra `http://localhost:3000`**:
  1. Autenticado como **Organizador A** (`org.a@catraca.local`), criado o evento **E1** (`Show Painel E1 — Avaliação F06`, `capacity: 2`, `priceCents: 10000` = `R$ 100,00`) -> `evt_903be7d3d1c2`, conferindo o painel em `draft` e logo após publicar (`POST /api/organizer/events/evt_903be7d3d1c2/publish`).
  2. Como **Participante** (`participante@catraca.local`), realizada a 1ª compra na vitrine (`POST /api/events/evt_903be7d3d1c2/purchases`) com cartão `4000000000000001` -> ingresso `C1` (`tkt_aacc98d8268f`, código `CWSNK7D7`), confirmado em `3.383ms`.
  3. Pela **API de Parceiros** (`X-Api-Key: catraca-partner-secret-key`), realizada compra com cartão lento `4000000000000004` -> ingresso `tkt_395f60c8ccbb` (`code: M9APPQ98`, `status: "pending"`). Enquanto pendente:
     - `GET /api/organizer/events/evt_903be7d3d1c2/dashboard` e o DOM real em `/organizer/events/evt_903be7d3d1c2` exibiram `Confirmados: 1`, `Pendentes: 1`, `Vagas disponíveis: 0` e `Receita: R$ 100,00` (pendente ocupa vaga, mas não entra em `Receita`).
     - Tentativa adicional de compra retornou `409 {"error":"sold_out"}`.
  4. Após aguardar **`45.012ms`** reais desde a compra de `0004`, `GET /api/partner/tickets/tkt_395f60c8ccbb` retornou `"status": "declined"`, e tanto a API do painel quanto o navegador headless exibiram `Pendentes: 0` e `Vagas disponíveis: 1` (vaga liberada).
  5. Comprada a 2ª vaga via API de Parceiros com `4000000000000001` -> `tkt_502c6cfa630b` (`code: ZEZHF9XU`), confirmada em `2.361ms` (`Confirmados: 2`, `Vagas disponíveis: 0`, `Receita: R$ 200,00`).
  6. Testada a trava **R03** (`PATCH` com `capacity: 1` -> `409 {"error":"capacity_below_occupied"}`) e, em seguida, alterado o evento E1 via `PATCH /api/organizer/events/evt_903be7d3d1c2` para `capacity: 3` e `priceCents: 15000` (`R$ 150,00`), confirmando que antes da 3ª compra o painel refletiu `Vagas disponíveis: 1` e manteve `Receita: R$ 200,00` (preço histórico preservado).
  7. Realizada a 3ª compra com `4000000000000001` ao novo preço (`R$ 150,00`) -> `tkt_d8d903e98806` (`code: H65BWK2B`), confirmada em `2.322ms`, e auditado o estado final na API, no navegador headless e diretamente via `renderDashboardWidget` (`dashboard-widget.js`).

- **Evidências HTTP, DOM Real e Banco**:
```text
# 1. Criação e publicação de E1 (lotação 2, R$ 100,00 = 10000):
GET /api/organizer/events/evt_903be7d3d1c2/dashboard (draft)     -> HTTP 200 {"eventId":"evt_903be7d3d1c2","status":"draft","confirmed":0,"pending":0,"checkIns":0,"availableSeats":2,"revenueCents":0,"revenueFormatted":"R$ 0,00","refunded":0}
POST /api/organizer/events/evt_903be7d3d1c2/publish              -> HTTP 200 (status: "published", availableSeats: 2)
GET /api/organizer/events/evt_903be7d3d1c2/dashboard (published) -> HTTP 200 {"eventId":"evt_903be7d3d1c2","status":"published","confirmed":0,"pending":0,"checkIns":0,"availableSeats":2,"revenueCents":0,"revenueFormatted":"R$ 0,00","refunded":0}

# 2. 1ª compra na vitrine (cartão 0001 -> confirmado em 3383ms):
POST /api/events/evt_903be7d3d1c2/purchases {"cardNumber":"4000000000000001"} -> HTTP 202 {"ticketId":"tkt_aacc98d8268f","code":"CWSNK7D7","status":"pending"}
GET /api/organizer/events/evt_903be7d3d1c2/dashboard -> HTTP 200 {"eventId":"evt_903be7d3d1c2","status":"published","confirmed":1,"pending":0,"checkIns":0,"availableSeats":1,"revenueCents":10000,"revenueFormatted":"R$ 100,00","refunded":0}

# 3. Compra na API de Parceiros com cartão 0004 (enquanto pending):
POST /api/partner/events/evt_903be7d3d1c2/purchases {"buyerEmail":"pendente.0004@parceiro.local","cardNumber":"4000000000000004"}
-> HTTP 202 {"ticketId":"tkt_395f60c8ccbb","code":"M9APPQ98","status":"pending"}
POST /api/partner/events/evt_903be7d3d1c2/purchases (tentativa extra sem vaga) -> HTTP 409 {"error":"sold_out"}

GET /api/organizer/events/evt_903be7d3d1c2/dashboard (enquanto 0004 está pending) -> HTTP 200
Body: {"eventId":"evt_903be7d3d1c2","status":"published","confirmed":1,"pending":1,"checkIns":0,"availableSeats":0,"revenueCents":10000,"revenueFormatted":"R$ 100,00","refunded":0}

DOM real em /organizer/events/evt_903be7d3d1c2 (enquanto 0004 está pending):
  Labels: ["Confirmados", "Pendentes", "Check-ins", "Vagas disponíveis", "Receita", "Estornados"]
  #dashboard-confirmed="1" | #dashboard-pending="1" | #dashboard-checkins="0" | #dashboard-available-seats="0" | #dashboard-revenue="R$ 100,00" | #dashboard-refunded="0" | #detail-event-capacity="2 / 0"

# 4. Após 45.012ms (recusa assíncrona do cartão 0004):
GET /api/partner/tickets/tkt_395f60c8ccbb -> HTTP 200 {"ticketId":"tkt_395f60c8ccbb","code":"M9APPQ98","eventId":"evt_903be7d3d1c2","status":"declined","checkedIn":false}
GET /api/organizer/events/evt_903be7d3d1c2/dashboard -> HTTP 200
Body: {"eventId":"evt_903be7d3d1c2","status":"published","confirmed":1,"pending":0,"checkIns":0,"availableSeats":1,"revenueCents":10000,"revenueFormatted":"R$ 100,00","refunded":0}
DOM real em /organizer/events/evt_903be7d3d1c2:
  #dashboard-confirmed="1" | #dashboard-pending="0" | #dashboard-available-seats="1" | #dashboard-revenue="R$ 100,00" | #detail-event-capacity="2 / 1"

# 5. 2ª compra confirmada via API de Parceiros com 0001 (R$ 100,00 -> confirmada em 2361ms):
POST /api/partner/events/evt_903be7d3d1c2/purchases -> HTTP 202 {"ticketId":"tkt_502c6cfa630b","code":"ZEZHF9XU","status":"pending"}
GET /api/organizer/events/evt_903be7d3d1c2/dashboard -> HTTP 200 {"eventId":"evt_903be7d3d1c2","status":"published","confirmed":2,"pending":0,"checkIns":0,"availableSeats":0,"revenueCents":20000,"revenueFormatted":"R$ 200,00","refunded":0}

# 6. Validação de trava R03 + edição para lotação 3 e preço R$ 150,00 (15000):
PATCH /api/organizer/events/evt_903be7d3d1c2 {"capacity":1} -> HTTP 409 {"error":"capacity_below_occupied"}
PATCH /api/organizer/events/evt_903be7d3d1c2 {"capacity":3,"priceCents":15000} -> HTTP 200 (capacity: 3, priceCents: 15000, availableSeats: 1)
GET /api/organizer/events/evt_903be7d3d1c2/dashboard (após edição, antes da 3ª compra) -> HTTP 200
Body: {"eventId":"evt_903be7d3d1c2","status":"published","confirmed":2,"pending":0,"checkIns":0,"availableSeats":1,"revenueCents":20000,"revenueFormatted":"R$ 200,00","refunded":0}

# 7. 3ª compra confirmada com 0001 ao novo preço R$ 150,00 (confirmada em 2322ms):
POST /api/partner/events/evt_903be7d3d1c2/purchases -> HTTP 202 {"ticketId":"tkt_d8d903e98806","code":"H65BWK2B","status":"pending"}
GET /api/organizer/events/evt_903be7d3d1c2/dashboard -> HTTP 200
Body: {"eventId":"evt_903be7d3d1c2","status":"published","confirmed":3,"pending":0,"checkIns":0,"availableSeats":0,"revenueCents":35000,"revenueFormatted":"R$ 350,00","refunded":0}

DOM real em /organizer/events/evt_903be7d3d1c2 e módulo dashboard-widget.js:
  #dashboard-confirmed="3"
  #dashboard-pending="0"
  #dashboard-checkins="0"
  #dashboard-available-seats="0"
  #dashboard-revenue="R$ 350,00"
  #dashboard-refunded="0"
  #detail-event-capacity="3 / 0" | #detail-event-price="R$ 150,00"

# Auditoria PostgreSQL dos ingressos de E1 (price_cents histórico congelado por compra):
        id        |   code   | channel  | price_cents |  status   | checked_in
------------------+----------+----------+-------------+-----------+------------
 tkt_aacc98d8268f | CWSNK7D7 | showcase |       10000 | confirmed | f
 tkt_395f60c8ccbb | M9APPQ98 | partner  |       10000 | declined  | f
 tkt_502c6cfa630b | ZEZHF9XU | partner  |       10000 | confirmed | f
 tkt_d8d903e98806 | H65BWK2B | partner  |       15000 | confirmed | f
(4 rows)
```

---

### 3.3. `CT-F06-02` — Check-in de `C1` Incrementando `Check-ins` sem Reduzir `Confirmados` nem Alterar `Receita` (`R12`, `CF-13`)

- **Veredito**: **APROVADO**
- **Ações executadas**:
  1. Na página `/organizer/events/evt_903be7d3d1c2` aberta no navegador headless autenticado como Organizador A, submetido o código `CWSNK7D7` (`C1`) diretamente no formulário `#checkin-form`.
  2. Verificado o feedback `Entrada liberada` e a atualização reativa imediata do painel via evento `catraca:checkin-success`, seguida de recarregamento completo da rota `/organizer/events/evt_903be7d3d1c2` e consulta direta a `GET /api/organizer/events/evt_903be7d3d1c2/dashboard` e `GET /api/partner/tickets/tkt_aacc98d8268f`.
  3. Executada uma segunda tentativa de check-in com `CWSNK7D7`, confirmando rejeição `422` (`Ingresso já utilizado`) sem alterar `Check-ins: 1`.

- **Evidências HTTP e UI**:
```text
# Submissão no formulário #checkin-form em /organizer/events/evt_903be7d3d1c2:
#checkin-feedback -> "Entrada liberada"

# Painel imediatamente após catraca:checkin-success e após reload completo da página:
#dashboard-confirmed="3" | #dashboard-pending="0" | #dashboard-checkins="1" | #dashboard-available-seats="0" | #dashboard-revenue="R$ 350,00" | #dashboard-refunded="0"

# API do painel e API de parceiros:
GET /api/organizer/events/evt_903be7d3d1c2/dashboard -> HTTP 200
Body: {"eventId":"evt_903be7d3d1c2","status":"published","confirmed":3,"pending":0,"checkIns":1,"availableSeats":0,"revenueCents":35000,"revenueFormatted":"R$ 350,00","refunded":0}

GET /api/partner/tickets/tkt_aacc98d8268f -> HTTP 200
Body: {"ticketId":"tkt_aacc98d8268f","code":"CWSNK7D7","eventId":"evt_903be7d3d1c2","status":"confirmed","checkedIn":true}

# Segunda tentativa de check-in do mesmo código C1:
POST /api/organizer/events/evt_903be7d3d1c2/checkin {"code":"CWSNK7D7"} -> HTTP 422
Body: {"allowed":false,"code":"already_used","message":"Ingresso já utilizado"}
```

---

### 3.4. `CT-F06-03` — Cancelamento de E3, Estorno em `<= 10s`, Check-in Retornando `Evento cancelado`, Painel Zerado com `Estornados: 1` e Imunidade após `> 45s` (`R12`, `R11`, `R10`, `CF-14`)

- **Veredito**: **APROVADO**
- **Ações executadas**:
  1. Criado e publicado pelo Organizador A o evento **E3** (`Show Cancelamento Painel E3 — Avaliação F06`, `capacity: 5`, `priceCents: 5000` = `R$ 50,00`) -> `evt_fe5d758c1422`.
  2. Realizada 1 compra via API de Parceiros com cartão lento `4000000000000003` -> `tkt_3713db96f553` (`code: NE5AF2WW`, `status: "pending"`, timer 30–40s) e 1 compra na vitrine com cartão rápido `4000000000000001` -> `C6` (`tkt_30b714f44595`, `code: APR4DPQ6`, confirmado em `2.615ms`). Antes do cancelamento, o painel de E3 exibiu `Confirmados: 1`, `Pendentes: 1`, `Vagas disponíveis: 3`, `Receita: R$ 50,00`, `Estornados: 0`.
  3. Em `t = +2.629ms` (bem antes dos 30s), E3 foi cancelado via `POST /api/organizer/events/evt_fe5d758c1422/cancel`. Em **`352ms`** (`<= 10s`), os ingressos liquidaram para `refunded` (`C6`) e `cancelled` (`0003`).
  4. Tentado o check-in de `C6` (`APR4DPQ6`) em E3 tanto via API quanto via formulário `#checkin-form` na UI de E3, comprovando retorno exato `Evento cancelado` (regra 2 de `R10`), e testado código de outro evento (`CWSNK7D7` de E1) em E3 cancelado, comprovando precedência da regra 1 (`Ingresso inválido para este evento`).
  5. Conferido o painel de E3 na API e no DOM real, exibindo `Confirmados: 0`, `Pendentes: 0`, `Check-ins: 0`, `Vagas disponíveis: 0`, `Receita: R$ 0,00` e `Estornados: 1`.
  6. Adicionalmente, em evento auxiliar **E4** (`evt_a74393a96abb`), realizado check-in de 1 ingresso confirmado (`checkIns: 1`) antes do cancelamento e, após cancelar e estornar, comprovado que `checkIns` passa para `0` quando o ingresso muda de `confirmed` para `refunded` (`R12`).
  7. Aguardados **`46.006ms`** reais desde a compra inicial do cartão `0003` em E3, revalidando API de parceiros, painel e tabela `tickets` no PostgreSQL: nada foi alterado pelo callback tardio do gateway.

- **Evidências HTTP, UI e PostgreSQL**:
```text
# Estado de E3 imediatamente antes do cancelamento:
GET /api/organizer/events/evt_fe5d758c1422/dashboard -> HTTP 200
Body: {"eventId":"evt_fe5d758c1422","status":"published","confirmed":1,"pending":1,"checkIns":0,"availableSeats":3,"revenueCents":5000,"revenueFormatted":"R$ 50,00","refunded":0}

# Cancelamento de E3 em t = +2629ms (< 30s) e liquidação em 352ms (<= 10s):
POST /api/organizer/events/evt_fe5d758c1422/cancel -> HTTP 200 {"id":"evt_fe5d758c1422","status":"cancelled","availableSeats":0}
settleElapsedMs = 352ms

# Check-in pós-cancelamento em E3 (respeitando árvore estrita R10):
POST /api/organizer/events/evt_fe5d758c1422/checkin {"code":"APR4DPQ6"} (C6 de E3) -> HTTP 422
Body: {"allowed":false,"code":"event_cancelled","message":"Evento cancelado"}

POST /api/organizer/events/evt_fe5d758c1422/checkin {"code":"CWSNK7D7"} (ingresso de E1) -> HTTP 422
Body: {"allowed":false,"code":"invalid_ticket","message":"Ingresso inválido para este evento"}

# Painel de E3 após liquidação (API + DOM real em /organizer/events/evt_fe5d758c1422):
GET /api/organizer/events/evt_fe5d758c1422/dashboard -> HTTP 200
Body: {"eventId":"evt_fe5d758c1422","status":"cancelled","confirmed":0,"pending":0,"checkIns":0,"availableSeats":0,"revenueCents":0,"revenueFormatted":"R$ 0,00","refunded":1}

DOM real em /organizer/events/evt_fe5d758c1422:
  #detail-event-status="cancelado" | #detail-event-capacity="5 / 0"
  #dashboard-confirmed="0" | #dashboard-pending="0" | #dashboard-checkins="0" | #dashboard-available-seats="0" | #dashboard-revenue="R$ 0,00" | #dashboard-refunded="1"
  Submissão de APR4DPQ6 em #checkin-form -> #checkin-feedback="Evento cancelado"

# Verificação complementar R12 em E4 (evt_a74393a96abb com check-in prévio antes de cancelar):
Antes de cancelar: {"confirmed":1,"pending":0,"checkIns":1,"availableSeats":1,"revenueCents":4000,"revenueFormatted":"R$ 40,00","refunded":0}
Após cancelar/estornar: {"confirmed":0,"pending":0,"checkIns":0,"availableSeats":0,"revenueCents":0,"revenueFormatted":"R$ 0,00","refunded":1}

# Revalidação de E3 após 46.006ms (após janela 30-40s do cartão 0003):
GET /api/partner/tickets/tkt_3713db96f553 (0003) -> HTTP 200 {"ticketId":"tkt_3713db96f553","code":"NE5AF2WW","eventId":"evt_fe5d758c1422","status":"cancelled","checkedIn":false}
GET /api/partner/tickets/tkt_30b714f44595 (C6)   -> HTTP 200 {"ticketId":"tkt_30b714f44595","code":"APR4DPQ6","eventId":"evt_fe5d758c1422","status":"refunded","checkedIn":false}
GET /api/organizer/events/evt_fe5d758c1422/dashboard -> HTTP 200 {"eventId":"evt_fe5d758c1422","status":"cancelled","confirmed":0,"pending":0,"checkIns":0,"availableSeats":0,"revenueCents":0,"revenueFormatted":"R$ 0,00","refunded":1}

# Auditoria PostgreSQL de E3 após >46s (updated_at inalterado desde a liquidação em +2,9s):
        id        |   code   | channel  | price_cents |  status   | checked_in |          created_at           |          updated_at
------------------+----------+----------+-------------+-----------+------------+-------------------------------+-------------------------------
 tkt_3713db96f553 | NE5AF2WW | partner  |        5000 | cancelled | f          | 2026-11-28 11:17:15.122948+00 | 2026-11-28 11:17:18.055567+00
 tkt_30b714f44595 | APR4DPQ6 | showcase |        5000 | refunded  | f          | 2026-11-28 11:17:15.127205+00 | 2026-11-28 11:17:18.055567+00
(2 rows)
```

---

### 3.5. `CT-F06-04` — Isolamento Estrito dos Dados do Painel por Organizador e Perfil (`R13`, `CF-10`)

- **Veredito**: **APROVADO**
- **Ações executadas**:
  1. Consultada a rota `GET /api/organizer/events/evt_903be7d3d1c2/dashboard` (evento E1 do Organizador A com `Receita: R$ 350,00`, `Confirmados: 3`, `Check-ins: 1`) como **Visitante deslogado**, **Visitante com Bearer inválido**, **Participante** (`participante@catraca.local`) e **Organizador B** (`org.b@catraca.local`), além de Organizador B contra E3 cancelado e Organizador A contra ID inexistente.
  2. Navegado em navegador headless real para `http://localhost:3000/organizer/events/evt_903be7d3d1c2` como **Visitante**, **Participante** e **Organizador B**, inspecionando `data-view`, `data-reason`, ausência de `[data-section="event-dashboard"]` e ausência completa de `350,00` ou do nome `Show Painel E1` no texto renderizado.

- **Evidências HTTP e UI**:
```text
# API do Painel:
GET /api/organizer/events/evt_903be7d3d1c2/dashboard (Visitante sem sessão)  -> HTTP 401 {"error":"unauthenticated"}
GET /api/organizer/events/evt_903be7d3d1c2/dashboard (Bearer inválido)       -> HTTP 401 {"error":"unauthenticated"}
GET /api/organizer/events/evt_903be7d3d1c2/dashboard (Participante)          -> HTTP 403 {"error":"forbidden"}
GET /api/organizer/events/evt_903be7d3d1c2/dashboard (Organizador B em E1)   -> HTTP 403 {"error":"forbidden"}
GET /api/organizer/events/evt_fe5d758c1422/dashboard (Organizador B em E3)   -> HTTP 403 {"error":"forbidden"}
GET /api/organizer/events/evt_inexistente_f06/dashboard (Organizador A)      -> HTTP 404 {"error":"not_found"}
GET /api/organizer/events (Organizador B) -> não contém E1 nem E3 (orgBListContainsOrgAEvents = false)

# Navegador Headless abrindo diretamente /organizer/events/evt_903be7d3d1c2:
- Visitante:
  data-view="access-denied" | data-reason="unauthenticated" | hasDashboardSection=false | leaksRevenue=false | leaksName=false
  Texto visível: "Acesso restrito — Autenticação necessária. Entre na sua conta para continuar."

- Participante (participante@catraca.local):
  data-view="access-denied" | data-reason="forbidden" | hasDashboardSection=false | leaksRevenue=false | leaksName=false
  Texto visível: "Acesso negado — Você não tem permissão para acessar esta página."

- Organizador B (org.b@catraca.local):
  data-view="access-denied" | data-reason="forbidden" | hasDashboardSection=false | leaksRevenue=false | leaksName=false
  Texto visível: "Acesso negado — Você não tem permissão para acessar ou gerenciar este evento."
```

---

## 4. Execução dos Gates de Qualidade (`npm run gates`) e Encerramento (`npm run down`)

Com o ambiente ativo, `npm run gates` foi executado validando artefatos SDD e `project-state.json`, `tsc --noEmit`, migrações + seed idempotente e todas as **8 suítes / 42 testes automatizados** em container PostgreSQL efêmero isolado (`catraca-gates`):

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
ok 1 - Cross-Feature E2E — Jornada Integrada F01..F06 (E1 a E5, CF-01..CF-14, R01..R13) (5 subtests)
ok 2 - F01 — Autenticação, Contas e Controle de Acesso (6 subtests)
ok 3 - F02 — Ciclo de Vida de Eventos e Vitrine Pública (5 subtests)
ok 4 - F03 — Compra de Ingressos, Lotação Concorrente, Gateway Simulado e API de Parceiros (7 subtests)
ok 5 - F04 — Operação de Check-in do Evento (5 subtests)
ok 6 - F05 — Cancelamento Irreversível e Estorno Assíncrono (6 subtests)
ok 7 - F06 — Painel Operacional e Financeiro do Evento (6 subtests)
ok 8 - Harness Base & Seed Idempotency (2 subtests)
# tests 42 | suites 8 | pass 42 | fail 0
[catraca:gates] Todos os gates passaram com sucesso!
```

Em seguida, o ambiente de execução foi encerrado limpamente com `npm run down`:
```text
[catraca:down] Todos os containers e portas do projeto foram encerrados.
```

---

## 5. Conclusão e Veredito Final

Todos os itens verificáveis do contrato (`CT-F06-01`, `CT-F06-02`, `CT-F06-03` e `CT-F06-04`), bem como o critério `CA-F06-01`, os critérios cross-feature `CF-10` (`F01 -> F06`), `CF-11` (`F02 -> F06`), `CF-12` (`F03 -> F06`), `CF-13` (`F04 -> F06`) e `CF-14` (`F05 -> F06`), as regras de negócio `R03`, `R04`, `R05`, `R08`, `R10`, `R11`, `R12` e `R13` e todos os gates de qualidade foram comprovados empiricamente sem qualquer ressalva e sem alteração em código de produção.

**Veredito Final**: **`APROVADO`**
