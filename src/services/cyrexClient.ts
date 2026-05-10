import axios, { AxiosInstance } from 'axios';
import { config } from '../config/environment';
import { secureLog } from '@team-deepiri/shared-utils';

export type AbstractPipelineId = 'A' | 'B';

export interface FindCascadingObligationsRequest {
  obligationId: string;
  maxDepth?: number;
}

export class CyrexClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.cyrex.baseUrl,
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.cyrex.apiKey,
      },
    });
  }

  /**
   * POST to a pipeline URL configured via CYREX_PIPELINE_A_PATH / CYREX_PIPELINE_B_PATH.
   * Missing pipeline paths are configuration errors; returning an empty stub would
   * incorrectly mark ingestion as successful with no abstractions.
   */
  async runAbstractPipeline(
    pipeline: AbstractPipelineId,
    body: Record<string, unknown>
  ): Promise<any> {
    const path =
      pipeline === 'A' ? config.cyrex.pipelinePathA : config.cyrex.pipelinePathB;
    if (!path || path.trim() === '') {
      secureLog('error', 'Cyrex pipeline path not configured', {
        pipeline,
      });
      throw new Error(`Cyrex pipeline ${pipeline} path is not configured`);
    }
    try {
      secureLog('info', 'Calling Cyrex abstract pipeline', { pipeline });
      const response = await this.client.post(path, body);
      return response.data;
    } catch (error: any) {
      secureLog('error', 'Cyrex abstract pipeline failed', {
        pipeline,
        error: error.message,
      });
      throw new Error(`Abstract pipeline failed: ${error.message}`);
    }
  }

  async findCascadingObligations(request: FindCascadingObligationsRequest): Promise<any> {
    try {
      secureLog('info', 'Calling Cyrex cascade analysis', { obligationId: request.obligationId });
      const response = await this.client.post(
        '/language-intelligence/obligations/find-cascading',
        request
      );
      return response.data;
    } catch (error: any) {
      secureLog('error', 'Cyrex cascade analysis failed', {
        obligationId: request.obligationId,
        error: error.message,
      });
      throw new Error(`Cascade analysis failed: ${error.message}`);
    }
  }
}

export const cyrexClient = new CyrexClient();
