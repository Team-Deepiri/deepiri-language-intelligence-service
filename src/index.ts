import http from 'http';
import app from './server';
import { config } from './config/environment';
import { logger } from './utils/logger';
import { initializeEventPublisher } from './streaming/eventPublisher';
import { initializeSocket } from './streaming/socketBroadcaster';

async function startServer() {
  try {
    // Initialize event publisher
    await initializeEventPublisher();

    const httpServer = http.createServer(app);

    initializeSocket(httpServer);

    httpServer.listen(config.port, () => {
      logger.info(`Language Intelligence Service started on port ${config.port}`);
    });
  } catch (error: any) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

startServer();

