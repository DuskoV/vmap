# Deployment Guide

## Requirements

- PHP 8.1 or higher
- MySQL 8.0 or MariaDB 10.6
- Composer 2.x
- Node.js 18+ (for asset compilation)
- Redis (optional, for caching and queue)

## Environment Setup

Copy the environment template and configure database credentials, mail settings, and application keys:

```bash
cp .env.example .env
```

Required environment variables:
- `DB_HOST` — Database server hostname
- `DB_NAME` — Database name
- `DB_USER` — Database username
- `DB_PASS` — Database password
- `APP_KEY` — 32-character random string for encryption
- `MAIL_HOST` — SMTP server for outbound email

## Installation Steps

1. Install PHP dependencies: `composer install --no-dev`
2. Install frontend dependencies: `npm ci`
3. Build assets: `npm run build`
4. Run database migrations: `php yii migrate --interactive=0`
5. Seed initial data: `php yii seed/init`
6. Configure web server to point to `web/` directory

## Docker Deployment

The application ships with a Docker Compose configuration for local development and staging environments.

```bash
docker-compose up -d
```

Services included:
- `app` — PHP-FPM with application code
- `web` — Nginx reverse proxy
- `db` — MariaDB database
- `redis` — Cache and queue backend
- `worker` — Background job processor

## Queue Workers

Background jobs are processed by queue workers. In production, run at least two worker processes for redundancy:

```bash
php yii queue/listen --verbose
```

Jobs include: email sending, report generation, image processing, and search index updates.

## Monitoring

Health check endpoint: `GET /health` returns 200 with JSON status of database, cache, and queue connectivity. Use this for load balancer health probes.

Application metrics are exposed at `/metrics` in Prometheus format when the monitoring module is enabled.
