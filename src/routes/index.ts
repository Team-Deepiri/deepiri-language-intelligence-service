import { Router } from 'express';
import leaseRoutes from './leaseRoutes';
import contractRoutes from './contractRoutes';
import chatRoutes from './chatRoutes';

const router = Router();

router.use('/leases', leaseRoutes);
router.use('/contracts', contractRoutes);
router.use('/chat', chatRoutes);

export default router;

