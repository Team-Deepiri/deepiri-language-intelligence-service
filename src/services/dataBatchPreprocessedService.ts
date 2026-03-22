import { logger } from '../utils/logger';
import { eventPublisher } from '../streaming/eventPublisher';

export interface DataBatchPreprocessedPayload {
  batchId: string;
  datasetId: string;
  userId?: string | null;
  recordCount: number;
  passedQualityCheck: boolean;
  success: boolean;
  executionTime?: number;
  stageName?: string | null;
  error?: string | null;
  processedData?: any[] | null;
  sampleRecords?: any[];
  storageRef?: string | null;
  validationResult?: Record<string, any>;
  qualityMetrics?: Record<string, any>;
}

export class DataBatchPreprocessedService {
  /**
   * Publishes the preprocessed batch event to Redis training-events.
   * Keep payload size small: include sample + storage_ref for large batches.
   */
  async publish(payload: DataBatchPreprocessedPayload): Promise<void> {
    await eventPublisher.publishDataBatchPreprocessed({
      batchId: payload.batchId,
      datasetId: payload.datasetId,
      userId: payload.userId ?? null,
      recordCount: payload.recordCount,
      passedQualityCheck: payload.passedQualityCheck,
      success: payload.success,
      executionTime: payload.executionTime,
      stageName: payload.stageName ?? null,
      error: payload.error ?? null,
      processedData: payload.processedData ?? null,
      sampleRecords: payload.sampleRecords ?? [],
      storageRef: payload.storageRef ?? null,
      validationResult: payload.validationResult ?? {},
      qualityMetrics: payload.qualityMetrics ?? {},
    });

    logger.info('[Language Intelligence] data-batch-preprocessed published.', {
      batchId: payload.batchId,
      datasetId: payload.datasetId,
      recordCount: payload.recordCount,
      passedQualityCheck: payload.passedQualityCheck,
      success: payload.success,
    });
  }
}

export const dataBatchPreprocessedService = new DataBatchPreprocessedService();
