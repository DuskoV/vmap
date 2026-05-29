<?php

namespace app\models;

use Yii;
use yii\db\ActiveRecord;
use yii\behaviors\TimestampBehavior;
use yii\behaviors\SluggableBehavior;

/**
 * Product model represents an item in the product catalog.
 *
 * @property int $id
 * @property string $name
 * @property string $slug
 * @property string $description
 * @property float $price
 * @property int $stock_quantity
 * @property int $category_id
 * @property int $is_active
 * @property string $created_at
 * @property string $updated_at
 *
 * @property Category $category
 * @property OrderLineItem[] $orderLineItems
 */
class Product extends ActiveRecord
{
    public static function tableName()
    {
        return '{{%product}}';
    }

    public function behaviors()
    {
        return [
            TimestampBehavior::class,
            [
                'class' => SluggableBehavior::class,
                'attribute' => 'name',
                'slugAttribute' => 'slug',
                'ensureUnique' => true,
            ],
        ];
    }

    public function rules()
    {
        return [
            [['name', 'price', 'category_id'], 'required'],
            ['name', 'string', 'max' => 255],
            ['description', 'string'],
            ['price', 'number', 'min' => 0],
            ['stock_quantity', 'integer', 'min' => 0],
            ['category_id', 'exist', 'targetClass' => Category::class, 'targetAttribute' => 'id'],
            ['is_active', 'boolean'],
        ];
    }

    public function getCategory()
    {
        return $this->hasOne(Category::class, ['id' => 'category_id']);
    }

    public function getOrderLineItems()
    {
        return $this->hasMany(OrderLineItem::class, ['product_id' => 'id']);
    }

    /**
     * Returns the discounted price if a promotion is active, otherwise the base price.
     */
    public function getEffectivePrice()
    {
        $promotion = $this->getActivePromotion();
        if ($promotion) {
            return round($this->price * (1 - $promotion->discount_percent / 100), 2);
        }
        return $this->price;
    }

    /**
     * Checks if the product has sufficient stock for the requested quantity.
     */
    public function hasStock($quantity = 1)
    {
        return $this->stock_quantity >= $quantity;
    }

    /**
     * Finds the currently active promotion for this product, if any.
     */
    protected function getActivePromotion()
    {
        return Promotion::find()
            ->where(['product_id' => $this->id])
            ->andWhere(['<=', 'start_date', date('Y-m-d')])
            ->andWhere(['>=', 'end_date', date('Y-m-d')])
            ->andWhere(['is_active' => 1])
            ->one();
    }
}
