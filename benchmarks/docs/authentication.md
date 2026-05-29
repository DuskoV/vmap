# User Authentication

## Overview

The authentication system handles user login, registration, and session management. All authentication flows use secure token-based verification with configurable expiration policies.

## Login Flow

When a user submits credentials, the system performs the following steps:

1. Validate email format and password length requirements
2. Query the user table by email address
3. Verify the password hash using bcrypt comparison
4. Generate a session token with a 24-hour expiration
5. Store the token in the session table with the user ID
6. Return the token in the response header

Failed login attempts are tracked per IP address. After five consecutive failures within a 15-minute window, the IP is temporarily blocked for 30 minutes.

## Registration

New user registration requires email verification. The process creates a pending user record, sends a verification email with a unique token, and activates the account once the token is confirmed.

### Password Requirements

- Minimum 8 characters
- At least one uppercase letter
- At least one numeric digit
- Cannot match the user's email address

## Session Management

Sessions are stored in the database with the following fields: token, user_id, created_at, expires_at, and ip_address. A background job purges expired sessions every hour.

### Token Refresh

Active sessions can be refreshed by calling the refresh endpoint before expiration. Each refresh extends the session by another 24 hours and rotates the token value.

## Two-Factor Authentication

Optional TOTP-based two-factor authentication can be enabled per user. When enabled, the login flow adds a verification step after password validation where the user must provide a six-digit code from their authenticator app.
