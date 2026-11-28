# Relatório de Avaliação Independente — F04 (`eval-01`)

- **Feature**: `F04` — Operação de Check-in do Evento (`F04-checkin`)
- **Data da avaliação**: `2026-11-28T07:37:38-03:00`
- **Branch avaliada**: `feat/f04-checkin`
- **Commit avaliado**: `108d2f34f1082301ef5d55321e12dbf82dac84a4` (`108d2f3`)
- **Ferramenta e Modelo**: `Google Antigravity (Subagente feature-evaluator de contexto isolado) — Gemini 4 Carbon (High)`
- **Veredito Final**: **APROVADO**

---

## 1. Resumo Executivo e Tabela de Verificação do Contrato

O ambiente real em containers Docker (`catraca-db-1` + `catraca-app-1`) foi inicializado com `npm run up` na worktree exclusiva `.worktrees/f04` a partir do commit `108d2f34f1082301ef5d55321e12dbf82dac84a4`, operando no modo padrão de produção (`NODE_ENV=production`, sem `GATEWAY_DELAY_MULTIPLIER` e sem chaves externas, com atrasos reais de 2–5s e 30–40s no gateway simulado). Todos os itens `CT-F04-01` a `CT-F04-04` foram exercitados empiricamente por requisições HTTP reais contra `http://localhost:3000`, execução direta dos módulos da SPA servidos pelo container (`/views/organizer-event.js` e `/views/checkin-widget.js`), auditoria SQL direta no PostgreSQL (`catraca-db-1`), rajada concorrente (`Promise.all` de 15 requisições simultâneas de check-in sobre o mesmo ingresso) e execução isolada dos gates (`GATE_PROJECT="catraca-eval-f04" npm run gates`), encerrando o ambiente ao final com `npm run down`.

| Item do Contrato | Critérios PRD / Regras | Descrição Resumida | Veredito |
| :--- | :--- | :--- | :--- |
| **CT-F04-01** | `CA-F04-01` (`R10`), `CF-06` (`F03 -> F04`) | Na gestão de E1 (`evt_e003de990317`, Organizador A), validados tanto via `POST /api/organizer/events/$E1/checkin` quanto pelo widget real `/views/checkin-widget.js` integrado em `/views/organizer-event.js`: (a) 1ª leitura de ingressos confirmados comprados na vitrine (`MNCGJJEN`) e na API de parceiros (`ASLT3J8Y`) -> `200` com `Entrada liberada`; (b) 2ª leitura de ambos -> `422` com `Ingresso já utilizado` (preservando `checked_in_at` original); (c) ingresso pendente com cartão `0004` antes de 30s (`253H7TLA` em `t=+11ms` e `t=+3399ms`) e ingresso recusado com cartão `0002` (`ANQ3CER7`) -> `422` com `Ingresso não confirmado`; (d) código inexistente `ZZZZZZZZ` (e vazio/espaços) -> `422` com `Ingresso inválido para este evento`. | **APROVADO** |
| **CT-F04-02** | `CF-06` (`F03 -> F04`), `R09`, `R10` | Após o check-in de `C1` da vitrine (`tkt_27a7e83714d5`) e de `C1` da API de parceiros (`tkt_598294afd380`), `GET /api/partner/tickets/$T1` retornou `200` com `"status": "confirmed"` e `"checkedIn": true` para ambos os canais; adicionalmente, `GET /api/my-tickets` manteve `"status": "confirmed"` (`"statusLabel": "confirmado"`) com `"checkedIn": true` (check-in separado de status). | **APROVADO** |
| **CT-F04-03** | `CA-F04-01` (`R10`), `CF-05` (`F02 -> F04`) | Ingresso válido confirmado `C3` (`G95NYX6X`, `tkt_19d296342275`) emitido em E2 (`evt_88b745730f94`, Organizador B) e submetido no check-in de E1 (Organizador A) retornou `422` `Ingresso inválido para este evento` sem consumi-lo em E2 (`checkedIn: false`). Em E3 (`evt_a4578849bfd2`) marcado com `status = 'cancelled'` no PostgreSQL, códigos de fora (`ZZZZZZZZ` e `G95NYX6X`) retornaram `422` `Ingresso inválido para este evento` (regra 1 antes da regra 2), enquanto todos os ingressos pertencentes a E3 (`confirmed` virgem, `confirmed` já utilizado, `refunded` já utilizado, `declined` e `pending`) retornaram `422` `Evento cancelado` (regra 2 antes das regras 3 e 4, tanto na API quanto na UI). | **APROVADO** |
| **CT-F04-04** | `R13`, `CF-04` (`F01 -> F04`) | Tentativas de `POST /api/organizer/events/$E1/checkin` com ingresso confirmado válido (`P7XS9UDQ`, `tkt_a14de7c4b6bc`) retornaram `401 {"error":"unauthenticated"}` para visitante deslogado (inclusive com JSON malformado), `403 {"error":"forbidden"}` para Participante (Cookie e Bearer) e `403 {"error":"forbidden"}` para Organizador B (Cookie e Bearer), mantendo `checkedIn: false` e `checked_in_at: NULL` no banco e bloqueando `/organizer/events/$E1` na SPA. Sob rajada concorrente de 15 `POST` simultâneos pelo Organizador A, ocorreram exatamente `1` x `200` (`Entrada liberada`) e `14` x `422` (`Ingresso já utilizado`). | **APROVADO** |

