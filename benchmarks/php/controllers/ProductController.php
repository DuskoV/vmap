<?php

namespace app\controllers;

use Yii;
use yii\web\Controller;
use yii\web\NotFoundHttpException;
use yii\filters\AccessControl;
use yii\filters\VerbFilter;
use app\models\Product;

/**
 * ProductController handles CRUD operations for the product catalog.
 * Provides both web views and JSON API endpoints.
 */
class ProductController extends Controller
{
    public function behaviors()
    {
        return [
            'access' => [
                'class' => AccessControl::class,
                'only' => ['create', 'update', 'delete'],
                'rules' => [
                    [
                        'allow' => true,
                        'roles' => ['admin'],
                    ],
                ],
            ],
            'verbs' => [
                'class' => VerbFilter::class,
                'actions' => [
                    'delete' => ['POST'],
                ],
            ],
        ];
    }

    /**
     * Lists all active products with pagination and filtering.
     * Supports category filter, text search, and sort options.
     */
    public function actionIndex()
    {
        $query = Product::find()->where(['is_active' => 1]);

        $category = Yii::$app->request->get('category');
        if ($category) {
            $query->joinWith('category')
                  ->andWhere(['category.slug' => $category]);
        }

        $search = Yii::$app->request->get('q');
        if ($search) {
            $query->andWhere(['or',
                ['like', 'product.name', $search],
                ['like', 'product.description', $search],
            ]);
        }

        $sort = Yii::$app->request->get('sort', 'created_at');
        $order = Yii::$app->request->get('order', 'desc');
        $query->orderBy([$sort => $order === 'asc' ? SORT_ASC : SORT_DESC]);

        $pagination = new \yii\data\Pagination([
            'totalCount' => $query->count(),
            'pageSize' => 20,
        ]);

        $products = $query->offset($pagination->offset)
                          ->limit($pagination->limit)
                          ->all();

        return $this->render('index', [
            'products' => $products,
            'pagination' => $pagination,
        ]);
    }

    /**
     * Displays a single product by its URL slug.
     * Loads related products from the same category.
     */
    public function actionView($slug)
    {
        $product = Product::find()
            ->where(['slug' => $slug, 'is_active' => 1])
            ->one();

        if (!$product) {
            throw new NotFoundHttpException('Product not found.');
        }

        $related = Product::find()
            ->where(['category_id' => $product->category_id, 'is_active' => 1])
            ->andWhere(['!=', 'id', $product->id])
            ->limit(4)
            ->all();

        return $this->render('view', [
            'product' => $product,
            'related' => $related,
        ]);
    }

    /**
     * Creates a new product. Admin only.
     * Generates URL slug from the product name.
     */
    public function actionCreate()
    {
        $model = new Product();

        if ($model->load(Yii::$app->request->post()) && $model->save()) {
            Yii::$app->session->setFlash('success', 'Product created.');
            return $this->redirect(['view', 'slug' => $model->slug]);
        }

        return $this->render('create', ['model' => $model]);
    }

    /**
     * Updates an existing product. Admin only.
     */
    public function actionUpdate($id)
    {
        $model = $this->findModel($id);

        if ($model->load(Yii::$app->request->post()) && $model->save()) {
            Yii::$app->session->setFlash('success', 'Product updated.');
            return $this->redirect(['view', 'slug' => $model->slug]);
        }

        return $this->render('update', ['model' => $model]);
    }

    /**
     * Soft-deletes a product by setting is_active to 0.
     */
    public function actionDelete($id)
    {
        $model = $this->findModel($id);
        $model->is_active = 0;
        $model->save(false);

        Yii::$app->session->setFlash('success', 'Product removed.');
        return $this->redirect(['index']);
    }

    protected function findModel($id)
    {
        $model = Product::findOne($id);
        if (!$model) {
            throw new NotFoundHttpException('Product not found.');
        }
        return $model;
    }
}
