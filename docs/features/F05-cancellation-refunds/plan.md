# Plano — F05: Cancelamento Irreversível e Estorno Assíncrono

## Etapas de Implementação
1. **Serviço e Worker de Cancelamento/Estorno (`src/modules/cancellation/service.ts`)**
   - Implementar transição irreversível `published -> cancelled` com `FOR UPDATE`, disparo assíncrono de liquidação (`confirmed -> refunded`, `pending -> cancelled`) e reconciliador periódico (`<= 2s`) garantindo conclusão em muito menos de 10s.
2. **Rota HTTP (`src/modules/cancellation/routes.ts`)**
   - Expor `POST /api/organizer/events/:eventId/cancel` com `requireOrganizer` e verificação de propriedade (**R13**).
3. **Widget de Cancelamento e Bloqueio na Gestão (`src/web/views/cancel-widget.js` e integração em `organizer-event.js`)**
   - Exibir botão de cancelamento para eventos publicados, refletir estado `Cancelado` e bloquear edição/republicação na interface quando `status === 'cancelled'`.
4. **Testes Automatizados (`tests/f05-cancellation-refunds.test.ts`)**
   - Testar saída imediata da vitrine/API, recusa `404 event_not_available` na compra, bloqueio de edição/republicação, transição em até 10s (`confirmed -> refunded`, `pending -> cancelled`), imunidade ao retorno tardio do cartão `0003` (**R11**) e restrição de permissão (**CF-07**, **CF-08**, **CF-09**).
