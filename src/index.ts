import app from './server';
import { config } from './config/environment';
import { logger } from './utils/logger';
import { initializeEventPublisher } from './streaming/eventPublisher';
import { initializeDocumentRoutePublisher } from './streaming/documentRoutePublisher';

async function startServer() {
  try {
    await initializeEventPublisher();
    // Soft-init document bus publisher (Redis fallback). Sugar Glider is probed per publish.
    try {
      await initializeDocumentRoutePublisher();
    } catch (err: any) {
      logger.warn('Document route publisher Redis init deferred', { error: err?.message });
    }

    app.listen(config.port, () => {
      logger.info(`Language Intelligence Service started on port ${config.port}`, {
        synapseTransport: config.synapse.transport,
        sugarGliderUrl: config.synapse.sugarGliderUrl,
      });
    });
  } catch (error: any) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

startServer();
