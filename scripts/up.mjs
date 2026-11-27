import { execSync } from 'node:child_process';
import http from 'node:http';

const port = process.env.PORT || '3000';
const url = `http://localhost:${port}/api/health`;

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

console.log('[catraca:up] Subindo containers (PostgreSQL + App + Migrations + Seed)...');
execSync('docker compose up -d --build --wait', { stdio: 'inherit' });

for (let attempt = 1; attempt <= 20; attempt++) {
  if (await checkHealth()) {
    console.log(`[catraca:up] Produto pronto em http://localhost:${port}`);
    console.log(`[catraca:up] API de Parceiros pronta em http://localhost:${port}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 500));
}

console.error('[catraca:up] Falha ao verificar /api/health após subida.');
process.exit(1);
