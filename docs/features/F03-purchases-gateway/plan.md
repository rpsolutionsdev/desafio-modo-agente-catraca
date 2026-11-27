# Plano — F03: Compra de Ingressos, Lotação Concorrente, Gateway Simulado e API de Parceiros

## Etapas de Implementação
1. **Gateway Simulado (`src/modules/purchases/gateway.ts`)**
   - Implementar regras de sufixo (`0001`, `0002`, `0003`, `0004` e demais) com janelas exatas de atraso no modo padrão e atualização condicional `WHERE t.status = 'pending' AND e.status != 'cancelled'`.
2. **Serviço Transacional de Compras (`src/modules/purchases/service.ts`)**
   - Implementar compra atômica com `SELECT ... FOR UPDATE` em `events`, verificação de status `published`, contagem `pending + confirmed`, geração de `code` único e gravação de `price_cents` histórico.
   - Integrar contagem real de vagas ocupadas na validação de redução de lotação de `F02` (**R03**).
3. **Rotas de Participante e de Parceiros (`src/modules/purchases/routes.ts`)**
   - Implementar `POST /api/events/:eventId/purchases`, `GET /api/my-tickets`, `POST /api/partner/events/:eventId/purchases` (ordem estrita `401 -> 422 -> 404 -> 409 -> 202`) e `GET /api/partner/tickets/:ticketId`.
4. **Interface Web: Compra na Vitrine e "Meus ingressos" (`src/web/views/showcase.js`, `src/web/views/my-tickets.js`)**
   - Adicionar formulário de compra com cartão na vitrine, exibição de `Ingressos esgotados` quando `availableSeats === 0` ou em `409`, e tela `/my-tickets` mostrando evento, rótulo em português do status e código (**R09**).
5. **Testes Automatizados e de Concorrência (`tests/f03-purchases-gateway.test.ts`)**
   - Testar todos os finais de cartão, liberação de vaga em recusa, trava de redução de lotação (**R03**), contrato de erros da API de parceiros e bateria de 30 requisições paralelas simultâneas em múltiplos eventos de lotação 5 (**R07**).
