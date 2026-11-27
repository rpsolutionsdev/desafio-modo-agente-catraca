# Contrato de Avaliação — F02: Ciclo de Vida de Eventos e Vitrine Pública

## 1. Pré-requisitos de Ambiente
- Ambiente rodando em `$WEB=http://localhost:3000` e `$API=http://localhost:3000` com seed carregada (`F01` integrada).
- Credenciais: Organizador A (`org.a@catraca.local` / `OrgA@123`), Organizador B (`org.b@catraca.local` / `OrgB@123`), Participante (`participante@catraca.local` / `Part@123`), `$KEY=catraca-partner-secret-key`.

## 2. Itens Verificáveis

| Item | Verificação (Comando / Ação) | Resultado Observável Esperado |
| :--- | :--- | :--- |
| **CT-F02-01** | Como Organizador A, tentar criar evento com data de ontem, lotação `0` ou preço `0`; depois criar evento válido futuro e tentar editá-lo para data passada. | Todas as datas passadas e valores inválidos são rejeitados (`422` e erro na UI); apenas dados válidos com data futura são aceitos (**R01**). |
| **CT-F02-02** | Como Organizador A, criar evento E1 (lotação 2, R$ 100,00, data futura) sem publicar; consultar vitrine (`/`, `GET /api/events`) e `GET /api/partner/events`; em seguida publicar E1 e consultar novamente. | Enquanto rascunho, E1 não aparece na vitrine nem na API de parceiros; após publicar, E1 aparece na vitrine e em `GET /api/partner/events` com `priceCents: 10000` e `availableSeats: 2` (**R02**, **R05**). |
| **CT-F02-03** | Abrir `/organizer/events/$E1` como Organizador A e editar preço e aumentar lotação. | A URL própria carrega a página de gestão (**R04**) e aceita aumento de lotação e alteração de preço (**R03**). |
| **CT-F02-04** | Como Organizador B, listar eventos em `/organizer` (`GET /api/organizer/events`) e abrir diretamente `/organizer/events/$E1` (`GET /api/organizer/events/$E1`); repetir como Participante e deslogado; testar `GET /api/partner/events` sem `X-Api-Key`. | E1 não aparece na lista de B; abrir o endereço direto de E1 como B, Participante ou Visitante não exibe nenhum dado de E1 (**R13**); `GET /api/partner/events` sem chave retorna `401 {"error":"unauthorized"}` (**CF-01**). |

## 3. Mapeamento PRD -> Contrato

| Critério no PRD | Itens do Contrato |
| :--- | :--- |
| `CA-F02-01` (R01) | `CT-F02-01` |
| `CA-F02-02` (R02) | `CT-F02-02` |
| `CA-F02-03` (R03, base de edição; trava com ocupação validada em `F03`) | `CT-F02-03` |
| `CA-F02-04` (R04) | `CT-F02-03` |
| `CA-F02-05` (R05) | `CT-F02-02` |
| `CA-F02-06` (R13) | `CT-F02-04` |
| `CF-01` (`F01 -> F02`) | `CT-F02-04` |
