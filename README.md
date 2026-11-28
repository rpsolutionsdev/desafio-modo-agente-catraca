# Catraca — Venda e Operação de Ingressos

MVP de venda e operação de ingressos para eventos pequenos (shows em bar, workshops e meetups), construído integralmente em **modo agente** com **Spec-Driven Development (SDD)**, **Harness Engineering**, execução em **waves** (incluindo paralelismo real via *git worktrees* e PRs) e **avaliação independente** por subagentes de contexto limpo.

---

## Como rodar

### Pré-requisitos
- **Docker** e **Docker Compose** (`docker compose`)
- **Git**
- **Node.js LTS** (`v20+` com `npm`)

> Nenhum passo manual adicional, variável `.env` ou chave de pagamento externa é necessário. Em um clone limpo, o comando de subida instala dependências se necessário, compila o projeto, sobe o PostgreSQL 16 e a aplicação em containers Docker, aplica as migrações SQL, executa a seed idempotente e aguarda o healthcheck HTTP ficar pronto.

### Comandos principais

- **Subir tudo (a partir de um clone limpo, com seed carregada)**:
  ```bash
  npm run up
  ```
- **Derrubar tudo (encerra portas e remove todos os containers do projeto)**:
  ```bash
  npm run down
  ```
- **Rodar os gates de qualidade (validação de artefatos SDD + `tsc --noEmit` + migrações/seed idempotente + suíte completa de testes automatizados em banco efêmero isolado)**:
  ```bash
  npm run gates
  ```

---

## Endereços

- **Produto Web (`$WEB`)**: `http://localhost:3000`
- **API e API de Parceiros (`$API`)**: `http://localhost:3000`

Exemplo rápido de consulta à API de Parceiros:
```bash
export WEB="http://localhost:3000"
export API="http://localhost:3000"
export KEY="catraca-partner-secret-key"

curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events"
```

---

## Credenciais

Contas garantidas de forma idempotente pela seed (`src/db/seed.ts`):

| Perfil | Nome | E-mail | Senha |
| :--- | :--- | :--- | :--- |
| **Organizador A** | Organizador A | `org.a@catraca.local` | `OrgA@123` |
| **Organizador B** | Organizador B | `org.b@catraca.local` | `OrgB@123` |
| **Participante (seed)** | Participante Seed | `participante@catraca.local` | `Part@123` |

- **Chave da API de Parceiros (`$KEY` — cabeçalho `X-Api-Key`)**:
  ```text
  catraca-partner-secret-key
  ```

---

## Mapa dos artefatos

### Governança, Estado e PRD
- **Porta de entrada de agentes**: [`AGENTS.md`](./AGENTS.md) *(referenciado também por [`CLAUDE.md`](./CLAUDE.md) e [`GEMINI.md`](./GEMINI.md))*
- **Estado do projeto**: [`project-state.json`](./project-state.json)
- **PRD (Features, Provides/Consumes, Grafo, Waves, R01–R13, Cross-Feature e Fora de Escopo)**: [`docs/prd.md`](./docs/prd.md)
- **Scripts do Harness**: [`scripts/up.mjs`](./scripts/up.mjs), [`scripts/down.mjs`](./scripts/down.mjs), [`scripts/gates.mjs`](./scripts/gates.mjs), [`scripts/verify-artifacts.mjs`](./scripts/verify-artifacts.mjs)

### Features (Spec, Plano, Contrato e Relatórios Imutáveis de Avaliação)

