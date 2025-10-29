# Row Level Security (RLS) Implementation Guide

This document explains the RLS implementation for session-based anonymous authentication in the Data Analyst Agent.

## Overview

The application now uses **anonymous authentication** with **Row Level Security (RLS)** to provide session isolation between users. This means:

- ✅ Each browser session gets a unique anonymous user ID
- ✅ Users can only see and access their own datasets
- ✅ No login or signup required - seamless user experience
- ✅ Sessions persist across page refreshes
- ✅ Database-level security on metadata tables
- ✅ Application-level security on data tables

## Architecture

### Authentication Flow

1. **Middleware** (`middleware.ts`) intercepts all requests
2. Checks for existing Supabase auth session
3. If no session exists, creates an **anonymous user** automatically
4. Session is stored in browser cookies (managed by Supabase)

### Security Layers

#### Database-Level RLS (Metadata Tables)

Tables with RLS enabled:
- `datasets` - Dataset metadata
- `chat_turns` - Conversation history
- `runs` - SQL queries, charts, and analysis results
- `reports` - Generated reports

**RLS Policies:**
- `SELECT`: Users can view their own data + orphaned data (user_id IS NULL)
- `INSERT`: Users can only create data with their own user_id
- `UPDATE`: Users can only update their own data
- `DELETE`: Users can only delete their own data

#### Application-Level Security (Data Tables)

Dynamic dataset tables (`ds_<uuid>`) do **not** have RLS applied. Instead:
- API routes verify dataset ownership before allowing queries
- Check: `datasets.user_id = auth.uid()` before executing SQL on `ds_<uuid>`

**Why this approach?**
- Simpler implementation - no need to add RLS to each dynamically created table
- Better performance - no RLS overhead on query execution
- Easier to maintain - policies don't need updating when tables are created/dropped

**Trade-offs:**
- Security depends on correct API implementation
- Direct database access bypasses security (ensure DB credentials are secure)
- Cannot use Supabase client-side queries for data tables

## Files Modified

### Core Files

1. **`middleware.ts`** (NEW)
   - Intercepts all requests
   - Creates anonymous sessions automatically
   - Manages Supabase cookies

2. **`lib/supabase/server.ts`** (UPDATED)
   - `createClient()` - User-authenticated client (respects RLS)
   - `createAdminClient()` - Admin client (bypasses RLS, use sparingly)

3. **`scripts/initialize_database.sql`** (UPDATED)
   - Added `user_id UUID` columns to all metadata tables
   - Added indexes on `user_id` for RLS performance
   - Enabled RLS on all tables
   - Created RLS policies for all CRUD operations

### API Routes Updated

All API routes now include authentication checks:

1. **`/api/ingest/route.ts`**
   - Captures `user_id` on dataset creation
   - Rejects requests without authentication

2. **`/api/chat/[datasetId]/route.ts`**
   - Verifies user owns dataset before allowing queries
   - Adds `user_id` to all runs (SQL, charts, analysis summaries)

3. **`/api/runs/route.ts`**
   - Verifies dataset ownership
   - RLS automatically filters runs by user_id

4. **`/api/runs/[id]/pin/route.ts`**
   - RLS ensures users can only pin/unpin their own runs

5. **`/api/report/generate/route.ts`**
   - Verifies dataset ownership
   - RLS automatically filters runs by user_id

6. **`/api/datasets/cleanup/route.ts`**
   - RLS automatically limits cleanup to user's own datasets

## Database Schema Changes

### New Columns

All metadata tables now have:
```sql
user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
```

### New Indexes

```sql
CREATE INDEX idx_datasets_user_id ON datasets(user_id);
CREATE INDEX idx_chat_turns_user_id ON chat_turns(user_id);
CREATE INDEX idx_runs_user_id ON runs(user_id);
CREATE INDEX idx_reports_user_id ON reports(user_id);
```

## Setup Instructions

1. Run `scripts/initialize_database.sql` - RLS is included by default

