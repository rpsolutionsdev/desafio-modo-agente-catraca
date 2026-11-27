import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireParticipant, requirePartnerApiKey } from '../auth/middleware.js';
import {
  PurchaseDomainError,
  getPartnerTicketById,
  listParticipantTickets,
  purchasePartnerTicket,
  purchaseShowcaseTicket,
} from './service.js';

function handlePurchaseError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof PurchaseDomainError) {
    res.status(err.statusCode).json({ error: err.code });
    return;
  }
  next(err);
}

export const showcasePurchasesRouter = Router();

showcasePurchasesRouter.post(
  '/:eventId/purchases',
  requireParticipant,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await purchaseShowcaseTicket(
        { id: req.user!.id, email: req.user!.email },
        req.params.eventId,
        req.body,
      );
      res.status(202).json(created);
    } catch (err) {
      handlePurchaseError(err, res, next);
    }
  },
);

export const myTicketsRouter = Router();
myTicketsRouter.use(requireParticipant);

myTicketsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tickets = await listParticipantTickets(req.user!.id);
    res.status(200).json(tickets);
  } catch (err) {
    handlePurchaseError(err, res, next);
  }
});

export const partnerPurchasesRouter = Router();
partnerPurchasesRouter.use(requirePartnerApiKey);

partnerPurchasesRouter.post(
  '/events/:eventId/purchases',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await purchasePartnerTicket(req.params.eventId, req.body);
      res.status(202).json(created);
    } catch (err) {
      handlePurchaseError(err, res, next);
    }
  },
);

partnerPurchasesRouter.get(
  '/tickets/:ticketId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ticket = await getPartnerTicketById(req.params.ticketId);
      res.status(200).json(ticket);
    } catch (err) {
      handlePurchaseError(err, res, next);
    }
  },
);