---

## 2. Mapeamento PRD -> Contrato

| Critério no PRD | Regras de Negócio | Itens do Contrato Avaliados | Resultado |
| :--- | :--- | :--- | :--- |
| `CA-F04-01` | `R10` | `CT-F04-01`, `CT-F04-03` | **APROVADO** |
| `CF-04` (`F01 -> F04`) | `R13` | `CT-F04-04` | **APROVADO** |
| `CF-05` (`F02 -> F04`) | `R04`, `R10` | `CT-F04-03` | **APROVADO** |
| `CF-06` (`F03 -> F04`) | `R08`, `R09`, `R10` | `CT-F04-01`, `CT-F04-02` | **APROVADO** |

---

## 3. Evidências Empíricas por Item do Contrato

### 3.1. Pré-requisito: Subida do Ambiente Real e Inspeção de Rotas/Assets (`npm run up`)

Comando executado em `.worktrees/f04`:
```bash
npm run up
```

Containers em execução, variáveis de ambiente e rotas verificadas:
```text
NAMES           STATUS                   PORTS
catraca-app-1   Up 3 minutes (healthy)   0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp
catraca-db-1    Up 3 minutes (healthy)   5432/tcp

NODE_ENV=production
PARTNER_API_KEY=catraca-partner-secret-key
PORT=3000
# Sem GATEWAY_DELAY_MULTIPLIER -> janelas reais do gateway simulado (2-5s e 30-40s) ativas

GET /api/health                 -> HTTP 200 (application/json; charset=utf-8) {"status":"ok"}
GET /organizer/events/evt_check -> HTTP 200 (text/html; charset=UTF-8) bytes=420
GET /views/organizer-event.js   -> HTTP 200 (application/javascript; charset=UTF-8) bytes=15131
GET /views/checkin-widget.js    -> HTTP 200 (application/javascript; charset=UTF-8) bytes=3475
```
Confirmado nos arquivos JS servidos pelo container que `checkin-widget.js` exporta `renderCheckinWidget` e `organizer-event.js` importa `renderCheckinWidget` de `./checkin-widget.js` montando o componente em `#event-checkin-slot`.

---

### 3.2. `CT-F04-01` — Árvore de Decisão do Check-in em E1 (API + Widget Web) (`CA-F04-01`, `R10`, `CF-06`)

- **Veredito**: **APROVADO**
- **Ações executadas contra `http://localhost:3000`**:
  1. Autenticação das contas da seed (`org.a@catraca.local`, `org.b@catraca.local`, `participante@catraca.local`).
  2. Criação e publicação do evento **E1** pelo Organizador A: `evt_e003de990317` (`Show Check-in E1 — Avaliação F04`, `capacity: 10`, `priceCents: 10000`).
  3. Emissão de quatro ingressos em E1:
     - `C1_vitrine` (`tkt_27a7e83714d5`, código `MNCGJJEN`): comprado na vitrine com `4000000000000001` (`confirmed` em `2964ms`).
     - `C1_parceiro` (`tkt_598294afd380`, código `ASLT3J8Y`): comprado via API de parceiros com `4000000000000001` (`confirmed` na mesma janela de 2–5s).
     - `C2_declined` (`tkt_5ad7da15a761`, código `ANQ3CER7`): comprado na vitrine com `4000000000000002` (`declined` em 2–5s).
     - `C2_pending` (`tkt_cb9538d4509e`, código `253H7TLA`): comprado via API de parceiros com cartão lento `4000000000000004` (permanece `pending` entre 0s e 30s).
  4. Submissão de todos os casos `(a)`, `(b)`, `(c)` e `(d)` tanto diretamente em `POST /api/organizer/events/evt_e003de990317/checkin` quanto pelo formulário real renderizado por `renderOrganizerEventView` + `renderCheckinWidget`.

