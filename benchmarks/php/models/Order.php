<?php

namespace app\models;

use Yii;
use yii\db\ActiveRecord;
use yii\behaviors\TimestampBehavior;

/**
 * Order model represents a customer purchase.
 *
 * @property int $id
 * @property int $user_id
 * @property float $total_amount
 * @property string $status
 * @property string $payment_ref
 * @property string $shipping_address
 * @property string $created_at
 *
 * @property User $user
 * @property OrderLineItem[] $lineItems
 */
class Order extends ActiveRecord
{
    const STATUS_PENDING = 'pending';
    const STATUS_PAID = 'paid';
    const STATUS_SHIPPED = 'shipped';
    const STATUS_DELIVERED = 'delivered';
    const STATUS_CANCELLED = 'cancelled';

    public static function tableName()
    {
        return '{{%order}}';
    }

    public function behaviors()
    {
        return [
            [
                'class' => TimestampBehavior::class,
                'updatedAtAttribute' => false,
            ],
        ];
    }

    public function rules()
    {
        return [
            [['user_id', 'total_amount', 'status'], 'required'],
            ['total_amount', 'number', 'min' => 0],
            ['status', 'in', 'range' => [
                self::STATUS_PENDING, self::STATUS_PAID,
                self::STATUS_SHIPPED, self::STATUS_DELIVERED,
                self::STATUS_CANCELLED,
            ]],
            ['shipping_address', 'string'],
            ['payment_ref', 'string', 'max' => 100],
        ];
    }

    public function getUser()
    {
        return $this->hasOne(User::class, ['id' => 'user_id']);
    }

    public function getLineItems()
    {
        return $this->hasMany(OrderLineItem::class, ['order_id' => 'id']);
    }

    /**
     * Adds a line item to this order.
     */
    public function addLineItem(Product $product, $quantity, $unitPrice)
    {
        $item = new OrderLineItem();
        $item->order_id = $this->id;
        $item->product_id = $product->id;
        $item->quantity = $quantity;
        $item->unit_price = $unitPrice;
        $item->subtotal = $quantity * $unitPrice;

        if (!$item->save()) {
            throw new \RuntimeException('Failed to save line item: ' . implode(', ', $item->getFirstErrors()));
        }

        return $item;
    }

    /**
     * Calculates the total from line items. Used to verify the stored total.
     */
    public function recalculateTotal()
    {
        return OrderLineItem::find()
            ->where(['order_id' => $this->id])
            ->sum('subtotal') ?: 0;
    }

    /**
     * Returns true if the order can be cancelled (only pending orders).
     */
    public function canCancel()
    {
        return $this->status === self::STATUS_PENDING;
    }
}
