# Spec — F04: Operação de Check-in do Evento

## 1. Escopo e Decisões Técnicas
- **Autorização e Escopo (R13, R04)**:
  - A operação de check-in é exclusiva do organizador proprietário do evento (`event.organizer_id === req.user.id`), exposta em `POST /api/organizer/events/:eventId/checkin` e renderizada como módulo dedicado na página de gestão `/organizer/events/:eventId`.
- **Árvore de Decisão Estrita e Atômica (R10)**:
  - Dentro de uma transação SQL no PostgreSQL, o evento é lido e o ingresso é buscado pelo `code` informado (`SELECT ... FROM tickets WHERE code = $1 FOR UPDATE`).
  - As verificações seguem **exatamente** a ordem definida em **R10**, retornando a primeira condição verdadeira:
    1. `!ticket || ticket.event_id !== eventId` -> `422` com `message: "Ingresso inválido para este evento"`
    2. `event.status === 'cancelled'` -> `422` com `message: "Evento cancelado"`
    3. `ticket.status !== 'confirmed'` -> `422` com `message: "Ingresso não confirmado"`
    4. `ticket.checked_in === true` -> `422` com `message: "Ingresso já utilizado"`
    5. Caso contrário -> executa `UPDATE tickets SET checked_in = true, checked_in_at = NOW(), updated_at = NOW() WHERE id = $1`, preservando `status = 'confirmed'` (check-in não é status!), e retorna `200` com `message: "Entrada liberada"` e `checkedIn: true`.
- **Comportamento na Interface Web**:
  - O formulário de check-in permanece visível na página de gestão (inclusive após cancelamento, ou acompanhado do aviso de cancelamento), permitindo submeter qualquer código e exibindo em destaque a mensagem exata retornada pelo servidor conforme a prioridade de **R10**.

## 2. Endpoints HTTP
- `POST /api/organizer/events/:eventId/checkin` (`requireOrganizer`):
  - Entrada: `{ "code": "K7Q2M9XA" }`
  - Saída de sucesso (`200`): `{ "allowed": true, "code": "valid", "message": "Entrada liberada", "ticketId": "..." }`
  - Saída de recusa (`422`): `{ "allowed": false, "code": "<reason>", "message": "<mensagem exata de R10>" }`
  - Acesso por não-proprietário / participante / visitante: `403` / `401` (**R13**).