- **Evidências HTTP e Banco de Dados**:
```text
# (c.1) Ingresso pendente (cartão 0004 consultado em t = +7ms e submetido em t = +11ms, antes de 30s):
GET  /api/partner/tickets/tkt_cb9538d4509e -> HTTP 200 {"ticketId":"tkt_cb9538d4509e","code":"253H7TLA","eventId":"evt_e003de990317","status":"pending","checkedIn":false}
POST /api/organizer/events/evt_e003de990317/checkin {"code":"253H7TLA"} -> HTTP 422
Body: {"allowed":false,"code":"not_confirmed","message":"Ingresso não confirmado"}

# (a) 1ª leitura de ingresso confirmado (vitrine: MNCGJJEN):
POST /api/organizer/events/evt_e003de990317/checkin {"code":"MNCGJJEN"} -> HTTP 200
Body: {"allowed":true,"code":"valid","message":"Entrada liberada","ticketId":"tkt_27a7e83714d5"}

# Registro persistido no PostgreSQL após 1ª leitura (status permanece 'confirmed'):
        id        |   code   | channel  |  status   | checked_in |     checked_in_at_iso    
------------------+----------+----------+-----------+------------+--------------------------
 tkt_27a7e83714d5 | MNCGJJEN | showcase | confirmed | t          | 2026-11-28T10:35:04.129Z

# (b) 2ª leitura do mesmo ingresso confirmado (MNCGJJEN):
POST /api/organizer/events/evt_e003de990317/checkin {"code":"MNCGJJEN"} -> HTTP 422
Body: {"allowed":false,"code":"already_used","message":"Ingresso já utilizado"}
# Auditoria SQL após 2ª leitura: checked_in_at permaneceu idêntico (2026-11-28T10:35:04.129Z).

# (c.2) Ingresso recusado após resposta do gateway (cartão 0002: ANQ3CER7):
POST /api/organizer/events/evt_e003de990317/checkin {"code":"ANQ3CER7"} -> HTTP 422
Body: {"allowed":false,"code":"not_confirmed","message":"Ingresso não confirmado"}

# (d) Código inexistente ZZZZZZZZ e entradas vazias/em branco:
POST /api/organizer/events/evt_e003de990317/checkin {"code":"ZZZZZZZZ"} -> HTTP 422 {"allowed":false,"code":"invalid_ticket","message":"Ingresso inválido para este evento"}
POST /api/organizer/events/evt_e003de990317/checkin {"code":""}         -> HTTP 422 {"allowed":false,"code":"invalid_ticket","message":"Ingresso inválido para este evento"}
POST /api/organizer/events/evt_e003de990317/checkin {"code":"   "}      -> HTTP 422 {"allowed":false,"code":"invalid_ticket","message":"Ingresso inválido para este evento"}
POST /api/organizer/events/evt_e003de990317/checkin {}                  -> HTTP 422 {"allowed":false,"code":"invalid_ticket","message":"Ingresso inválido para este evento"}
```

- **Evidência na Interface Web (`/organizer/events/evt_e003de990317` via `organizer-event.js` + `checkin-widget.js`)**:
  - HTML renderizado dentro de `#event-checkin-slot`:
    ```html
    <div class="card" data-section="event-checkin" data-event-id="evt_e003de990317">
      <h2 style="margin-top: 0;">Check-in de ingressos</h2>
      <p style="color: var(--muted); margin-top: 0;">
        Informe o código do ingresso para validar e registrar a entrada do participante.
      </p>
      <div id="checkin-feedback" data-checkin-feedback role="status" aria-live="polite" class="alert" hidden></div>
      <form id="checkin-form" novalidate>
        <label for="checkin-code-input">Código do ingresso</label>
        <input id="checkin-code-input" name="code" type="text" autocomplete="off" placeholder="Ex.: K7Q2M9XA" />
        <button type="submit" id="checkin-submit-btn">Realizar check-in</button>
      </form>
    </div>
    ```
  - Submissões reais pelo formulário `#checkin-form` contra `http://localhost:3000`:
    - `1ª submissão` com `  ASLT3J8Y  ` (`C1_parceiro`) -> `#checkin-feedback` exibiu `Entrada liberada` (`class="alert success"`), limpando `#checkin-code-input` (`value=""`).
    - `2ª submissão` com `ASLT3J8Y` -> `#checkin-feedback` exibiu `Ingresso já utilizado` (`class="alert error"`).
    - Submissão com `253H7TLA` (`C2_pending` em `t = +3399ms`, ainda `pending`) -> `#checkin-feedback` exibiu `Ingresso não confirmado` (`class="alert error"`).
    - Submissão com `ANQ3CER7` (`C2_declined`) -> `#checkin-feedback` exibiu `Ingresso não confirmado` (`class="alert error"`).
    - Submissão com `ZZZZZZZZ` -> `#checkin-feedback` exibiu `Ingresso inválido para este evento` (`class="alert error"`).

