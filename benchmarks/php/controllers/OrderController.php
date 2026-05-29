<?php

namespace app\controllers;

use Yii;
use yii\web\Controller;
use yii\web\BadRequestHttpException;
use yii\filters\AccessControl;
use yii\filters\VerbFilter;
use app\models\Order;
use app\models\Cart;
use app\components\PaymentService;

/**
 * OrderController manages the checkout flow and order history.
 */
class OrderController extends Controller
{
    public function behaviors()
    {
        return [
            'access' => [
                'class' => AccessControl::class,
                'rules' => [
                    [
                        'allow' => true,
                        'roles' => ['@'],
                    ],
                ],
            ],
            'verbs' => [
                'class' => VerbFilter::class,
                'actions' => [
                    'create' => ['POST'],
                    'cancel' => ['POST'],
                ],
            ],
        ];
    }

    /**
     * Displays the current user's order history with pagination.
     */
    public function actionIndex()
    {
        $query = Order::find()
            ->where(['user_id' => Yii::$app->user->id])
            ->orderBy(['created_at' => SORT_DESC]);

        $pagination = new \yii\data\Pagination([
            'totalCount' => $query->count(),
            'pageSize' => 10,
        ]);

        $orders = $query->offset($pagination->offset)
                        ->limit($pagination->limit)
                        ->all();

        return $this->render('index', [
            'orders' => $orders,
            'pagination' => $pagination,
        ]);
    }

    /**
     * Creates a new order from the current cart.
     * Validates stock, calculates totals, and initiates payment.
     */
    public function actionCreate()
    {
        $cart = Cart::findByUser(Yii::$app->user->id);
        if (!$cart || $cart->isEmpty()) {
            throw new BadRequestHttpException('Cart is empty.');
        }

        $transaction = Yii::$app->db->beginTransaction();
        try {
            // Validate stock availability
            foreach ($cart->items as $item) {
                if ($item->product->stock_quantity < $item->quantity) {
                    throw new BadRequestHttpException(
                        "Insufficient stock for {$item->product->name}."
                    );
                }
            }

            // Create order
            $order = new Order();
            $order->user_id = Yii::$app->user->id;
            $order->status = Order::STATUS_PENDING;
            $order->shipping_address = Yii::$app->request->post('shipping_address');
            $order->total_amount = $cart->calculateTotal();

            if (!$order->save()) {
                throw new \RuntimeException('Failed to create order.');
            }

            // Create line items and decrement stock
            foreach ($cart->items as $item) {
                $order->addLineItem($item->product, $item->quantity, $item->product->price);
                $item->product->updateCounters(['stock_quantity' => -$item->quantity]);
            }

            // Process payment
            $paymentMethod = Yii::$app->request->post('payment_method', 'credit_card');
            $payment = Yii::$app->payment->charge($order, $paymentMethod);

            $order->payment_ref = $payment->reference;
            $order->status = Order::STATUS_PAID;
            $order->save(false);

            // Clear cart
            $cart->clear();

            $transaction->commit();

            // Queue confirmation email
            Yii::$app->queue->push(new \app\jobs\SendOrderConfirmation([
                'orderId' => $order->id,
            ]));

            return $this->redirect(['view', 'id' => $order->id]);

        } catch (\Exception $e) {
            $transaction->rollBack();
            Yii::$app->session->setFlash('error', $e->getMessage());
            return $this->redirect(['/cart']);
        }
    }

    /**
     * Displays order details. Users can only view their own orders.
     */
    public function actionView($id)
    {
        $order = Order::find()
            ->where(['id' => $id, 'user_id' => Yii::$app->user->id])
            ->with('lineItems.product')
            ->one();

        if (!$order) {
            throw new \yii\web\NotFoundHttpException('Order not found.');
        }

        return $this->render('view', ['order' => $order]);
    }

    /**
     * Cancels a pending order and restores stock quantities.
     */
    public function actionCancel($id)
    {
        $order = Order::find()
            ->where(['id' => $id, 'user_id' => Yii::$app->user->id, 'status' => Order::STATUS_PENDING])
            ->one();

        if (!$order) {
            throw new BadRequestHttpException('Order cannot be cancelled.');
        }

        $transaction = Yii::$app->db->beginTransaction();
        try {
            foreach ($order->lineItems as $item) {
                $item->product->updateCounters(['stock_quantity' => $item->quantity]);
            }
            $order->status = Order::STATUS_CANCELLED;
            $order->save(false);
            $transaction->commit();

            Yii::$app->session->setFlash('success', 'Order cancelled.');
        } catch (\Exception $e) {
            $transaction->rollBack();
            Yii::$app->session->setFlash('error', 'Failed to cancel order.');
        }

        return $this->redirect(['index']);
    }
}
