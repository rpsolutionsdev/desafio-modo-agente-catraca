import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const gateProject = process.env.GATE_PROJECT || 'catraca-gates';
const composeCmd = `docker compose -p ${gateProject} -f docker-compose.gates.yml`;

if (!fs.existsSync(path.resolve(process.cwd(), 'node_modules/typescript'))) {
  console.log('[catraca:gates] Instalando dependências Node.js...');
  execSync('npm install --no-audit --no-fund', { stdio: 'inherit' });
}

console.log(`[catraca:gates] Subindo PostgreSQL efêmero isolado (${gateProject})...`);
let exitCode = 0;

try {
  execSync(`${composeCmd} up -d --wait db`, { stdio: 'inherit' });

  const portOut = execSync(`${composeCmd} port db 5432`, { encoding: 'utf8' }).trim();
  const hostPort = portOut.split(':').pop();
  if (!hostPort) {
    throw new Error(`Não foi possível obter porta mapeada do Postgres: "${portOut}"`);
  }

  const testEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: `postgres://catraca_test:catraca_test@127.0.0.1:${hostPort}/catraca_test`,
    AUTH_SECRET: 'catraca-test-secret',
    PARTNER_API_KEY: 'catraca-partner-secret-key',
    GATEWAY_DELAY_MULTIPLIER: process.env.GATEWAY_DELAY_MULTIPLIER || '0.05',
  };

  console.log('[catraca:gates] 1/4 Verificando artefatos SDD e project-state.json...');
  execSync('node scripts/verify-artifacts.mjs', { stdio: 'inherit', env: testEnv });

  console.log('[catraca:gates] 2/4 Executando typecheck (tsc --noEmit)...');
  execSync('npm run typecheck', { stdio: 'inherit', env: testEnv });

  console.log('[catraca:gates] 3/4 Validando migrações e seed idempotente...');
  execSync('npx tsx src/db/migrate.ts && npx tsx src/db/seed.ts && npx tsx src/db/seed.ts', {
    stdio: 'inherit',
    env: testEnv,
  });

  console.log('[catraca:gates] 4/4 Executando suíte de testes automatizados...');
  const testFiles = fs
    .readdirSync(path.resolve(process.cwd(), 'tests'))
    .filter((f) => f.endsWith('.test.ts'))
    .sort()
    .map((f) => `tests/${f}`)
    .join(' ');
  execSync(`npx tsx --test ${testFiles}`, { stdio: 'inherit', env: testEnv });
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