---

### 3.3. `CT-F04-02` — Reflexo de `checkedIn: true` e Preservação de `"status": "confirmed"` em `GET /api/partner/tickets/:ticketId` (`CF-06`)

- **Veredito**: **APROVADO**
- **Evidências HTTP observadas após o check-in dos ingressos de ambos os canais**:
```text
# 1. Ingresso comprado pela vitrine (tkt_27a7e83714d5 / MNCGJJEN) consultado na API de Parceiros:
GET /api/partner/tickets/tkt_27a7e83714d5 (X-Api-Key: catraca-partner-secret-key) -> HTTP 200
Body: {"ticketId":"tkt_27a7e83714d5","code":"MNCGJJEN","eventId":"evt_e003de990317","status":"confirmed","checkedIn":true}

# 2. Ingresso comprado pela API de Parceiros (tkt_598294afd380 / ASLT3J8Y) consultado na API de Parceiros:
GET /api/partner/tickets/tkt_598294afd380 (X-Api-Key: catraca-partner-secret-key) -> HTTP 200
Body: {"ticketId":"tkt_598294afd380","code":"ASLT3J8Y","eventId":"evt_e003de990317","status":"confirmed","checkedIn":true}

# 3. Conferência cruzada em "Meus ingressos" (GET /api/my-tickets como participante):
GET /api/my-tickets -> HTTP 200
Item tkt_27a7e83714d5: {"ticketId":"tkt_27a7e83714d5","code":"MNCGJJEN","eventId":"evt_e003de990317","eventName":"Show Check-in E1 — Avaliação F04","priceCents":10000,"status":"confirmed","statusLabel":"confirmado","checkedIn":true,...}
```

---

### 3.4. `CT-F04-03` — Ingresso de Outro Evento (`CF-05`) e Precedência Estrita em Evento Cancelado (`R10`)

- **Veredito**: **APROVADO**
- **Ações executadas**:
  1. Como Organizador B (`org.b@catraca.local`), criação e publicação do evento **E2** (`evt_88b745730f94` — `Workshop E2 Org B — Avaliação F04`) e emissão do ingresso válido confirmado **`C3`** (`tkt_19d296342275`, código `G95NYX6X`).
  2. Submissão de `C3` no check-in de **E1** pelo Organizador A, seguida de consulta a `GET /api/partner/tickets/tkt_19d296342275` e posterior check-in legítimo de `C3` em E2 pelo Organizador B.
  3. Criação e publicação de **E3** (`evt_a4578849bfd2` — `Meetup E3 Cancelado — Avaliação F04`) pelo Organizador A com 5 ingressos cobrindo todas as combinações de estado (`HZEXR6CF` confirmado sem uso, `DB27UGA2` confirmado já utilizado, `89FMDJBY` estornado já utilizado, `J27K9FSN` recusado e `8QTCRL9V` pendente).
  4. Validação da precedência Regra 3 > Regra 4 com E3 ainda publicado (`89FMDJBY` com `status = 'refunded'` e `checked_in = true`) e, em seguida, atualização direta no PostgreSQL `UPDATE events SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = 'evt_a4578849bfd2'` (já que a rota HTTP de cancelamento pertence à worktree paralela `F05`).
  5. Submissão em E3 cancelado de códigos externos/inexistentes (`ZZZZZZZZ` e `G95NYX6X`) e dos 5 ingressos pertencentes a E3, via API e via UI.

