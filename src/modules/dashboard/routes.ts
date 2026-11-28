import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireOrganizer } from '../auth/middleware.js';
import { DashboardDomainError, getOrganizerEventDashboard } from './service.js';

function handleDashboardError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof DashboardDomainError) {
    res.status(err.statusCode).json({ error: err.code });
    return;
  }
  next(err);
}

export const organizerDashboardRouter = Router();
organizerDashboardRouter.use(requireOrganizer);

organizerDashboardRouter.get(
  '/:eventId/dashboard',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dashboard = await getOrganizerEventDashboard(req.user!.id, req.params.eventId);
      res.status(200).json(dashboard);
    } catch (err) {
      handleDashboardError(err, res, next);
    }
  },
);
