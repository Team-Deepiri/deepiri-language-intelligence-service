import { streamConsumer } from './streamConsumerService';
import {
  handleDocumentCreated,
  handleDocumentProcessed,
  handleDocumentProcessingError,
} from './documentEventHandler';
import {
  handleObligationCreated,
  handleObligationUpdated,
  handleObligationDeleted,
} from './obligationEventHandler';

export function registerStreamHandlers(): void {
  streamConsumer.register('document-created', handleDocumentCreated);
  streamConsumer.register('document-processed', handleDocumentProcessed);
  streamConsumer.register('document-processing-error', handleDocumentProcessingError);

  streamConsumer.register('obligation-created', handleObligationCreated);
  streamConsumer.register('obligation-updated', handleObligationUpdated);
  streamConsumer.register('obligation-deleted', handleObligationDeleted);
}
