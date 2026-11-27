# AGENTS.md — Guia Operacional de Agentes (Catraca)

Este arquivo é a porta de entrada obrigatória para qualquer agente implementador ou avaliador no projeto **Catraca**.

## 1. Comandos do Harness

Todos os comandos abaixo funcionam a partir de um clone limpo (exigindo apenas Docker, Git e Node.js LTS, sem `npm install` prévio no host):

- **Subir ambiente completo (com banco, migrações e seed idempotente)**:
  ```bash
  npm run up
  ```
- **Derrubar ambiente (encerra portas e remove todos os containers do projeto)**:
  ```bash
  npm run down
  ```
- **Rodar gates de qualidade (typecheck + verificação de artefatos + suíte de testes automatizados em container isolado)**:
  ```bash
  npm run gates
  ```
  > Dica para execução em worktrees paralelas: defina `GATE_PROJECT=catraca-wt-<nome> npm run gates` para isolar containers de teste entre branches simultâneas.

## 2. Endereços e Credenciais Padrão

- **Interface Web (`$WEB`)**: `http://localhost:3000`
- **API e API de Parceiros (`$API`)**: `http://localhost:3000`
- **Organizador A (seed)**: `org.a@catraca.local` / `OrgA@123`
- **Organizador B (seed)**: `org.b@catraca.local` / `OrgB@123`
- **Participante (seed)**: `participante@catraca.local` / `Part@123`
- **Chave da API de Parceiros (`$KEY`)**: `catraca-partner-secret-key` (header `X-Api-Key`)

## 3. Regras Inegociáveis do Projeto

1. **Rastreabilidade SDD**: Antes de implementar ou avaliar uma feature, leia `docs/prd.md` e os três documentos da feature em `docs/features/<ID>-<slug>/` (`spec.md`, `plan.md` e `contract.md`).
2. **Integridade entre Features**:
   - Lotação ocupada (`R05`) = ingressos `pending + confirmed`. Em evento `cancelled`, `availableSeats = 0`.
   - Compras concorrentes (`R07`) e redução de lotação (`R03`) **devem** adquirir `SELECT ... FROM events WHERE id = $1 FOR UPDATE` na mesma transação antes de ler/gravar ocupação.
   - O gateway simulado (`R08`) opera no modo padrão sem chaves externas e **só** atualiza ingressos `WHERE t.status = 'pending' AND e.status != 'cancelled'` (`R11`).
   - O painel (`R12`) soma na `Receita` apenas o `price_cents` histórico gravado em cada ingresso com `status = 'confirmed'` (nunca soma `refunded`, `cancelled`, `pending` ou `declined`).
   - Isolamento de organizador (`R13`): um organizador jamais vê nem opera dados de outro organizador (nem na listagem nem pela URL direta `/organizer/events/:eventId`), e participantes/visitantes jamais acessam a área de organizador.
3. **Separação Implementador vs. Avaliador**:
   - Quem implementou uma feature **nunca** a avalia.
   - Cada avaliação deve ser conduzida por um agente independente de contexto limpo contra o `contract.md` da feature, gerando um novo arquivo em `docs/features/<ID>-<slug>/reports/` (ex.: `eval-01.md`).
   - **Imutabilidade de relatórios**: Depois de commitado, um relatório de avaliação **jamais** pode ser editado. Se houver falha, corrige-se o código em novo commit e gera-se um novo relatório (`eval-02.md`).
4. **Atualização de Estado**: O arquivo `project-state.json` na raiz reflete o status real de cada feature e o caminho do relatório de avaliação mais recente.

## 4. Mapa dos Artefatos

- `AGENTS.md` — Este guia operacional (referenciado também por `CLAUDE.md` e `GEMINI.md`).
- `project-state.json` — Estado atual das features e ponteiro para o último relatório de avaliação de cada uma.
- `docs/prd.md` — PRD completo com features (`F01`–`F06`), `Provides`/`Consumes`, grafo de dependências, waves, critérios por feature, critérios cross-feature (`CF-01`–`CF-14`), rastreabilidade `R01`–`R13` e fora de escopo.
- `docs/features/F01-auth-access/` — `spec.md`, `plan.md`, `contract.md` e `reports/`.
- `docs/features/F02-events-showcase/` — `spec.md`, `plan.md`, `contract.md` e `reports/`.
- `docs/features/F03-purchases-gateway/` — `spec.md`, `plan.md`, `contract.md` e `reports/`.
- `docs/features/F04-checkin/` — `spec.md`, `plan.md`, `contract.md` e `reports/`.
- `docs/features/F05-cancellation-refunds/` — `spec.md`, `plan.md`, `contract.md` e `reports/`.
- `docs/features/F06-event-dashboard/` — `spec.md`, `plan.md`, `contract.md` e `reports/`.
- `scripts/up.mjs`, `scripts/down.mjs`, `scripts/gates.mjs` — Scripts de automação do harness.
- `docker-compose.yml` e `docker-compose.gates.yml` — Orquestração do ambiente de execução e dos gates isolados.
