import { execSync } from 'node:child_process';

console.log('[catraca:down] Encerrando ambiente Catraca...');
execSync('docker compose down --remove-orphans', { stdio: 'inherit' });

try {
  execSync('docker compose -p catraca-gates -f docker-compose.gates.yml down -v --remove-orphans', {
    stdio: 'ignore',
  });
} catch {
  // ignora se nao existir stack de gates ativa
}

console.log('[catraca:down] Todos os containers e portas do projeto foram encerrados.');
