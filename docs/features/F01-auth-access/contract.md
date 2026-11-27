# Contrato de Avaliação — F01: Autenticação, Contas e Controle de Acesso

## 1. Pré-requisitos de Ambiente
- Ambiente iniciado com `node scripts/up.mjs` (ou `npm run up`), respondendo em `$WEB=http://localhost:3000` e `$API=http://localhost:3000`.
- Contas da seed ativas:
  - Organizador A: `org.a@catraca.local` / `OrgA@123`
  - Organizador B: `org.b@catraca.local` / `OrgB@123`
  - Participante Seed: `participante@catraca.local` / `Part@123`
- Chave de parceiro: `$KEY=catraca-partner-secret-key`.

## 2. Itens Verificáveis

| Item | Verificação (Comando / Ação) | Resultado Observável Esperado |
| :--- | :--- | :--- |
| **CT-F01-01** | `POST /api/auth/register` (e fluxo na tela `/register`) com `{ name, email, password }` inéditos; seguido de `GET /api/auth/me` e `POST /api/auth/logout`. | Cadastro retorna `201` com `role: "participant"`, `/api/auth/me` retorna `200` com o usuário logado e, após logout, `/api/auth/me` retorna `401`. |
| **CT-F01-02** | Autenticar via `POST /api/auth/login` com Organizador A, Organizador B e Participante da seed; verificar na UI `/register` que não há opção de criar organizador e que tentar enviar `"role":"organizer"` no payload ainda cria `"participant"`. | Os três logins da seed retornam `200` com seus respectivos papéis; nenhuma rota pública permite criar `organizer`; reexecutar seed mantém contas íntegras sem erro. |
| **CT-F01-03** | Chamar rotas `/api/organizer/*` e abrir `/organizer` deslogado e logado como Participante. | Deslogado recebe `401`; Participante recebe `403`; na interface `/organizer`, nenhum conteúdo interno de organizador é exibido (**R13**). |
| **CT-F01-04** | Chamar `/api/partner/events` sem header `X-Api-Key` e com `X-Api-Key: chave-invalida`. | Ambas respondem status HTTP `401` e corpo JSON exato `{"error":"unauthorized"}`. |

## 3. Mapeamento PRD -> Contrato

| Critério no PRD | Itens do Contrato |
| :--- | :--- |
| `CA-F01-01` | `CT-F01-01` |
| `CA-F01-02` | `CT-F01-02` |
| `CA-F01-03` (R13) | `CT-F01-03` |
| `CA-F01-04` | `CT-F01-04` |
| `CF-01` (`F01 -> F02`, parcial de guarda) | `CT-F01-03`, `CT-F01-04` |
