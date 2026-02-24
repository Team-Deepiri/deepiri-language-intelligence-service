import { Router } from 'express';
import leaseRoutes from './leaseRoutes';
import contractRoutes from './contractRoutes';
import chatRoutes from './chatRoutes';
import obligationRoutes from './obligationRoutes';
import vectorStoreRoutes from './vectorStoreRoutes';


const router = Router();

router.use('/leases', leaseRoutes);
router.use('/contracts', contractRoutes);
router.use('/chat', chatRoutes);
router.use('/vector-store', vectorStoreRoutes);
router.use('/obligations', obligationRoutes);

export default router;

