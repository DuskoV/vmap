# Search and Filtering

## Full-Text Search

Product search uses a weighted full-text index across the name, description, and tag fields. Search results are ranked by relevance score with exact matches boosted above partial matches.

The search query is tokenized, stemmed, and matched against the index. Stop words are removed. Minimum query length is two characters.

## Category Filtering

Products are organized in a hierarchical category tree. Filtering by a parent category includes all products in child categories. The category tree supports unlimited nesting depth but the UI displays a maximum of three levels.

### Category Cache

The full category tree is cached in Redis with a one-hour TTL. Cache is invalidated when any category is created, updated, or deleted. The cache key includes the locale for multi-language support.

## Price Range Filtering

Users can filter products by minimum and maximum price. The filter operates on the current price after any active discounts are applied. Price ranges are validated server-side to prevent negative values.

## Faceted Search

Search results include facet counts for available filters: categories, price ranges, brands, and ratings. Facets update dynamically as filters are applied, showing only relevant options with non-zero counts.

## Sort Options

Available sort orders:
- Relevance (default for search queries)
- Price low to high
- Price high to low
- Newest first
- Best rated
- Most popular (based on order count)

## Pagination

Results are paginated with configurable page size. The API returns total count, current page, and total pages in the response metadata. Cursor-based pagination is available for large result sets to avoid offset performance degradation.