- **Evidências HTTP e UI**:
```text
# 1. CF-05 — Ingresso C3 (de E2 / Org B) submetido no check-in de E1 (Org A):
POST /api/organizer/events/evt_e003de990317/checkin {"code":"G95NYX6X"} -> HTTP 422
Body: {"allowed":false,"code":"invalid_ticket","message":"Ingresso inválido para este evento"}

# C3 permaneceu intacto em E2 (checkedIn: false):
GET /api/partner/tickets/tkt_19d296342275 -> HTTP 200 {"ticketId":"tkt_19d296342275","code":"G95NYX6X","eventId":"evt_88b745730f94","status":"confirmed","checkedIn":false}

# 2. Precedência Regra 3 > Regra 4 (em evento publicado, status='refunded' + checked_in=true):
POST /api/organizer/events/evt_a4578849bfd2/checkin {"code":"89FMDJBY"} -> HTTP 422
Body: {"allowed":false,"code":"not_confirmed","message":"Ingresso não confirmado"}

# 3. Após E3 marcado como status = 'cancelled' (GET /api/organizer/events/evt_a4578849bfd2 -> status="cancelled", availableSeats=0):
# Regra 1 ANTES da Regra 2 em evento cancelado:
POST /api/organizer/events/evt_a4578849bfd2/checkin {"code":"ZZZZZZZZ"} -> HTTP 422 {"allowed":false,"code":"invalid_ticket","message":"Ingresso inválido para este evento"}
POST /api/organizer/events/evt_a4578849bfd2/checkin {"code":"G95NYX6X"} -> HTTP 422 {"allowed":false,"code":"invalid_ticket","message":"Ingresso inválido para este evento"}

# Regra 2 ANTES das Regras 3 e 4 em evento cancelado (qualquer ingresso pertencente a E3):
POST /api/organizer/events/evt_a4578849bfd2/checkin {"code":"HZEXR6CF"} (confirmed virgem)         -> HTTP 422 {"allowed":false,"code":"event_cancelled","message":"Evento cancelado"}
POST /api/organizer/events/evt_a4578849bfd2/checkin {"code":"DB27UGA2"} (confirmed já utilizado)   -> HTTP 422 {"allowed":false,"code":"event_cancelled","message":"Evento cancelado"}
POST /api/organizer/events/evt_a4578849bfd2/checkin {"code":"89FMDJBY"} (refunded já utilizado)    -> HTTP 422 {"allowed":false,"code":"event_cancelled","message":"Evento cancelado"}
POST /api/organizer/events/evt_a4578849bfd2/checkin {"code":"J27K9FSN"} (declined)                 -> HTTP 422 {"allowed":false,"code":"event_cancelled","message":"Evento cancelado"}
POST /api/organizer/events/evt_a4578849bfd2/checkin {"code":"8QTCRL9V"} (pending)                  -> HTTP 422 {"allowed":false,"code":"event_cancelled","message":"Evento cancelado"}

# 4. Comportamento da UI de gestão em E3 cancelado (organizer-event.js + checkin-widget.js):
- Botão de edição (#edit-event-submit): disabled = true (edição bloqueada)
- Campo e botão de check-in (#checkin-code-input, #checkin-submit-btn): disabled = false (habilitados para consulta de R10)
- Submissão UI de "ZZZZZZZZ" em E3 cancelado -> #checkin-feedback = "Ingresso inválido para este evento"
- Submissão UI de "HZEXR6CF" em E3 cancelado -> #checkin-feedback = "Evento cancelado"

# 5. Sanity check — Organizador B faz check-in normal de C3 no próprio evento E2:
POST /api/organizer/events/evt_88b745730f94/checkin {"code":"G95NYX6X"} -> HTTP 200 {"allowed":true,"code":"valid","message":"Entrada liberada","ticketId":"tkt_19d296342275"}
```

---

### 3.5. `CT-F04-04` — Controle de Acesso, Isolamento entre Organizadores (`R13`, `CF-04`) e Atomicidade sob Concorrência

- **Veredito**: **APROVADO**
- **Ações executadas**:
  1. Emissão de ingresso confirmado virgem `C4` (`tkt_a14de7c4b6bc`, código `P7XS9UDQ`) em **E1** (Organizador A).
  2. Tentativas de `POST /api/organizer/events/evt_e003de990317/checkin` como Visitante sem autenticação (com JSON válido e com JSON malformado), como Participante (via Cookie e via Bearer) e como Organizador B (via Cookie e via Bearer).
  3. Verificação na API de parceiros, no PostgreSQL e nas guardas da SPA (`/organizer/events/evt_e003de990317`) de que nenhum dado vazou e nenhum check-in foi registrado.
  4. Rajada de 15 requisições `POST` simultâneas (`Promise.all`) pelo Organizador A sobre `P7XS9UDQ` para comprovar o lock transacional `SELECT ... FROM tickets WHERE code = $1 FOR UPDATE`.

