<?php

namespace app\components;

use Yii;

/**
 * SearchService provides full-text search across products with faceted filtering.
 * Uses database full-text indexes with optional Redis caching.
 */
class SearchService
{
    private $cacheEnabled;
    private $cacheTtl;

    public function __construct()
    {
        $this->cacheEnabled = Yii::$app->params['search.cache'] ?? true;
        $this->cacheTtl = Yii::$app->params['search.cacheTtl'] ?? 300;
    }

    /**
     * Searches products by query string with optional filters.
     * Returns paginated results with facet counts.
     */
    public function search($query, $filters = [], $page = 1, $perPage = 20)
    {
        $cacheKey = $this->buildCacheKey($query, $filters, $page);

        if ($this->cacheEnabled) {
            $cached = Yii::$app->cache->get($cacheKey);
            if ($cached !== false) return $cached;
        }

        $dbQuery = \app\models\Product::find()
            ->where(['is_active' => 1]);

        // Full-text search
        if ($query) {
            $dbQuery->andWhere(
                'MATCH(name, description) AGAINST(:q IN BOOLEAN MODE)',
                [':q' => $this->sanitizeQuery($query)]
            );
        }

        // Category filter
        if (!empty($filters['category'])) {
            $dbQuery->joinWith('category')
                    ->andWhere(['category.slug' => $filters['category']]);
        }

        // Price range
        if (isset($filters['min_price'])) {
            $dbQuery->andWhere(['>=', 'price', (float) $filters['min_price']]);
        }
        if (isset($filters['max_price'])) {
            $dbQuery->andWhere(['<=', 'price', (float) $filters['max_price']]);
        }

        $total = $dbQuery->count();
        $products = $dbQuery
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->all();

        // Build facets
        $facets = $this->buildFacets($query, $filters);

        $result = [
            'products' => $products,
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
            'totalPages' => ceil($total / $perPage),
            'facets' => $facets,
        ];

        if ($this->cacheEnabled) {
            Yii::$app->cache->set($cacheKey, $result, $this->cacheTtl);
        }

        return $result;
    }

    /**
     * Builds facet counts for the current search context.
     */
    protected function buildFacets($query, $currentFilters)
    {
        $facets = [];

        // Category facets
        $facets['categories'] = Yii::$app->db->createCommand(
            'SELECT c.slug, c.name, COUNT(*) as count
             FROM product p
             JOIN category c ON p.category_id = c.id
             WHERE p.is_active = 1
             GROUP BY c.id
             ORDER BY count DESC'
        )->queryAll();

        // Price range facets
        $facets['price_ranges'] = [
            ['label' => 'Under $25', 'min' => 0, 'max' => 25],
            ['label' => '$25 - $50', 'min' => 25, 'max' => 50],
            ['label' => '$50 - $100', 'min' => 50, 'max' => 100],
            ['label' => 'Over $100', 'min' => 100, 'max' => null],
        ];

        return $facets;
    }

    protected function sanitizeQuery($query)
    {
        return preg_replace('/[^\w\s]/', '', $query);
    }

    protected function buildCacheKey($query, $filters, $page)
    {
        return 'search:' . md5(json_encode([$query, $filters, $page]));
    }
}
