# Spec — F02: Ciclo de Vida de Eventos e Vitrine Pública

## 1. Escopo e Decisões Técnicas
- **Ciclo de vida inicial do evento**: Todo evento criado nasce com `status = 'draft'` (**R02**). Apenas eventos com `status = 'published'` aparecem na vitrine (`GET /api/events` e página `/`) e na listagem da API de parceiros (`GET /api/partner/events`).
- **Validação de domínio (R01, R03)**:
  - `name` e `location`: strings não vazias após `trim()`.
  - `startsAt`: ISO-8601 válido estritamente maior que `NOW()` tanto ao criar quanto ao editar (**R01**).
  - `capacity`: inteiro `>= 1` (**R01**). Ao editar, dentro de transação com `SELECT ... FOR UPDATE` na linha do evento, `capacity` não pode ser menor que `occupiedSeats` (`pending + confirmed`) (**R03**, **R05**).
  - `priceCents`: inteiro `> 0` representando centavos de real (**R01**). Alteração de preço afeta apenas o cadastro do evento para compras futuras (**R03**).
- **Isolamento estrito entre organizadores (R13)**:
  - Todas as consultas/mutações em `/api/organizer/events/:eventId*` verificam `event.organizer_id === req.user.id`. Caso pertença a outro organizador (ou não exista), retornam `403 {"error":"forbidden"}` / `404 {"error":"not_found"}` sem retornar nenhum campo do evento.
  - A página `/organizer/events/:eventId` (**R04**) carrega dados exclusivamente via API autenticada; quando aberta por outro organizador, participante ou visitante, exibe mensagem de acesso negado sem renderizar nome, números ou ingressos do evento.

## 2. Modelo de Dados (`events`)
- `id` (`TEXT PRIMARY KEY`, formato `evt_<hex>`)
- `organizer_id` (`TEXT NOT NULL REFERENCES users(id)`)
- `name` (`TEXT NOT NULL`)
- `starts_at` (`TIMESTAMPTZ NOT NULL`)
- `location` (`TEXT NOT NULL`)
- `capacity` (`INTEGER NOT NULL CHECK (capacity >= 1)`)
- `price_cents` (`INTEGER NOT NULL CHECK (price_cents > 0)`)
- `status` (`TEXT NOT NULL CHECK (status IN ('draft', 'published', 'cancelled')) DEFAULT 'draft'`)
- `cancelled_at` (`TIMESTAMPTZ NULL`)
- `created_at` (`TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
- `updated_at` (`TIMESTAMPTZ NOT NULL DEFAULT NOW()`)

## 3. Endpoints HTTP
- `GET /api/organizer/events`: lista apenas eventos do organizador autenticado.
- `POST /api/organizer/events`: cria evento em `draft` (`201`). Rejeita data passada, lotação `< 1` ou preço `<= 0` com `422`.
- `GET /api/organizer/events/:eventId`: retorna detalhes do evento se pertencer ao organizador logado.
- `PATCH /api/organizer/events/:eventId`: edita `name`, `startsAt`, `location`, `capacity`, `priceCents`. Rejeita se `status === 'cancelled'` (`409`), se `startsAt <= NOW()` (`422`), ou se `capacity < occupiedSeats` (`409`).
- `POST /api/organizer/events/:eventId/publish`: muda `draft -> published` (`200`). Rejeita se `status === 'cancelled'` (`409`).
- `GET /api/events`: vitrine pública (apenas `status === 'published'`), incluindo `availableSeats` (**R05**).
- `GET /api/partner/events`: protegido por `requirePartnerApiKey`; retorna `200` com `[{ id, name, startsAt, priceCents, availableSeats }]` apenas para eventos `published`.
