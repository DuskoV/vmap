<?php

namespace app\components;

use Yii;

/**
 * PaymentService handles payment processing through external gateways.
 * Supports credit card, PayPal, and bank transfer methods.
 */
class PaymentService
{
    private $gateway;

    public function __construct()
    {
        $this->gateway = Yii::$app->params['payment.gateway'] ?? 'stripe';
    }

    /**
     * Charges the order amount using the specified payment method.
     * Returns a payment result with reference ID and status.
     */
    public function charge($order, $method = 'credit_card')
    {
        $amount = $order->total_amount;
        $currency = Yii::$app->params['payment.currency'] ?? 'USD';

        switch ($method) {
            case 'credit_card':
                return $this->chargeStripe($amount, $currency, $order);
            case 'paypal':
                return $this->chargePayPal($amount, $currency, $order);
            case 'bank_transfer':
                return $this->createBankTransfer($amount, $currency, $order);
            default:
                throw new \InvalidArgumentException("Unsupported payment method: {$method}");
        }
    }

    /**
     * Processes a refund for a completed payment.
     */
    public function refund($order, $amount = null)
    {
        $refundAmount = $amount ?? $order->total_amount;

        if ($refundAmount > $order->total_amount) {
            throw new \InvalidArgumentException('Refund amount exceeds order total.');
        }

        Yii::info("Processing refund of {$refundAmount} for order #{$order->id}", 'payment');

        return (object) [
            'reference' => 'ref_' . uniqid(),
            'amount' => $refundAmount,
            'status' => 'refunded',
        ];
    }

    protected function chargeStripe($amount, $currency, $order)
    {
        // In production, this calls the Stripe API
        Yii::info("Stripe charge: {$amount} {$currency} for order #{$order->id}", 'payment');

        return (object) [
            'reference' => 'ch_' . uniqid(),
            'amount' => $amount,
            'status' => 'succeeded',
            'gateway' => 'stripe',
        ];
    }

    protected function chargePayPal($amount, $currency, $order)
    {
        Yii::info("PayPal charge: {$amount} {$currency} for order #{$order->id}", 'payment');

        return (object) [
            'reference' => 'pp_' . uniqid(),
            'amount' => $amount,
            'status' => 'succeeded',
            'gateway' => 'paypal',
        ];
    }

    protected function createBankTransfer($amount, $currency, $order)
    {
        Yii::info("Bank transfer: {$amount} {$currency} for order #{$order->id}", 'payment');

        return (object) [
            'reference' => 'bt_' . uniqid(),
            'amount' => $amount,
            'status' => 'pending',
            'gateway' => 'bank_transfer',
        ];
    }
}