2. Ensure environment variables are set:
```bash
NEXT_PUBLIC_SUPABASE_URL="https://[ref].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJh..."
SUPABASE_SERVICE_ROLE_KEY="eyJh..."  # For admin operations only
SUPABASE_POSTGRES_URL="postgres://..."
```

3. Enable anonymous authentication in Supabase:
   - Go to Supabase Dashboard → Authentication → Providers
   - Enable "Anonymous sign-ins"

4. Deploy the application - anonymous auth will work automatically

## Testing RLS

### Test Session Isolation

1. Open the app in Browser A (e.g., Chrome)
2. Upload a dataset - note the dataset ID
3. Open the app in Browser B (e.g., Firefox) in incognito/private mode
4. Try to access the dataset ID from Browser A
5. **Expected:** Browser B should see "Dataset not found or access denied"

### Test Session Persistence

1. Upload a dataset
2. Refresh the page
3. **Expected:** You can still see and access your dataset

### Test RLS Policies (Database)

```sql
-- Connect as anonymous user (will be blocked if RLS works)
SELECT * FROM datasets WHERE user_id != '[your-user-id]';
-- Expected: 0 rows (RLS filters out other users' data)

-- Try to insert data with wrong user_id
INSERT INTO datasets (file_name, table_name, user_id)
VALUES ('test.csv', 'ds_test', '[different-user-id]');
-- Expected: Error - RLS policy violation
```

## Limitations

### Anonymous Session Limitations

- **Sessions can expire** - Supabase anonymous sessions may expire after a period of inactivity
- **No cross-device access** - Sessions are browser-specific
- **No account recovery** - If user clears browser data, datasets become orphaned
- **No user management** - Cannot view all users, reset passwords, etc.

### Security Considerations

- **Service role key** bypasses all RLS - keep it secret and only use for privileged operations
- **Direct database access** bypasses application-level security on `ds_<uuid>` tables
- **Dynamic tables** (`ds_<uuid>`) do not have database-level RLS

## Future Enhancements

If you need more robust user management in the future:

1. **Upgrade to email/password auth:**
   - Replace anonymous auth with `signInWithPassword()`
   - Add login/signup UI components
   - Update middleware to redirect unauthenticated users

2. **Add public sharing:**
   - Add `is_public BOOLEAN` column to datasets
   - Update RLS policies: `USING (auth.uid() = user_id OR is_public = true)`

3. **Add collaborative features:**
   - Create `dataset_permissions` table
   - Link users to datasets with roles (owner, editor, viewer)
   - Update RLS policies to check permissions table

4. **Add RLS to dynamic tables:**
   - Create function to apply RLS when creating `ds_<uuid>` tables
   - Add `user_id` column to each dynamic table
   - Apply policies: `USING (auth.uid() = user_id)`

## Troubleshooting

### "Authentication required" errors

**Cause:** Anonymous session creation failed or expired

**Fix:**
1. Clear browser cookies
2. Refresh page - middleware will create new session
3. Check Supabase dashboard - ensure anonymous auth is enabled

### "Dataset not found or access denied"

**Cause:** Trying to access another user's dataset

**Fix:**
- This is expected behavior - RLS is working correctly
- Each user can only see their own datasets

### TypeScript errors after update

**Fix:**
```bash
pnpm tsc --noEmit
```
- Should show no errors
- If errors exist, ensure all API routes import updated `createClient` from `@/lib/supabase/server`

## Support

For issues or questions:
- Check Supabase Auth documentation: https://supabase.com/docs/guides/auth
- Check RLS documentation: https://supabase.com/docs/guides/auth/row-level-security
- Review middleware implementation: `middleware.ts`
- Check API route authentication: All `app/api/**/route.ts` files

## Summary

This RLS implementation provides:
- ✅ Automatic session isolation for anonymous users
- ✅ No login required - seamless UX
- ✅ Database-level security on metadata
- ✅ Application-level security on data tables
- ✅ TypeScript type safety maintained

**Security Level:** Suitable for personal use, demos, and internal tools. For production applications with sensitive data, consider upgrading to full email/password authentication with additional security measures.
