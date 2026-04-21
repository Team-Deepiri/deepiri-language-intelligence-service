import { Router } from 'express';
import documentRoutes from './documentRoutes';
import chatRoutes from './chatRoutes';
import obligationRoutes from './obligationRoutes';
import vectorStoreRoutes from './vectorStoreRoutes';


const router = Router();

router.use('/documents', documentRoutes);
router.use('/chat', chatRoutes);
router.use('/vector-store', vectorStoreRoutes);
router.use('/obligations', obligationRoutes);

export default router;