- **Evidências HTTP, SQL, UI e Concorrência**:
```text
# 1. Visitante sem autenticação (401 prioritário inclusive sobre parser de JSON):
POST /api/organizer/events/evt_e003de990317/checkin (sem credenciais)               -> HTTP 401 {"error":"unauthenticated"}
POST /api/organizer/events/evt_e003de990317/checkin (sem credenciais, JSON inválido) -> HTTP 401 {"error":"unauthenticated"}

# 2. Participante autenticado:
POST /api/organizer/events/evt_e003de990317/checkin (Cookie participante)            -> HTTP 403 {"error":"forbidden"}
POST /api/organizer/events/evt_e003de990317/checkin (Bearer participante)            -> HTTP 403 {"error":"forbidden"}

# 3. Organizador B tentando operar E1 do Organizador A:
POST /api/organizer/events/evt_e003de990317/checkin (Cookie org.b)                   -> HTTP 403 {"error":"forbidden"}
POST /api/organizer/events/evt_e003de990317/checkin (Bearer org.b)                   -> HTTP 403 {"error":"forbidden"}

# 4. Ingresso C4 permaneceu intocado após todas as tentativas 401/403:
GET /api/partner/tickets/tkt_a14de7c4b6bc -> HTTP 200 {"ticketId":"tkt_a14de7c4b6bc","code":"P7XS9UDQ","eventId":"evt_e003de990317","status":"confirmed","checkedIn":false}

        id        |   code   |  status   | checked_in | checked_in_at 
------------------+----------+-----------+------------+---------------
 tkt_a14de7c4b6bc | P7XS9UDQ | confirmed | f          | 

# 5. Guarda da SPA em /organizer/events/evt_e003de990317:
- Visitante     -> data-view="access-denied", #event-checkin-slot ausente
- Participante  -> data-view="access-denied", #event-checkin-slot ausente
- Organizador B -> data-view="access-denied" (reason="forbidden"), #event-checkin-slot ausente

# 6. Evento inexistente como Organizador A:
POST /api/organizer/events/evt_inexistente_eval_f04/checkin -> HTTP 404 {"error":"not_found"}

# 7. Concorrência atômica (15 POST simultâneos em P7XS9UDQ concluídos em 96ms):
- HTTP 200 ("Entrada liberada"): 1
- HTTP 422 ("Ingresso já utilizado"): 14
```

---

## 4. Execução dos Gates de Qualidade (`npm run gates`) e Encerramento (`npm run down`)

Com `GATE_PROJECT="catraca-eval-f04"`, os gates completos foram executados em container PostgreSQL efêmero isolado (`catraca-eval-f04-db-1`), validando artefatos SDD, `tsc --noEmit`, migrações + seed idempotente e todas as 5 suítes automatizadas (`F01`, `F02`, `F03`, `F04` e `Harness`):

```text
[catraca:gates] Subindo PostgreSQL efêmero isolado (catraca-eval-f04)...
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
ok 4 - F04 — Operação de Check-in do Evento (5 subtests)
ok 5 - Harness Base & Seed Idempotency (2 subtests)
# tests 25 | suites 5 | pass 25 | fail 0
[catraca:gates] Todos os gates passaram com sucesso!
```

Em seguida, o ambiente foi encerrado limpamente com `npm run down`:
```text
[catraca:down] Todos os containers e portas do projeto foram encerrados.
```

---

## 5. Conclusão e Veredito Final

Todos os itens verificáveis do contrato (`CT-F04-01`, `CT-F04-02`, `CT-F04-03` e `CT-F04-04`), bem como o critério `CA-F04-01` (`R10`), os critérios cross-feature `CF-04` (`F01 -> F04`), `CF-05` (`F02 -> F04`) e `CF-06` (`F03 -> F04`), as regras de negócio `R04`, `R08`, `R09`, `R10` e `R13` e todos os gates de qualidade foram comprovados empiricamente sem ressalvas e sem qualquer alteração em código de produção.

**Veredito Final**: **`APROVADO`**
