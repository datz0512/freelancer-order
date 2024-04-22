import { IDeliveredWork, IOrderDocument, IOrderMessage, lowerCase } from '@datz0512/freelancer-shared';
import { config } from '@order/config';
import { OrderModel } from '@order/models/order.schema';
import { publishDirectMessage } from '@order/queues/order.producer';
import { orderChannel } from '@order/server';
import { sendNotification } from './notification.service';

export const getOrderByOrderId = async (orderId: string): Promise<IOrderDocument> => {
  const order: IOrderDocument[] = await OrderModel.aggregate([{ $match: { orderId } }]); //aggregate always return array
  return order[0];
};

export const getOrderBySellerId = async (sellerId: string): Promise<IOrderDocument[]> => {
  const orders: IOrderDocument[] = await OrderModel.aggregate([{ $match: { sellerId } }]); //aggregate always return array
  return orders;
};

export const getOrderByBuyerId = async (buyerId: string): Promise<IOrderDocument[]> => {
  const orders: IOrderDocument[] = await OrderModel.aggregate([{ $match: { buyerId } }]); //aggregate always return array
  return orders;
};

export const createOrder = async (data: IOrderDocument): Promise<IOrderDocument> => {
  const order: IOrderDocument = await OrderModel.create(data);

  //update seller info
  const messageDetails: IOrderMessage = {
    sellerId: data.sellerId,
    ongoingJobs: 1,
    type: 'create-order'
  };
  await publishDirectMessage(
    orderChannel,
    'freelancer-seller-update',
    'user-seller',
    JSON.stringify(messageDetails),
    'Details sent to users service'
  );

  //send email
  const emailMessageDetails: IOrderMessage = {
    orderId: data.orderId,
    invoiceId: data.invoiceId,
    orderDue: `${data.offer.newDeliveryDate}`,
    amount: `${data.price}`,
    buyerUsername: lowerCase(data.buyerUsername),
    sellerUsername: lowerCase(data.sellerUsername),
    title: data.offer.gigTitle,
    description: data.offer.description,
    requirements: data.requirements,
    serviceFee: `${order.serviceFee}`,
    total: `${order.price + order.serviceFee!}`,
    orderUrl: `${config.CLIENT_URL}/orders/${data.orderId}/activities`,
    template: 'orderPlaced'
  };
  await publishDirectMessage(
    orderChannel,
    'freelancer-order-notification',
    'order-email',
    JSON.stringify(emailMessageDetails),
    'Order email sent to notification service.'
  );

  sendNotification(order, data.sellerUsername, 'placed an order for your gig.');
  return order;
};

export const cancelOrder = async (orderId: string, data: IOrderMessage): Promise<IOrderDocument> => {
  const order: IOrderDocument = (await OrderModel.findOneAndUpdate(
    { orderId },
    {
      $set: {
        cancelled: true,
        status: 'Cancelled',
        approvedAt: new Date()
      }
    },
    { new: true }
  ).exec()) as IOrderDocument;

  //update seller info
  await publishDirectMessage(
    orderChannel,
    'freelancer-seller-update',
    'user-seller',
    JSON.stringify({ type: 'cancel-order', sellerId: data.sellerId }),
    'Cancelled order details sent to users service'
  );

  //update buyer info
  await publishDirectMessage(
    orderChannel,
    'freelancer-buyer-update',
    'user-buyer',
    JSON.stringify({ type: 'cancel-order', buyerId: data.buyerId, purchasedGigs: data.purchasedGigs }),
    'Cancelled order details sent to users service'
  );

  sendNotification(order, order.sellerUsername, 'cancelled your order delivery.');
  return order;
};

export const approveOrder = async (orderId: string, data: IOrderMessage): Promise<IOrderDocument> => {
  const order: IOrderDocument = (await OrderModel.findOneAndUpdate(
    { orderId },
    {
      $set: {
        approved: true,
        status: 'Completed',
        approvedAt: new Date()
      }
    },
    { new: true }
  ).exec()) as IOrderDocument;

  //update seller info
  const messageDetails: IOrderMessage = {
    sellerId: data.sellerId,
    ongoingJobs: data.ongoingJobs,
    completedJobs: data.completedJobs,
    totalEarnings: data.totalEarnings,
    recentDelivery: `${new Date()}`,
    type: 'approve-order'
  } as IOrderMessage;
  await publishDirectMessage(
    orderChannel,
    'freelancer-seller-update',
    'user-seller',
    JSON.stringify(messageDetails),
    'Approved order details sent to users service.'
  );

  //update buyer info
  await publishDirectMessage(
    orderChannel,
    'freelancer-buyer-update',
    'user-buyer',
    JSON.stringify({ type: 'purchased-gigs', buyerId: data.buyerId, purchasedGigs: data.purchasedGigs }),
    'Approved order details sent to users service.'
  );

  sendNotification(order, order.sellerUsername, 'approved your order delivery.');
  return order;
};

//seller deliver the order by sending file
export const sellerDeliverOrder = async (
  orderId: string,
  delivered: boolean,
  deliveredWork: IDeliveredWork //file
): Promise<IOrderDocument> => {
  const order: IOrderDocument = (await OrderModel.findOneAndUpdate(
    { orderId },
    {
      $set: {
        delivered,
        status: 'Delivered',
        ['events.orderDelivered']: new Date()
      },
      $push: {
        deliveredWork
      }
    },
    { new: true }
  ).exec()) as IOrderDocument;

  if (order) {
    //send email to buyer
    const emailMessageDetails: IOrderMessage = {
      orderId,
      buyerUsername: lowerCase(order.buyerUsername),
      sellerUsername: lowerCase(order.sellerUsername),
      title: order.offer.gigTitle,
      description: order.offer.description,
      orderUrl: `${config.CLIENT_URL}/orders/${orderId}/activities`,
      template: 'orderDelivered'
    };
    await publishDirectMessage(
      orderChannel,
      'freelancer-order-notification',
      'order-email',
      JSON.stringify(emailMessageDetails),
      'Order delivered message sent to notification service.'
    );

    sendNotification(order, order.buyerUsername, 'delivered your order.');
  }

  return order;
};
