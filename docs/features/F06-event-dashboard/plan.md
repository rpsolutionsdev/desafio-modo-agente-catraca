# Plano — F06: Painel Operacional e Financeiro do Evento

## Etapas de Implementação
1. **Serviço de Métricas do Painel (`src/modules/dashboard/service.ts`)**
   - Implementar agregação SQL única sobre `events` e `tickets` aplicando as definições estritas de **R12**, **R05** e **R03** e formatação monetária determinística `R$ X,XX`.
2. **Rota HTTP (`src/modules/dashboard/routes.ts`)**
   - Expor `GET /api/organizer/events/:eventId/dashboard` com `requireOrganizer` e verificação de propriedade (**R13**).
3. **Componente de Painel na Página de Gestão (`src/web/views/dashboard-widget.js` e integração em `organizer-event.js`)**
   - Exibir na página de gestão do evento os seis indicadores rotulados (`Confirmados`, `Pendentes`, `Check-ins`, `Vagas disponíveis`, `Receita`, `Estornados`), atualizando ao recarregar a página ou após ações operacionais na gestão.
4. **Testes Automatizados e Cross-Feature (`tests/f06-event-dashboard.test.ts` e `tests/cross-feature-flow.test.ts`)**
   - Cobrir cálculo de receita com mudança de preço (**CF-11**), mistura de vendas vitrine + API e liberação por recusa (**CF-12**), incremento de `Check-ins` sem alterar `Confirmados` (**CF-13**), estado pós-cancelamento com `Receita R$ 0,00`, `Estornados` e check-in retornando `Evento cancelado` (**CF-14**) e isolamento de acesso (**CF-10**).
