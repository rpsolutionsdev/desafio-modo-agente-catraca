import { execSync } from 'node:child_process';

const gateProject = process.env.GATE_PROJECT || 'catraca-gates';
const composeCmd = `docker compose -p ${gateProject} -f docker-compose.gates.yml`;

console.log(`[catraca:gates] Executando gates em ambiente isolado (${gateProject})...`);

let exitCode = 0;
try {
  execSync(`${composeCmd} up --build --abort-on-container-exit --exit-code-from gates`, {
    stdio: 'inherit',
  });
} catch (err) {
  exitCode = err.status || 1;
} finally {
  try {
    execSync(`${composeCmd} down -v --remove-orphans`, { stdio: 'ignore' });
  } catch {
    // cleanup best-effort
  }
}

if (exitCode !== 0) {
  console.error(`[catraca:gates] Gates reprovados (exit code ${exitCode}).`);
  process.exit(exitCode);
}

console.log('[catraca:gates] Todos os gates passaram com sucesso!');
