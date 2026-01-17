import { Router } from 'express';
import leaseRoutes from './leaseRoutes';
import contractRoutes from './contractRoutes';
import vectorStoreRoutes from './vectorStoreRoutes';

const router = Router();

router.use('/leases', leaseRoutes);
router.use('/contracts', contractRoutes);
router.use('/vector-store', vectorStoreRoutes);

export default router;

