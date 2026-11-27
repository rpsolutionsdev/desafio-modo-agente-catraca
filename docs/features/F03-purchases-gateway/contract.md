# Contrato de Avaliação — F03: Compra de Ingressos, Lotação Concorrente, Gateway Simulado e API de Parceiros

## 1. Pré-requisitos de Ambiente
- Ambiente ativo em `$WEB=http://localhost:3000` e `$API=http://localhost:3000` no modo padrão do gateway simulado (sem chaves externas), com `F01` e `F02` integradas.

## 2. Itens Verificáveis

| Item | Verificação (Comando / Ação) | Resultado Observável Esperado |
| :--- | :--- | :--- |
| **CT-F03-01** | Criar conta de participante na UI, comprar evento publicado E1 (lotação 2, R$ 100,00) com cartão `4000000000000001` e abrir "Meus ingressos" imediatamente e após 5s. | Compra responde imediatamente com status `pendente`; em até 5s recarregando "Meus ingressos", exibe nome de E1, status `confirmado` e código único (**R06**, **R08**, **R09**, **CF-02**). |
| **CT-F03-02** | Comprar E1 pela API (`POST /api/partner/events/$E1/purchases`) com cartão `4000000000000004`; antes de 30s tentar nova compra pela API e conferir vitrine; após 45s consultar `GET /api/partner/tickets/$T2` e `GET /api/partner/events`. | Compra retorna `202` com `status: "pending"` e `availableSeats` vai a `0`; antes de 30s nova compra retorna `409 {"error":"sold_out"}` e a vitrine exibe `Ingressos esgotados`; após 45s `$T2` está `declined` e `availableSeats` volta a `1` (**R05**, **R06**, **R07**, **R08**). |
| **CT-F03-03** | Com 2 vagas ocupadas em E1, tentar reduzir lotação para `1` como Organizador A; alterar preço para R$ 150,00 e lotação para `3`; comprar o 3º ingresso com `4000000000000001`. | Reduzir para `1` é rejeitado (`409`); aumentar para `3` e mudar preço para R$ 150,00 é aceito; ingressos anteriores preservam `priceCents: 10000` e apenas a nova compra registra `15000` (**R03**, **CF-03**). |
| **CT-F03-04** | Em duas rodadas independentes (eventos novos E4 e E5 com lotação 5), disparar 30 `POST /api/partner/events/$E/purchases` simultâneos (`-P 30` / paralelo real) com cartão `4000000000000001`. | Em cada uma das duas rodadas, o resultado é exatamente `5` respostas HTTP `202` e `25` respostas HTTP `409`, nunca ultrapassando 5 ingressos ocupados (**R07**). |
| **CT-F03-05** | Testar erros da API de parceiros: sem `X-Api-Key` / chave errada nas rotas de compra e consulta (`401`); `"cardNumber":"123"` ou e-mail inválido (`422 invalid_request`); evento em rascunho ou inexistente (`404 event_not_available`); `GET /api/partner/tickets/inexistente` (`404 ticket_not_found`); e consultar na API um ingresso comprado na vitrine (`200`). | Todos os códigos HTTP e payloads batem exatamente com o contrato fixo da API de parceiros (**CA-F03-02**, **CA-F03-06**, **CF-02**, **CF-03**). |

## 3. Mapeamento PRD -> Contrato

| Critério no PRD | Itens do Contrato |
| :--- | :--- |
| `CA-F03-01` (R06) | `CT-F03-01`, `CT-F03-02` |
| `CA-F03-02` | `CT-F03-05` |
| `CA-F03-03` (R08) | `CT-F03-01`, `CT-F03-02` |
| `CA-F03-04` (R07) | `CT-F03-02`, `CT-F03-04` |
| `CA-F03-05` (R09) | `CT-F03-01` |
| `CA-F03-06` | `CT-F03-02`, `CT-F03-05` |
| `CF-02` (`F01 -> F03`) | `CT-F03-01`, `CT-F03-05` |
| `CF-03` (`F02 -> F03`) | `CT-F03-03`, `CT-F03-05` |
