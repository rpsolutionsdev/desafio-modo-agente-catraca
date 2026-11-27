# Spec — F06: Painel Operacional e Financeiro do Evento

## 1. Escopo e Decisões Técnicas
- **Consolidação Unificada (R12)**:
  - O painel do evento consolida todas as vendas do evento independentemente do canal (`showcase` e `partner`) diretamente a partir do estado transacional em `events` e `tickets`.
- **Fórmulas Exatas dos Indicadores (R12, R05, R03)**:
  - `confirmed` (**Confirmados**): `COUNT(*) FILTER (WHERE status = 'confirmed')` (inclui ingressos com `checked_in = true` e `false`).
  - `pending` (**Pendentes**): `COUNT(*) FILTER (WHERE status = 'pending')`.
  - `checkIns` (**Check-ins**): `COUNT(*) FILTER (WHERE status = 'confirmed' AND checked_in = true)`. Quando o evento é cancelado e ingressos passam a `refunded`, `checkIns` reflete `0` conforme definição literal de **R12**.
  - `availableSeats` (**Vagas disponíveis**): `0` quando `event.status === 'cancelled'`; caso contrário `capacity - (confirmed + pending)` (**R05**).
  - `revenueCents` (**Receita**): `COALESCE(SUM(price_cents) FILTER (WHERE status = 'confirmed'), 0)`. Soma o `price_cents` vigente e congelado no momento de cada compra (**R03**), excluindo `pending`, `declined`, `cancelled` e `refunded` (estornos jamais entram como receita!). Na interface, formatado como `R$ X,XX` (ex.: `R$ 350,00`, `R$ 0,00`).
  - `refunded` (**Estornados**): `COUNT(*) FILTER (WHERE status = 'refunded')`.
- **Controle de Acesso (R13)**:
  - Disponível exclusivamente em `GET /api/organizer/events/:eventId/dashboard` e na página `/organizer/events/:eventId` para o organizador dono do evento (`event.organizer_id === req.user.id`).

## 2. Endpoints HTTP
- `GET /api/organizer/events/:eventId/dashboard` (`requireOrganizer`):
  - Resposta `200`:
    ```json
    {
      "eventId": "evt_...",
      "status": "published",
      "confirmed": 3,
      "pending": 0,
      "checkIns": 1,
      "availableSeats": 0,
      "revenueCents": 35000,
      "revenueFormatted": "R$ 350,00",
      "refunded": 0
    }
    ```
