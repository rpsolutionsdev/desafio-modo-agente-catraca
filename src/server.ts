import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import { config } from './shared/config.js';
import { pool } from './db/pool.js';
import {
  attachUser,
  requireOrganizer,
  requirePartnerApiKey,
} from './modules/auth/middleware.js';
import { authRouter } from './modules/auth/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.get('/api/health', async (_req: Request, res: Response) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  // Guardas de segurança aplicados antes do parser de JSON para garantir 401/403 prioritários
  app.use('/api/partner', requirePartnerApiKey);
  app.use(attachUser);
  app.use('/api/organizer', requireOrganizer);

  app.use(express.json());

  app.use('/api/auth', authRouter);

  // Rotas base mínimas protegidas pelos guardas (serão expandidas em F02)
  app.get('/api/organizer/events', (_req: Request, res: Response) => {
    res.status(200).json([]);
  });

  app.get('/api/partner/events', (_req: Request, res: Response) => {
    res.status(200).json([]);
  });

  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Tratamento uniforme de JSON malformado (retorna 422 invalid_request conforme contrato da API)
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(422).json({ error: 'invalid_request' });
      return;
    }
    next(err);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[catraca] Erro inesperado:', err);
    res.status(500).json({ error: 'internal_error' });
  });

  const webDir = path.join(__dirname, 'web');
  app.use(express.static(webDir));

  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(webDir, 'index.html'));
  });

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[catraca] Servidor escutando em http://0.0.0.0:${config.port}`);
  });
}
