# Database Schema

## Core Tables

### users

Stores all registered user accounts.

| Column | Type | Description |
|--------|------|-------------|
| id | int | Primary key, auto-increment |
| email | varchar(255) | Unique email address |
| password_hash | varchar(255) | Bcrypt hashed password |
| status | tinyint | 0=pending, 1=active, 10=blocked |
| created_at | datetime | Registration timestamp |
| updated_at | datetime | Last profile update |

### products

Product catalog with pricing and inventory tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | int | Primary key |
| name | varchar(255) | Product display name |
| slug | varchar(255) | URL-friendly identifier |
| description | text | Full product description |
| price | decimal(10,2) | Current price in USD |
| stock_quantity | int | Available inventory count |
| category_id | int | Foreign key to categories |
| is_active | tinyint | Soft visibility toggle |

### orders

Customer orders with status tracking and payment references.

| Column | Type | Description |
|--------|------|-------------|
| id | int | Primary key |
| user_id | int | Foreign key to users |
| total_amount | decimal(10,2) | Order total including tax |
| status | varchar(20) | pending, paid, shipped, delivered, cancelled |
| payment_ref | varchar(100) | External payment gateway reference |
| shipping_address | text | JSON-encoded address object |
| created_at | datetime | Order placement time |

## Indexes

- `users.email` — unique index for login lookups
- `products.slug` — unique index for URL resolution
- `products.category_id` — index for category filtering
- `orders.user_id` — index for user order history
- `orders.status` — index for admin dashboard filtering

## Migrations

All schema changes are managed through timestamped migration files. Each migration contains an `up()` method for applying changes and a `down()` method for reversal. Migrations run sequentially and their execution state is tracked in the `migration` table.
