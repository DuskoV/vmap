# Tower User Authentication

## Overview

Tower uses a separate authentication system from the main ATS to allow B2 admins to sign into Tower without conflicting with their regular ATS session.

## Access Restrictions

### Tower-Only Access

**Tower users are restricted to Tower routes only:**
- ✅ `/tower/metrics/*` - Business metrics
- ✅ `/tower/admin/*` - Admin tools
- ❌ `/employer/*` - Blocked
- ❌ `/candidate/*` - Blocked

**Exception (Future):**
- User administration may be accessible from both Tower and ATS
- Likely at a shared path like `/admin/users`
- Decision pending on implementation approach

### Dual Session Scenario

When admin troubleshoots a customer account:

1. **Tower Session:** Admin user can access `/tower/*` routes only
2. **ATS Session:** Customer user can access `/employer/*` routes
3. **Navigation:** Separate menus prevent confusion
