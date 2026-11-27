# Spec — F03: Compra de Ingressos, Lotação Concorrente, Gateway Simulado e API de Parceiros

## 1. Escopo e Decisões Técnicas
- **Controle de Concorrência (R07)**:
  - Toda compra abre transação explícita no PostgreSQL e executa `SELECT id, status, capacity, price_cents FROM events WHERE id = $1 FOR UPDATE`.
  - O lock exclusivo de linha no evento serializa todas as tentativas simultâneas de compra (tanto da vitrine quanto da API de parceiros) e edições de lotação (**R03**).
  - Dentro do lock, calcula-se `SELECT COUNT(*)::int FROM tickets WHERE event_id = $1 AND status IN ('pending', 'confirmed')`. Se `occupied >= capacity`, a transação faz rollback e responde `409 {"error":"sold_out"}` (e na vitrine exibe `Ingressos esgotados`).
  - Caso haja vaga, insere 1 ingresso com `status = 'pending'`, `price_cents = event.price_cents` vigente (**R03**), `code` único de 8 caracteres alfanuméricos maiúsculos (`[A-Z0-9]{8}`), faz `COMMIT` e responde imediatamente `202` sem esperar o gateway (**R06**).
- **Ordem de Validação na API de Parceiros (`POST /api/partner/events/:eventId/purchases`)**:
  1. `X-Api-Key` ausente/inválida -> `401 {"error":"unauthorized"}`
  2. Corpo inválido (JSON malformado, `buyerEmail` ausente/malformado ou `cardNumber` diferente de `/^\d{16}$/`) -> `422 {"error":"invalid_request"}` (antes de criar ingresso!)
  3. Evento inexistente, `draft` ou `cancelled` -> `404 {"error":"event_not_available"}`
  4. Sem vaga disponível (`occupied >= capacity`) -> `409 {"error":"sold_out"}`
  5. Sucesso -> `202 { "ticketId": "tkt_...", "code": "...", "status": "pending" }`
- **Gateway de Pagamento Simulado Assíncrono (R08)**:
  - Disparado de forma assíncrona após o `COMMIT` da compra, sem exigir nenhuma chave externa:
    - Final `0001`: aprova (`confirmed`), atraso entre 2s e 5s (`2100..3800ms`).
    - Final `0002`: recusa (`declined`), atraso entre 2s e 5s (`2100..3800ms`).
    - Final `0003`: aprova (`confirmed`), atraso entre 30s e 40s (`31000..37000ms`).
    - Final `0004`: recusa (`declined`), atraso entre 30s e 40s (`31000..37000ms`).
    - Qualquer outro final: recusa (`declined`), atraso entre 2s e 5s (`2100..3800ms`).
  - A transição executa `UPDATE tickets t SET status = $2, updated_at = NOW() FROM events e WHERE t.id = $1 AND t.event_id = e.id AND t.status = 'pending' AND e.status != 'cancelled'`, garantindo desde a origem que cancelamentos de evento (**R11**) jamais sejam sobrescritos.

## 2. Modelo de Dados (`tickets`)
- `id` (`TEXT PRIMARY KEY`, formato `tkt_<hex>`)
- `code` (`TEXT NOT NULL UNIQUE`, 8 caracteres `[A-Z0-9]`)
- `event_id` (`TEXT NOT NULL REFERENCES events(id)`)
- `participant_id` (`TEXT NULL REFERENCES users(id)`)
- `buyer_email` (`TEXT NOT NULL`)
- `channel` (`TEXT NOT NULL CHECK (channel IN ('showcase', 'partner'))`)
- `price_cents` (`INTEGER NOT NULL CHECK (price_cents > 0)`)
- `status` (`TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'refunded'))`)
- `checked_in` (`BOOLEAN NOT NULL DEFAULT FALSE`)
- `checked_in_at` (`TIMESTAMPTZ NULL`)
- `created_at` (`TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
- `updated_at` (`TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
- Índice: `CREATE INDEX idx_tickets_event_status ON tickets(event_id, status)`.

## 3. Endpoints Adicionais
- `POST /api/events/:eventId/purchases` (`requireParticipant`): compra pela vitrine (`{ cardNumber }`), responde `202 { ticketId, code, status: "pending" }`.
- `GET /api/my-tickets` (`requireParticipant`): retorna ingressos do participante logado com evento, `code`, `status` e rótulo em português (`pendente`, `confirmado`, `recusado`, `cancelado`, `estornado` — **R09**).
- `GET /api/partner/tickets/:ticketId` (`requirePartnerApiKey`): retorna `200 { ticketId, code, eventId, status, checkedIn }` para qualquer canal ou `404 {"error":"ticket_not_found"}`.
