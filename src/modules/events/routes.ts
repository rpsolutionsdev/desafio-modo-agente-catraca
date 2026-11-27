import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireOrganizer, requirePartnerApiKey } from '../auth/middleware.js';
import {
  EventDomainError,
  createOrganizerEvent,
  getOrganizerEvent,
  listOrganizerEvents,
  listPartnerEvents,
  listShowcaseEvents,
  publishOrganizerEvent,
  updateOrganizerEvent,
} from './service.js';

function handleEventError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof EventDomainError) {
    res.status(err.statusCode).json({ error: err.code });
    return;
  }
  next(err);
}

export const publicEventsRouter = Router();

publicEventsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const events = await listShowcaseEvents();
    res.status(200).json(events);
  } catch (err) {
    handleEventError(err, res, next);
  }
});

export const organizerEventsRouter = Router();
organizerEventsRouter.use(requireOrganizer);

organizerEventsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const events = await listOrganizerEvents(req.user!.id);
    res.status(200).json(events);
  } catch (err) {
    handleEventError(err, res, next);
  }
});

organizerEventsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const created = await createOrganizerEvent(req.user!.id, req.body);
    res.status(201).json(created);
  } catch (err) {
    handleEventError(err, res, next);
  }
});

organizerEventsRouter.get('/:eventId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = await getOrganizerEvent(req.user!.id, req.params.eventId);
    res.status(200).json(event);
  } catch (err) {
    handleEventError(err, res, next);
  }
});

organizerEventsRouter.patch(
  '/:eventId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateOrganizerEvent(req.user!.id, req.params.eventId, req.body);
      res.status(200).json(updated);
    } catch (err) {
      handleEventError(err, res, next);
    }
  },
);

organizerEventsRouter.post(
  '/:eventId/publish',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const published = await publishOrganizerEvent(req.user!.id, req.params.eventId);
      res.status(200).json(published);
    } catch (err) {
      handleEventError(err, res, next);
    }
  },
);

export const partnerEventsRouter = Router();
partnerEventsRouter.use(requirePartnerApiKey);

partnerEventsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const events = await listPartnerEvents();
    res.status(200).json(events);
  } catch (err) {
    handleEventError(err, res, next);
  }
});
