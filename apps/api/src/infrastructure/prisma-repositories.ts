import type { PrismaClient } from '@prisma/client';
import type { CalculationResponse, ConversationSummary } from '@finguide/contracts';
import { NotFoundError } from '../domain/errors.js';
import type {
  ChatHistoryItem,
  CalculationSummaryScope,
  ConversationRepository,
  FinancialProductRecord,
  ProductRepository,
  StoredMessage,
  VerifiedCalculation,
  VerifiedCalculationSummary
} from '../application/ports.js';

const normalizeProductName = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findActiveByName(name: string): Promise<FinancialProductRecord | null> {
    return this.prisma.financialProduct.findFirst({
      where: { normalizedName: normalizeProductName(name), isActive: true },
      select: { id: true, name: true, type: true, annualInterestRate: true }
    });
  }
}

export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveConversation(requestedId?: string): Promise<string> {
    if (!requestedId) {
      const created = await this.prisma.conversation.create({ data: {}, select: { id: true } });
      return created.id;
    }
    const exists = await this.prisma.conversation.findUnique({ where: { id: requestedId }, select: { id: true } });
    if (!exists) throw new NotFoundError('Conversation not found.');
    return exists.id;
  }

  async appendUserMessage(conversationId: string, content: string): Promise<void> {
    const createdAt = new Date();
    await this.prisma.$transaction([
      this.prisma.message.create({ data: { conversationId, content, role: 'USER', createdAt } }),
      this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: createdAt } }),
      this.prisma.conversation.updateMany({
        where: { id: conversationId, title: null },
        data: { title: content.slice(0, 80) }
      })
    ]);
  }

  async recentMessages(conversationId: string, limit: number): Promise<ChatHistoryItem[]> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { role: true, content: true }
    });
    return messages.reverse().map((message) => ({
      role: message.role === 'ASSISTANT' ? 'ASSISTANT' : 'USER',
      content: message.content
    }));
  }

  async appendAssistantResult(
    conversationId: string,
    content: string,
    calculation: VerifiedCalculation
  ): Promise<{ id: string; createdAt: Date }> {
    return this.prisma.$transaction(async (transaction) => {
      const message = await transaction.message.create({
        data: { conversationId, content, role: 'ASSISTANT' },
        select: { id: true, createdAt: true }
      });
      await transaction.calculation.create({
        data: {
          messageId: message.id,
          productId: calculation.productId,
          type: calculation.type,
          inputs: calculation.inputs,
          result: calculation.result,
          unit: calculation.unit,
          formulaVersion: calculation.formulaVersion
        }
      });
      await transaction.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: message.createdAt }
      });
      return message;
    });
  }

  async appendAssistantError(conversationId: string, content: string): Promise<void> {
    await this.appendAssistantMessage(conversationId, content);
  }

  appendAssistantMessage(conversationId: string, content: string): Promise<{ id: string; createdAt: Date }> {
    return this.prisma.$transaction(async (transaction) => {
      const message = await transaction.message.create({
        data: { conversationId, content, role: 'ASSISTANT' },
        select: { id: true, createdAt: true }
      });
      await transaction.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: message.createdAt }
      });
      return message;
    });
  }

  async listConversations(limit: number): Promise<ConversationSummary[]> {
    const conversations = await this.prisma.conversation.findMany({
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        title: true,
        lastMessageAt: true,
        _count: { select: { messages: true } },
        messages: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { content: true }
        }
      }
    });
    return conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title?.trim() || 'New conversation',
      preview: conversation.messages[0]?.content ?? '',
      messageCount: conversation._count.messages,
      updatedAt: conversation.lastMessageAt.toISOString()
    }));
  }

  async getCalculationSummary(
    conversationId: string,
    scope: CalculationSummaryScope
  ): Promise<VerifiedCalculationSummary> {
    const where = scope === 'CURRENT_CONVERSATION'
      ? { message: { conversationId } }
      : {};
    const grouped = await this.prisma.calculation.groupBy({
      by: ['type'],
      where,
      _count: { _all: true }
    });
    const count = (type: string) => grouped.find((row) => row.type === type)?._count._all ?? 0;
    const compoundInterest = count('COMPOUND_INTEREST');
    const loanPayments = count('LOAN_PAYMENT');
    return {
      kind: 'CALCULATION_SUMMARY',
      scope,
      total: compoundInterest + loanPayments,
      compoundInterest,
      loanPayments
    };
  }

  async getMessages(conversationId: string): Promise<StoredMessage[]> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { calculation: { include: { product: true } } }
        }
      }
    });
    if (!conversation) throw new NotFoundError('Conversation not found.');

    return conversation.messages.map((message) => {
      let calculation: CalculationResponse | null = null;
      if (message.calculation) {
        const inputs = message.calculation.inputs;
        if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) {
          throw new Error('Stored calculation inputs are invalid');
        }
        calculation = {
          type: message.calculation.type === 'COMPOUND_INTEREST' ? 'COMPOUND_INTEREST' : 'LOAN_PAYMENT',
          result: message.calculation.result,
          unit: 'USD',
          inputs: inputs as Record<string, string | number>,
          product: message.calculation.product ? {
            name: message.calculation.product.name,
            annualInterestRate: message.calculation.product.annualInterestRate
          } : null,
          formulaVersion: message.calculation.formulaVersion
        };
      }
      return {
        id: message.id,
        role: message.role === 'ASSISTANT' ? 'ASSISTANT' : 'USER',
        content: message.content,
        createdAt: message.createdAt,
        calculation
      };
    });
  }
}
