import fs from 'node:fs';
import path from 'node:path';

const requiredFiles = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'project-state.json',
  'docs/prd.md',
  'docs/features/F01-auth-access/spec.md',
  'docs/features/F01-auth-access/plan.md',
  'docs/features/F01-auth-access/contract.md',
  'docs/features/F02-events-showcase/spec.md',
  'docs/features/F02-events-showcase/plan.md',
  'docs/features/F02-events-showcase/contract.md',
  'docs/features/F03-purchases-gateway/spec.md',
  'docs/features/F03-purchases-gateway/plan.md',
  'docs/features/F03-purchases-gateway/contract.md',
  'docs/features/F04-checkin/spec.md',
  'docs/features/F04-checkin/plan.md',
  'docs/features/F04-checkin/contract.md',
  'docs/features/F05-cancellation-refunds/spec.md',
  'docs/features/F05-cancellation-refunds/plan.md',
  'docs/features/F05-cancellation-refunds/contract.md',
  'docs/features/F06-event-dashboard/spec.md',
  'docs/features/F06-event-dashboard/plan.md',
  'docs/features/F06-event-dashboard/contract.md',
];

for (const rel of requiredFiles) {
  const full = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(full)) {
    console.error(`[verify-artifacts] Artefato obrigatório ausente: ${rel}`);
    process.exit(1);
  }
}

const state = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'project-state.json'), 'utf8'));
for (const [id, feat] of Object.entries(state.features || {})) {
  if (feat.latestEvaluationReport) {
    const reportPath = path.resolve(process.cwd(), feat.latestEvaluationReport);
    if (!fs.existsSync(reportPath)) {
      console.error(`[verify-artifacts] Relatório listado em project-state.json para ${id} não existe: ${feat.latestEvaluationReport}`);
      process.exit(1);
    }
  }
}

console.log('[verify-artifacts] Artefatos SDD e project-state.json verificados com sucesso.');
