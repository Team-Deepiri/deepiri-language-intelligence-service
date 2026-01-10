import { Router } from 'express';
import leaseRoutes from './leaseRoutes';
import contractRoutes from './contractRoutes';

const router = Router();

router.use('/leases', leaseRoutes);
router.use('/contracts', contractRoutes);

export default router;

