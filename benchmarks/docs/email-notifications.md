# Email Notifications

## Overview

The notification system sends transactional emails triggered by application events. All emails are queued for asynchronous delivery through the background job processor.

## Email Types

### Welcome Email

Sent immediately after email verification. Contains a getting-started guide and links to profile setup.

Template: `mail/welcome.php`
Subject: "Welcome to {appName}"

### Order Confirmation

Sent when an order is successfully placed and payment is confirmed. Includes order summary, line items, totals, and estimated delivery date.

Template: `mail/order-confirmation.php`
Subject: "Order #{orderId} confirmed"

### Shipping Notification

Sent when an order status changes to "shipped". Includes tracking number and carrier information with a link to track the package.

Template: `mail/shipping.php`
Subject: "Your order #{orderId} has shipped"

### Password Reset

Sent when a user requests a password reset. Contains a time-limited token link that expires after one hour. Only one active reset token is allowed per user.

Template: `mail/password-reset.php`
Subject: "Reset your password"

## Template System

Email templates use PHP view files with a shared layout. The layout provides consistent header, footer, and styling across all email types.

Variables available in all templates:
- `$user` — The recipient user model
- `$appName` — Application display name
- `$supportEmail` — Support contact address

## Delivery Configuration

The mail component supports multiple transport backends:
- SMTP — Direct server connection (default)
- SendGrid — API-based delivery with analytics
- Mailgun — API-based delivery with webhooks
- File — Writes emails to disk for development

## Bounce Handling

Webhook endpoints receive bounce and complaint notifications from the email provider. Hard bounces mark the user's email as invalid. Repeated soft bounces trigger a warning notification to the admin dashboard.
