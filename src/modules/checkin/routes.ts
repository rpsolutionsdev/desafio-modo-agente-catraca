import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireOrganizer } from '../auth/middleware.js';
import { CheckinDomainError, performEventCheckin } from './service.js';

function handleCheckinError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof CheckinDomainError) {
    res.status(err.statusCode).json({ error: err.code });
    return;
  }
  next(err);
}

export const organizerCheckinRouter = Router();
organizerCheckinRouter.use(requireOrganizer);

organizerCheckinRouter.post(
  '/:eventId/checkin',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outcome = await performEventCheckin(req.user!.id, req.params.eventId, req.body);
      res.status(outcome.httpStatus).json(outcome.body);
    } catch (err) {
      handleCheckinError(err, res, next);
    }
  },
);
