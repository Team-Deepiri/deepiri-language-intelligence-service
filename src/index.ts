import app from './server';
import { config } from './config/environment';
import { logger } from './utils/logger';
import { initializeEventPublisher } from './streaming/eventPublisher';

async function startServer() {
  try {
    // Initialize event publisher
    await initializeEventPublisher();

    // Start server
    app.listen(config.port, () => {
      logger.info(`Language Intelligence Service started on port ${config.port}`);
    });
  } catch (error: any) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

startServer();