| ID | Wave | Pasta da Feature | Spec | Plano | Contrato | Relatório de Avaliação |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| **F01** | Wave 1 | [`docs/features/F01-auth-access/`](./docs/features/F01-auth-access/) | [`spec.md`](./docs/features/F01-auth-access/spec.md) | [`plan.md`](./docs/features/F01-auth-access/plan.md) | [`contract.md`](./docs/features/F01-auth-access/contract.md) | [`reports/eval-01.md`](./docs/features/F01-auth-access/reports/eval-01.md) |
| **F02** | Wave 2 | [`docs/features/F02-events-showcase/`](./docs/features/F02-events-showcase/) | [`spec.md`](./docs/features/F02-events-showcase/spec.md) | [`plan.md`](./docs/features/F02-events-showcase/plan.md) | [`contract.md`](./docs/features/F02-events-showcase/contract.md) | [`reports/eval-01.md`](./docs/features/F02-events-showcase/reports/eval-01.md) |
| **F03** | Wave 3 | [`docs/features/F03-purchases-gateway/`](./docs/features/F03-purchases-gateway/) | [`spec.md`](./docs/features/F03-purchases-gateway/spec.md) | [`plan.md`](./docs/features/F03-purchases-gateway/plan.md) | [`contract.md`](./docs/features/F03-purchases-gateway/contract.md) | [`reports/eval-01.md`](./docs/features/F03-purchases-gateway/reports/eval-01.md) |
| **F04** | **Wave 4 (Paralela)** | [`docs/features/F04-checkin/`](./docs/features/F04-checkin/) | [`spec.md`](./docs/features/F04-checkin/spec.md) | [`plan.md`](./docs/features/F04-checkin/plan.md) | [`contract.md`](./docs/features/F04-checkin/contract.md) | [`reports/eval-01.md`](./docs/features/F04-checkin/reports/eval-01.md) |
| **F05** | **Wave 4 (Paralela)** | [`docs/features/F05-cancellation-refunds/`](./docs/features/F05-cancellation-refunds/) | [`spec.md`](./docs/features/F05-cancellation-refunds/spec.md) | [`plan.md`](./docs/features/F05-cancellation-refunds/plan.md) | [`contract.md`](./docs/features/F05-cancellation-refunds/contract.md) | [`reports/eval-01.md`](./docs/features/F05-cancellation-refunds/reports/eval-01.md) |
| **F06** | Wave 5 | [`docs/features/F06-event-dashboard/`](./docs/features/F06-event-dashboard/) | [`spec.md`](./docs/features/F06-event-dashboard/spec.md) | [`plan.md`](./docs/features/F06-event-dashboard/plan.md) | [`contract.md`](./docs/features/F06-event-dashboard/contract.md) | [`reports/eval-01.md`](./docs/features/F06-event-dashboard/reports/eval-01.md) |

### Pull Requests (Destaque para a Wave 4 Paralela)

