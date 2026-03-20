import { streamConsumer } from './streamConsumerService';
import {
  handleLeaseCreated,
  handleLeaseProcessed,
  handleLeaseProcessingError,
} from './leaseEventHandler';
import {
  handleContractCreated,
  handleContractProcessed,
} from './contractEventHandler';
import {
  handleObligationCreated,
  handleObligationUpdated,
  handleObligationDeleted,
} from './obligationEventHandler';

export function registerStreamHandlers(): void {
  streamConsumer.register('lease-created',          handleLeaseCreated);
  streamConsumer.register('lease-processed',        handleLeaseProcessed);
  streamConsumer.register('lease-processing-error', handleLeaseProcessingError);

  streamConsumer.register('contract-created',       handleContractCreated);
  streamConsumer.register('contract-processed',     handleContractProcessed);

  streamConsumer.register('obligation-created',     handleObligationCreated);
  streamConsumer.register('obligation-updated',     handleObligationUpdated);
  streamConsumer.register('obligation-deleted',     handleObligationDeleted);
}