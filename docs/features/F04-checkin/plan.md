# Plano — F04: Operação de Check-in do Evento

## Etapas de Implementação
1. **Serviço de Check-in (`src/modules/checkin/service.ts`)**
   - Implementar validação de propriedade do evento (**R13**) e execução transacional (`FOR UPDATE`) das 5 condições ordenadas de **R10**, atualizando `checked_in = true` sem alterar `status`.
2. **Rota HTTP (`src/modules/checkin/routes.ts`)**
   - Registrar `POST /api/organizer/events/:eventId/checkin` protegido por `requireOrganizer`.
3. **Widget de Check-in na Página de Gestão (`src/web/views/checkin-widget.js`)**
   - Implementar formulário de código de ingresso e área de feedback exibindo a mensagem literal de **R10**, integrando o recarregamento do resumo do evento após check-in aprovado.
4. **Testes Automatizados (`tests/f04-checkin.test.ts`)**
   - Testar cada uma das 5 mensagens de **R10** (código inexistente, código de outro evento, evento cancelado, ingresso pendente/recusado, ingresso já utilizado e entrada liberada), reflexo de `checkedIn: true` em `GET /api/partner/tickets/:ticketId` (**CF-06**) e bloqueio de acesso para outro organizador/participante/visitante (**CF-04**, **CF-05**).
