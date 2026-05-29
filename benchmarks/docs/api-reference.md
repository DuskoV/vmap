# API Reference

## Endpoints

### Products

#### GET /api/products

Returns a paginated list of active products. Supports filtering by category and text search on product name and description.

Query parameters:
- `page` (int, default: 1) — Page number
- `per_page` (int, default: 20, max: 100) — Items per page
- `category` (string) — Filter by category slug
- `q` (string) — Full-text search query
- `sort` (string) — Sort field: price, name, created_at
- `order` (string) — Sort direction: asc, desc

Response: JSON array of product objects with pagination metadata.

#### GET /api/products/{slug}

Returns a single product by its URL slug. Includes full description, images, and related products.

#### POST /api/products

Creates a new product. Requires admin authentication. Request body must include name, price, and category_id. Returns the created product with its generated slug.

### Orders

#### POST /api/orders

Creates a new order from the current cart contents. Validates stock availability, calculates totals with applicable tax rates, and initiates payment processing.

Request body:
- `shipping_address` (object) — Street, city, state, zip, country
- `payment_method` (string) — credit_card, paypal, bank_transfer

#### GET /api/orders/{id}

Returns order details including line items, shipping status, and payment information. Users can only access their own orders unless they have admin privileges.

### Users

#### POST /api/auth/login

Authenticates a user and returns a session token. See the Authentication documentation for the complete login flow.

#### POST /api/auth/register

Creates a new user account and sends a verification email. Returns a success message but no session token until email is verified.

## Error Handling

All endpoints return consistent error responses with the following structure:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": []
  }
}
```

HTTP status codes follow REST conventions: 200 for success, 201 for creation, 400 for validation errors, 401 for authentication failures, 403 for authorization failures, 404 for missing resources, and 500 for server errors.

## Rate Limiting

API requests are rate-limited to 100 requests per minute per authenticated user, and 20 requests per minute for unauthenticated requests. Rate limit headers are included in every response: X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset.
