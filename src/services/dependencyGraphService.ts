import { cyrexClient } from './cyrexClient';

export class DependencyGraphService {
  async findCascadingObligations(obligationId: string, maxDepth: number = 5): Promise<any[]> {
    const cascading = await cyrexClient.findCascadingObligations({
      obligationId,
      maxDepth,
    });

    return cascading.data || [];
  }
}

export const dependencyGraphService = new DependencyGraphService();
