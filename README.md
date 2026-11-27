# Catraca — Venda e Operação de Ingressos

MVP construído em modo agente com Spec-Driven Development (SDD), Harness Engineering e avaliação independente por feature.

## Como rodar

### Pré-requisitos
- Docker e Docker Compose
- Git
- Node.js LTS (v20+)

### Comandos principais
- **Subir o ambiente (com banco, migrações e seed automática)**:
  ```bash
  npm run up
  ```
- **Rodar os gates do projeto (typecheck + validação de artefatos + testes automatizados)**:
  ```bash
  npm run gates
  ```
- **Derrubar o ambiente**:
  ```bash
  npm run down
  ```

## Endereços
- **Produto Web (`$WEB`)**: `http://localhost:3000`
- **API e API de Parceiros (`$API`)**: `http://localhost:3000`

## Credenciais e Chave de Parceiro
- **Organizador A**: `org.a@catraca.local` / `OrgA@123`
- **Organizador B**: `org.b@catraca.local` / `OrgB@123`
- **Participante (seed)**: `participante@catraca.local` / `Part@123`
- **Chave da API de Parceiros (`$KEY`)**: `catraca-partner-secret-key`
