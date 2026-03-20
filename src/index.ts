import http from 'http';
import app from './server';
import { config } from './config/environment';
import { secureLog } from '@deepiri/shared-utils';
import { initializeEventPublisher } from './streaming/eventPublisher';
import { streamConsumer } from './services/streamConsumerService';
import { registerStreamHandlers } from './services/streamRegistry';

process.on('SIGTERM', async () => {
  await streamConsumer.stop();
});

async function startServer() {
  try {
    await initializeEventPublisher();

    registerStreamHandlers();
    await streamConsumer.connect();
    await streamConsumer.start();

    app.listen(config.port, () => {
      logger.info(`Language Intelligence Service started on port ${config.port}`);
    });
  } catch (error: any) {
    secureLog('error', 'Failed to start server', { error: error.message });
    process.exit(1);
  }
}

startServer();