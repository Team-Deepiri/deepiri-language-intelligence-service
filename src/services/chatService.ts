import { prisma } from '../db';
import { logger } from '../utils/logger';
import type { ChatSession, Message } from '@prisma/client';

export interface CreateChatSessionInput {
  userId: string;
  contextId?: string;
  contextType?: string;
  title?: string;
}

export interface CreateMessageInput {
  chatSessionId: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSessionWithMessages extends ChatSession {
  messages: Message[];
}

export class ChatService {
  /**
   * Create a new chat session
   */
  async createChatSession(input: CreateChatSessionInput): Promise<ChatSession> {
    // @ts-expect-error - Prisma types will exist after migration runs
    const session = await prisma.chatSession.create({
      data: {
        userId: input.userId,
        contextId: input.contextId,
        contextType: input.contextType,
        title: input.title || 'New Conversation',
      },
    });

    logger.info('Chat session created', { sessionId: session.id, userId: input.userId });
    return session;
  }

  /**
   * Get chat session by ID with messages
   */
  async getChatSession(sessionId: string, userId: string): Promise<ChatSessionWithMessages | null> {
    // @ts-expect-error - Prisma types will exist after migration runs
    const session = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId: userId,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!session) {
      logger.warn('Chat session not found or unauthorized', { sessionId, userId });
      return null;
    }

    return session;
  }

  /**
   * Get all chat sessions for a user
   */
  async getUserChatSessions(
    userId: string,
    contextId?: string,
    contextType?: string
  ): Promise<ChatSession[]> {
    const where: any = { userId };
    if (contextId) where.contextId = contextId;
    if (contextType) where.contextType = contextType;

    // @ts-expect-error - Prisma types will exist after migration runs
    const sessions = await prisma.chatSession.findMany({
      where,
      orderBy: {
        updatedAt: 'desc',
      },
    });

    logger.info('User chat sessions retrieved', { userId, count: sessions.length });
    return sessions;
  }

  /**
   * Add a message to a chat session
   */
  async addMessage(input: CreateMessageInput): Promise<Message> {
    // Verify session exists
    // @ts-expect-error - Prisma types will exist after migration runs
    const sessionExists = await prisma.chatSession.findUnique({
      where: { id: input.chatSessionId },
    });

    if (!sessionExists) {
      throw new Error('Chat session not found');
    }

    // @ts-expect-error - Prisma types will exist after migration runs
    const message = await prisma.message.create({
      data: {
        chatSessionId: input.chatSessionId,
        role: input.role,
        content: input.content,
      },
    });

    // Update session timestamp
    // @ts-expect-error - Prisma types will exist after migration runs
    await prisma.chatSession.update({
      where: { id: input.chatSessionId },
      data: { updatedAt: new Date() },
    });

    logger.info('Message added to chat session', { messageId: message.id, sessionId: input.chatSessionId });
    return message;
  }

  /**
   * Delete a chat session
   */
  async deleteChatSession(sessionId: string, userId: string): Promise<boolean> {
    // @ts-expect-error - Prisma types will exist after migration runs
    const result = await prisma.chatSession.deleteMany({
      where: {
        id: sessionId,
        userId: userId,
      },
    });

    if (result.count === 0) {
      logger.warn('Chat session not found or unauthorized for deletion', { sessionId, userId });
      return false;
    }

    logger.info('Chat session deleted', { sessionId, userId });
    return true;
  }

  /**
   * Update chat session title
   */
  async updateChatSessionTitle(sessionId: string, userId: string, title: string): Promise<ChatSession | null> {
    // @ts-expect-error - Prisma types will exist after migration runs
    const updated = await prisma.chatSession.updateMany({
      where: {
        id: sessionId,
        userId: userId,
      },
      data: {
        title,
      },
    });

    if (updated.count === 0) {
      logger.warn('Chat session not found or unauthorized for update', { sessionId, userId });
      return null;
    }

    // @ts-expect-error - Prisma types will exist after migration runs
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    logger.info('Chat session title updated', { sessionId, title });
    return session;
  }
}

export const chatService = new ChatService();