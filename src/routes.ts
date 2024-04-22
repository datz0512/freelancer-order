import { verifyGatewayRequest } from '@datz0512/freelancer-shared';
import { Application } from 'express';

const BASE_PATH = '/api/v1/order';

const appRoutes = (app: Application): void => {
  app.use('', () => {
    console.log('health-routes');
  });
  app.use(BASE_PATH, verifyGatewayRequest, () => {
    console.log('order-routes');
  });
};

export { appRoutes };
