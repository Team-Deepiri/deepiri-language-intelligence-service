import app from './server';
import { config } from './config/environment';
import { secureLog } from '@deepiri/shared-utils';
import { initializeEventPublisher } from './streaming/eventPublisher';

async function startServer() {
  try {
    // Initialize event publisher
    await initializeEventPublisher();

    // Start server
    app.listen(config.port, () => {
      secureLog('info', `Language Intelligence Service started on port ${config.port}`);
    });
  } catch (error: any) {
    secureLog('error', 'Failed to start server', { error: error.message });
    process.exit(1);
  }
}

startServer();

