import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireOrganizer } from '../auth/middleware.js';
import { CancellationDomainError, cancelOrganizerEvent } from './service.js';

function handleCancellationError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof CancellationDomainError) {
    res.status(err.statusCode).json({ error: err.code });
    return;
  }
  next(err);
}

export const organizerCancellationRouter = Router();
organizerCancellationRouter.use(requireOrganizer);

organizerCancellationRouter.post(
  '/:eventId/cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await cancelOrganizerEvent(req.user!.id, req.params.eventId);
      res.status(200).json(result);
    } catch (err) {
      handleCancellationError(err, res, next);
    }
  },
);
