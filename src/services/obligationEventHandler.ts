import { StreamEvent } from '@deepiri/shared-utils';
import { logger } from '../utils/logger';

export async function handleObligationCreated(event: StreamEvent): Promise<void> {
  const { obligationId } = event.data as { obligationId: string };
  logger.info('[ObligationEventHandler] obligation-created received', { obligationId });
}

export async function handleObligationUpdated(event: StreamEvent): Promise<void> {
  const { obligationId } = event.data as { obligationId: string };
  logger.info('[ObligationEventHandler] obligation-updated received', { obligationId });
}

export async function handleObligationDeleted(event: StreamEvent): Promise<void> {
  const { obligationId } = event.data as { obligationId: string };
  logger.info('[ObligationEventHandler] obligation-deleted received', { obligationId });
}