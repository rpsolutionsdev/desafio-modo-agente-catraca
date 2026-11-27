# Contrato de Avaliação — F04: Operação de Check-in do Evento

## 1. Pré-requisitos de Ambiente
- Ambiente ativo em `$WEB=http://localhost:3000` e `$API=http://localhost:3000` com `F01`, `F02` e `F03` integradas.

## 2. Itens Verificáveis

| Item | Verificação (Comando / Ação) | Resultado Observável Esperado |
| :--- | :--- | :--- |
| **CT-F04-01** | Na gestão de E1 (como Organizador A), submeter no check-in: (a) ingresso confirmado `C1` pela 1ª vez; (b) `C1` pela 2ª vez; (c) ingresso pendente ou recusado `C2`; (d) código inexistente `ZZZZZZZZ`. | Exibe exatamente: (a) `Entrada liberada`; (b) `Ingresso já utilizado`; (c) `Ingresso não confirmado`; (d) `Ingresso inválido para este evento` (**R10**, **CF-06**). |
| **CT-F04-02** |Consultar `GET /api/partner/tickets/$T1` após o check-in de `C1` (incluindo ingresso comprado via API de parceiros). | Retorna `200` com `"status": "confirmed"` e `"checkedIn": true` (**CF-06**). |
| **CT-F04-03** | Emitir ingresso válido `C3` no evento E2 do Organizador B e submetê-lo no check-in de E1 do Organizador A; também submeter ingresso válido de um evento com `status = 'cancelled'`. | `C3` em E1 exibe `Ingresso inválido para este evento` (**CF-05**); ingresso pertencente a evento cancelado exibe `Evento cancelado`, enquanto `ZZZZZZZZ` em evento cancelado ainda exibe `Ingresso inválido para este evento` (respeitando a ordem 1 antes de 2 em **R10**). |
| **CT-F04-04** | Tentar executar `POST /api/organizer/events/$E1/checkin` como Organizador B, como Participante e sem autenticação. | Deslogado recebe `401`; Participante e Organizador B recebem `403` sem realizar check-in (**R13**, **CF-04**). |

## 3. Mapeamento PRD -> Contrato

| Critério no PRD | Itens do Contrato |
| :--- | :--- |
| `CA-F04-01` (R10) | `CT-F04-01`, `CT-F04-03` |
| `CF-04` (`F01 -> F04`) | `CT-F04-04` |
| `CF-05` (`F02 -> F04`) | `CT-F04-03` |
| `CF-06` (`F03 -> F04`) | `CT-F04-01`, `CT-F04-02` |
