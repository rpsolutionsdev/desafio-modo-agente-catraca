# Spec — F05: Cancelamento Irreversível e Estorno Assíncrono

## 1. Escopo e Decisões Técnicas
- **Regras de Cancelamento Irreversível (R11, R05)**:
  - Apenas o organizador proprietário (`event.organizer_id === req.user.id`) pode cancelar um evento cujo status atual seja `'published'` (`POST /api/organizer/events/:eventId/cancel`). Eventos em `'draft'` ou já `'cancelled'` retornam `409 {"error":"cannot_cancel_event"}`.
  - Na transação síncrona do cancelamento (`SELECT ... FROM events WHERE id = $1 FOR UPDATE`), o evento passa imediatamente para `status = 'cancelled'` e `cancelled_at = NOW()`.
  - Efeitos imediatos garantidos pelo novo status:
    - O evento deixa de aparecer na vitrine (`GET /api/events` e `/`) e em `GET /api/partner/events` (**R02**, **R11**).
    - `availableSeats` do evento passa a ser `0` (**R05**).
    - Novas tentativas de compra retornam `404 {"error":"event_not_available"}` (**R11**).
    - `PATCH /api/organizer/events/:eventId` e `POST .../publish` bloqueiam edição e republicação (`409`), e a página de gestão desabilita/oculta os controles de edição e publicação (**R11**).
- **Processamento Assíncrono de Ingressos em até 10 Segundos (R11)**:
  - Logo após o commit do cancelamento (em worker assíncrono disparado em `~300ms` + varredura periódica de segurança a cada `2s` para resiliência), executa em transação:
    - `UPDATE tickets SET status = 'refunded', updated_at = NOW() WHERE event_id = $1 AND status = 'confirmed'`
    - `UPDATE tickets SET status = 'cancelled', updated_at = NOW() WHERE event_id = $1 AND status = 'pending'`
  - Assim, todos os ingressos `confirmed` tornam-se `refunded` (`estornado`) e todos os `pending` tornam-se `cancelled` (`cancelado`) bem dentro do limite máximo de 10 segundos.
- **Imunidade a Respostas Tardias do Gateway (R11)**:
  - Como o gateway simulado atualiza apenas linhas `WHERE t.status = 'pending' AND e.status != 'cancelled'`, qualquer resposta tardia (ex.: cartões `0003` ou `0004` respondendo 30–40s após a compra) encontra o evento `cancelled` e o ingresso `cancelled`, mantendo o status intacto.

## 2. Endpoints HTTP
- `POST /api/organizer/events/:eventId/cancel` (`requireOrganizer`):
  - Resposta `200`: `{ "id": "evt_...", "status": "cancelled", "availableSeats": 0 }`
  - Erros: `401` / `403` (acesso indevido — **R13**), `409` (evento não está `published`).
