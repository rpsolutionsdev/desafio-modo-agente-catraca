# Contrato de Avaliação — F06: Painel Operacional e Financeiro do Evento

## 1. Pré-requisitos de Ambiente
- Ambiente ativo em `$WEB=http://localhost:3000` e `$API=http://localhost:3000` com `F01`, `F02`, `F03`, `F04` e `F05` integradas na `main` / branch.

## 2. Itens Verificáveis

| Item | Verificação (Comando / Ação) | Resultado Observável Esperado |
| :--- | :--- | :--- |
| **CT-F06-01** | Em evento E1 (lotação inicial 2, R$ 100,00): realizar 1 compra na vitrine confirmada (`0001`), 1 compra na API pendente (`0004`) que depois recusa, 1 compra na API confirmada (`0001`), alterar preço para R$ 150,00 e lotação para 3, e realizar a 3ª compra confirmada (`0001`). Conferir painel na página de gestão e API. | Enquanto `0004` está pendente, `Pendentes: 1` e `Vagas disponíveis: 0`; após recusa, `Pendentes: 0` e vaga liberada; ao final das 3 compras confirmadas (2x R$ 100 + 1x R$ 150), o painel exibe `Confirmados: 3`, `Pendentes: 0`, `Check-ins: 0`, `Vagas disponíveis: 0`, `Receita: R$ 350,00` e `Estornados: 0` (**R12**, **R03**, **R05**, **CF-11**, **CF-12**). |
| **CT-F06-02** | Realizar check-in do ingresso confirmado `C1` de E1 e recarregar o painel. | Painel passa a exibir `Check-ins: 1` mantendo `Confirmados: 3` e `Receita: R$ 350,00` (**R12**, **CF-13**). |
| **CT-F06-03** | Em evento E3 (R$ 50,00) com 1 ingresso `confirmed` (`C6`) e 1 `pending` (`0003`), cancelar E3, aguardar até 10s, tentar check-in de `C6` e conferir o painel de E3. | Check-in de `C6` retorna `Evento cancelado` (**R10**); painel de E3 exibe `Confirmados: 0`, `Pendentes: 0`, `Check-ins: 0`, `Vagas disponíveis: 0`, `Receita: R$ 0,00` e `Estornados: 1` (**R12**, **R11**, **CF-14**). |
| **CT-F06-04** | Consultar `GET /api/organizer/events/$E1/dashboard` e abrir `/organizer/events/$E1` como Organizador B, Participante e Visitante. | Nenhum dado ou número do painel de E1 é retornado (`403` / `401`) nem exibido na UI (**R13**, **CF-10**). |

## 3. Mapeamento PRD -> Contrato

| Critério no PRD | Itens do Contrato |
| :--- | :--- |
| `CA-F06-01` (R12, R04, R05, R03) | `CT-F06-01`, `CT-F06-02`, `CT-F06-03` |
| `CF-10` (`F01 -> F06`) | `CT-F06-04` |
| `CF-11` (`F02 -> F06`) | `CT-F06-01` |
| `CF-12` (`F03 -> F06`) | `CT-F06-01` |
| `CF-13` (`F04 -> F06`) | `CT-F06-02` |
| `CF-14` (`F05 -> F06`) | `CT-F06-03` |