- **Wave 4 Paralela — `F04` (`feat/f04-checkin`)**: [PR #4](https://github.com/rpsolutionsdev/desafio-modo-agente-catraca/pull/4)
  - 1º commit (`a0ed4b7`): `2026-11-28T10:13:15Z` | Último commit (`a9ca94b`): `2026-11-28T10:40:22Z`
- **Wave 4 Paralela — `F05` (`feat/f05-cancellation-refunds`)**: [PR #5](https://github.com/rpsolutionsdev/desafio-modo-agente-catraca/pull/5)
  - 1º commit (`e603d95`): `2026-11-28T10:14:27Z` | Último commit (`df477a5`): `2026-11-28T10:43:54Z`
  - *Comprovação de paralelismo*: ambas as features partiram de `b8edafe` em *git worktrees* simultâneas (`.worktrees/f04` e `.worktrees/f05`), com `first_commit(PR #4) < last_commit(PR #5)` (`10:13:15Z < 10:43:54Z`) e `first_commit(PR #5) < last_commit(PR #4)` (`10:14:27Z < 10:40:22Z`), e resolução explícita de conflito de integração em `src/server.ts` e `src/web/views/organizer-event.js`.
- Demais PRs por wave: [PR #1 (Wave 1 — F01)](https://github.com/rpsolutionsdev/desafio-modo-agente-catraca/pull/1), [PR #2 (Wave 2 — F02)](https://github.com/rpsolutionsdev/desafio-modo-agente-catraca/pull/2), [PR #3 (Wave 3 — F03)](https://github.com/rpsolutionsdev/desafio-modo-agente-catraca/pull/3) e [PR #6 (Wave 5 — F06)](https://github.com/rpsolutionsdev/desafio-modo-agente-catraca/pull/6).

---

## Decisões

### 1. Stack escolhida e motivação
- **Backend**: **Node.js 20 LTS + TypeScript + Express + `pg`**, servindo tanto a API REST (interna e de parceiros) quanto os ativos estáticos na porta `3000`. Escolhido por atender nativamente à restrição do ambiente do avaliador (Linux/macOS + Docker + Git + Node.js LTS), sem bibliotecas nativas em C++ e com inicialização rápida.
- **Banco de Dados**: **PostgreSQL 16 (`postgres:16-alpine`) em Docker Compose**, essencial para garantir isolamento transacional ACID, locks pessimistas de linha (`SELECT ... FOR UPDATE`) sob alta concorrência e agregações consistentes com `COUNT/SUM ... FILTER`.
- **Frontend**: **SPA modular em ES Modules nativos** (`src/web/views/*.js`) com roteamento via History API. Evita etapas frágeis de bundlers pesados, permite modularizar cada feature em seu próprio widget (`checkin-widget.js`, `cancel-widget.js`, `dashboard-widget.js`) para desenvolvimento paralelo em worktrees, e nunca renderiza dados no HTML estático antes de validar permissão na API (**R13**).

### 2. Como R07 foi garantida sob concorrência
Para impedir *overselling* mesmo sob dezenas de requisições simultâneas, toda compra (`src/modules/purchases/service.ts`) abre uma transação explícita (`BEGIN`) e executa imediatamente:
```sql
SELECT id, status, capacity, price_cents FROM events WHERE id = $1 FOR UPDATE;
```
Esse lock exclusivo na linha do evento em `events` serializa no próprio PostgreSQL todas as tentativas concorrentes de compra para aquele evento (tanto vindas da vitrine quanto da API de parceiros), além de coordenar com a edição de lotação (`PATCH` em `F02`, impedindo reduzir `capacity` abaixo das vagas ocupadas — **R03**) e com o cancelamento (`POST /cancel` em `F05` — **R11**). Somente dentro do lock é calculada a ocupação atual (`SELECT COUNT(*)::int FROM tickets WHERE event_id = $1 AND status IN ('pending', 'confirmed')`). Quando `occupied >= capacity`, a transação faz rollback e retorna `409 {"error":"sold_out"}`. Em múltiplas baterias de 30 requisições simultâneas sobre eventos com lotação 5, o resultado é invariavelmente **5 respostas `202` e 25 respostas `409`**.

### 3. Como a resposta assíncrona do gateway e a blindagem pós-cancelamento foram implementadas
- Ao criar o ingresso `pending`, a transação faz `COMMIT` e a rota HTTP responde `202` imediatamente em milissegundos (**R06**), agendando fora do ciclo de resposta um timer assíncrono (`src/modules/purchases/gateway.ts`).
- No modo padrão (usado em `npm run up`, sem chaves externas), o simulador respeita os intervalos exatos por final do cartão de 16 dígitos: `0001` aprova em 2–5s; `0002` e outros finais recusam em 2–5s; `0003` aprova em 30–40s; `0004` recusa em 30–40s. (Apenas nos testes rápidos de `gates`, `GATEWAY_DELAY_MULTIPLIER` reduz proporcionalmente a espera).
- Quando o timer dispara, a atualização executa SQL condicional atômico cruzando o estado do ingresso e do evento:
  ```sql
  UPDATE tickets t
     SET status = $2, updated_at = NOW()
    FROM events e
   WHERE t.id = $1
     AND t.event_id = e.id
     AND t.status = 'pending'
     AND e.status != 'cancelled';
  ```
- Quando um evento é cancelado (**R11**), `events.status` vira `'cancelled'` imediatamente na transação síncrona e um worker assíncrono (acompanhado por reconciliador periódico de segurança) converte `confirmed -> refunded` e `pending -> cancelled` em menos de 1 segundo (bem abaixo do teto de 10s). Graças à cláusula `AND t.status = 'pending' AND e.status != 'cancelled'`, respostas tardias do gateway (como cartões `0003` ou `0004` retornando após 30–40s) afetam `0` linhas e jamais alteram o status `cancelled` ou `refunded`.

### 4. Como a avaliação foi isolada do implementador
- Foram definidos dois tipos distintos de subagentes no Google Antigravity (`feature-implementer` e `feature-evaluator`).
- Cada feature (`F01` a `F06`) foi implementada por uma instância dedicada de `feature-implementer` (proibida por prompt de sistema de avaliar o próprio trabalho ou criar arquivos em `reports/`).
- Concluída a implementação na branch/worktree da feature, uma **nova instância limpa de `feature-evaluator`** — com histórico de conversa vazio e sem acesso ao contexto interno do implementador — subiu o ambiente Docker real, exercitou empiricamente cada item verificável `CT-*` do `contract.md` (via chamadas HTTP reais, concorrência, checagem de banco e navegador headless) e gravou um relatório novo e imutável (`eval-01.md`) em commit único dedicado.
