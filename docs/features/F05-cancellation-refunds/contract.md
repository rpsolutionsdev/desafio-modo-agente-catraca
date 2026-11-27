# Contrato de Avaliação — F05: Cancelamento Irreversível e Estorno Assíncrono

## 1. Pré-requisitos de Ambiente
- Ambiente ativo em `$WEB=http://localhost:3000` e `$API=http://localhost:3000` no modo padrão do gateway simulado, com `F01`, `F02` e `F03` integradas.

## 2. Itens Verificáveis

| Item | Verificação (Comando / Ação) | Resultado Observável Esperado |
| :--- | :--- | :--- |
| **CT-F05-01** | Criar e publicar evento E3 (lotação 5, R$ 50,00); comprar `$T5` com cartão `4000000000000003` e `$T6` com `4000000000000001`; aguardar `$T6` ficar `confirmed` e, antes de 30s da compra de `$T5`, cancelar E3 pela gestão/API. | E3 sai imediatamente da vitrine e de `GET /api/partner/events`; nova compra em E3 responde `404 {"error":"event_not_available"}`; edição e republicação de E3 ficam bloqueadas na UI e na API (`409`) (**R11**, **R05**, **CF-08**). |
| **CT-F05-02** | Consultar `$T6` e `$T5` em `GET /api/partner/tickets/:id` (e em "Meus ingressos" quando aplicável) em até 10 segundos após o cancelamento de E3. | Em até 10s, `$T6` passa para `"status": "refunded"` (`estornado`) e `$T5` passa para `"status": "cancelled"` (`cancelado`) (**R11**, **CF-09**). |
| **CT-F05-03** | Aguardar completar 45 segundos desde a compra de `$T5` (cartão lento `0003`) e consultar `GET /api/partner/tickets/$T5` novamente. | `$T5` permanece com `"status": "cancelled"`, comprovando que a aprovação tardia do gateway não sobrescreveu o cancelamento (**R11**, **CF-09**). |
| **CT-F05-04** | Tentar cancelar um evento publicado do Organizador A autenticado como Organizador B, como Participante e deslogado. | Deslogado recebe `401`; Participante e Organizador B recebem `403`, e o evento permanece `published` (**R13**, **CF-07**). |

## 3. Mapeamento PRD -> Contrato

| Critério no PRD | Itens do Contrato |
| :--- | :--- |
| `CA-F05-01` (R11, R05) | `CT-F05-01` |
| `CA-F05-02` (R11) | `CT-F05-02` |
| `CA-F05-03` (R11) | `CT-F05-03` |
| `CF-07` (`F01 -> F05`) | `CT-F05-04` |
| `CF-08` (`F02 -> F05`) | `CT-F05-01` |
| `CF-09` (`F03 -> F05`) | `CT-F05-01`, `CT-F05-02`, `CT-F05-03` |
