import { Router } from 'express';
import { chatRequestSchema } from '@finguide/contracts';
import { z } from 'zod';
import type { ChatService } from '../application/chat-service.js';

export function createChatRouter(service: ChatService): Router {
  const router = Router();
  const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

  router.post('/chat', async (request, response) => {
    const input = chatRequestSchema.parse(request.body);
    const result = await service.send(input.message, input.conversationId);
    response.status(200).json(result);
  });

  router.get('/conversations', async (request, response) => {
    const query = listQuerySchema.parse(request.query);
    response.json(await service.listConversations(query.limit));
  });

  router.get('/conversations/:id/messages', async (request, response) => {
    const conversationId = request.params.id;
    if (!conversationId || !/^c[a-z0-9]{10,}$/i.test(conversationId)) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Invalid conversation ID.', requestId: response.locals.requestId as string }
      });
      return;
    }
    response.json(await service.history(conversationId));
  });

  return router;
}
