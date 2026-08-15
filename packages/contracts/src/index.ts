import { z } from 'zod';

export const chatRequestSchema = z.object({
  conversationId: z.string().cuid().optional(),
  message: z.string().trim().min(1, 'Message is required').max(2_000, 'Message is too long')
}).strict();

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const calculationTypeSchema = z.enum(['COMPOUND_INTEREST', 'LOAN_PAYMENT']);
export type CalculationType = z.infer<typeof calculationTypeSchema>;

export const calculationResponseSchema = z.object({
  type: calculationTypeSchema,
  result: z.string(),
  unit: z.enum(['USD']),
  inputs: z.record(z.union([z.string(), z.number()])),
  product: z.object({ name: z.string(), annualInterestRate: z.string() }).nullable(),
  formulaVersion: z.string()
});
export type CalculationResponse = z.infer<typeof calculationResponseSchema>;

export const chatResponseSchema = z.object({
  conversationId: z.string(),
  message: z.object({ id: z.string(), role: z.literal('ASSISTANT'), content: z.string(), createdAt: z.string() }),
  calculation: calculationResponseSchema.nullable()
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  preview: z.string(),
  messageCount: z.number().int().nonnegative(),
  updatedAt: z.string()
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema)
});
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

export const historyResponseSchema = z.object({
  conversationId: z.string(),
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(['USER', 'ASSISTANT']),
    content: z.string(),
    createdAt: z.string(),
    calculation: calculationResponseSchema.nullable()
  }))
});
export type HistoryResponse = z.infer<typeof historyResponseSchema>;

export const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() })
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
