# Plano — F02: Ciclo de Vida de Eventos e Vitrine Pública

## Etapas de Implementação
1. **Serviço de Domínio de Eventos (`src/modules/events/service.ts`)**
   - Implementar validações de **R01**, **R02**, **R03**, **R05** e **R13**, incluindo bloqueio `FOR UPDATE` ao alterar `capacity` e cálculo consistente de `occupiedSeats` e `availableSeats`.
2. **Rotas de Organizador, Vitrine e Parceiros (`src/modules/events/routes.ts`)**
   - Implementar CRUD/publicação em `/api/organizer/events*`, vitrine pública `GET /api/events` e rota de contrato fixo `GET /api/partner/events`.
3. **Interface Web: Vitrine, Lista do Organizador e Página de Gestão (`src/web/views/showcase.js`, `organizer-list.js`, `organizer-event.js`)**
   - Construir vitrine pública (`/`), área do organizador (`/organizer`) com formulário de criação e listagem própria, e página de gestão (`/organizer/events/:eventId` — **R04**) com edição, publicação e pontos de montagem modulares para Check-in (`F04`), Cancelamento (`F05`) e Painel (`F06`).
4. **Testes Automatizados (`tests/f02-events-showcase.test.ts`)**
   - Cobrir validações de data futura ao criar/editar (**R01**), visibilidade de rascunho vs. publicado (**R02**), formato de `GET /api/partner/events` (**R05**) e isolamento completo entre Organizador A, Organizador B, Participante e Visitante (**R13**, **CF-01**).
