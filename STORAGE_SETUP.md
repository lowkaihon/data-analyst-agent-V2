# Supabase Storage Setup Guide

This guide explains how to set up Supabase Storage to enable CSV file uploads larger than 4 MB, bypassing Vercel's 4.5 MB request body limit.

## Why Supabase Storage?

Vercel Serverless Functions have a hard 4.5 MB limit for request/response bodies across all plans (Hobby, Pro, Enterprise). For files larger than ~4 MB, we use Supabase Storage to bypass this limit:

- **Small files (< 4 MB)**: Upload directly via FormData (faster, no storage cost)
- **Large files (≥ 4 MB)**: Upload to Supabase Storage first, then process (bypasses Vercel limit)

## Upload Flow

### Small Files (< 4 MB)
```
Frontend → Vercel Function (/api/ingest) → Process CSV → Create Table
```

### Large Files (≥ 4 MB)
```
1. Frontend → /api/storage/upload-url → Get pre-signed upload URL
2. Frontend → Supabase Storage → Upload CSV directly
3. Frontend → /api/ingest (with storage path) → Download & Process → Delete temp file
```

## Setup Instructions

### Step 1: Create Storage Bucket

1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/YOUR_PROJECT_ID
2. Navigate to **Storage** in the left sidebar
3. Click **Create a new bucket**
4. Configure the bucket:
   - **Name**: `csv-uploads`
   - **Public bucket**: **Unchecked** (keep it private for security)
   - **File size limit**: 50 MB (default for free tier)
   - **Allowed MIME types**: Leave empty (we validate in code)
5. Click **Create bucket**

### Step 2: Configure RLS Policies

Row Level Security (RLS) ensures users can only access their own uploaded files.

**⚠️ IMPORTANT: Use SQL Editor for These Policies**

The SQL statements below should be run in the **SQL Editor**, NOT in the Storage UI policy creator:

1. Go to **SQL Editor** in the Supabase Dashboard (left sidebar)
2. Copy and paste each `CREATE POLICY` statement below
3. Click **Run** for each policy

**Note**: If you prefer using the Storage UI policy creator instead, you'll need to extract just the boolean conditions (the part inside `WITH CHECK` or `USING` clauses) - see troubleshooting section below for details.

#### Policy 1: Allow Authenticated Users to Upload

```sql
CREATE POLICY "Users can upload their own files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'csv-uploads' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
```

**What this does**: Users can only upload files to their own folder (`{user_id}/filename.csv`)

#### Policy 2: Allow Authenticated Users to Read Their Own Files

```sql
CREATE POLICY "Users can read their own files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'csv-uploads' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
```

**What this does**: Users can only download files from their own folder

#### Policy 3: Allow Authenticated Users to Delete Their Own Files

```sql
CREATE POLICY "Users can delete their own files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'csv-uploads' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
```

**What this does**: Users can only delete files in their own folder

#### Policy 4: Allow Service Role to Access All Files

```sql
CREATE POLICY "Service role can access all files"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'csv-uploads');
```

**What this does**: The backend can access any file to download and process it (using the service role key)

### Step 3: Verify Environment Variables

Ensure these environment variables are set in your `.env.local` (and Vercel environment variables):

```bash
NEXT_PUBLIC_SUPABASE_URL="https://[ref].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Important**: The `SUPABASE_SERVICE_ROLE_KEY` is required for the backend to download and delete files from storage.

### Step 4: Test the Setup

1. **Test with a small file (< 4 MB)**:
   - Upload should use direct upload (check browser console for "Using direct upload")
   - Should complete successfully

2. **Test with a large file (≥ 4 MB)**:
   - Upload should use storage path (check browser console for "Using storage upload")
   - Should complete successfully
   - Check Supabase Storage - temp file should be deleted after processing

3. **Test error handling**:
   - Upload an invalid CSV (e.g., malformed)
   - Temp file should still be deleted from storage

## Storage Limits

### Free Tier
- **Total storage**: 1 GB
- **Max file size**: 50 MB per file
- **Bandwidth**: 2 GB/month

### Pro Tier
- **Total storage**: 100 GB
- **Max file size**: 5 GB per file
- **Bandwidth**: 50 GB/month

## File Lifecycle

1. **Upload**: Frontend uploads CSV to storage in path `{user_id}/{uuid}.csv`
2. **Processing**: Backend downloads file, processes it, creates table
3. **Cleanup**: Backend deletes temp file from storage (success or error)
4. **Retention**: Files should never persist in storage after processing

## Monitoring

### Check for Orphaned Files

Run this SQL query in Supabase SQL Editor to find files that weren't cleaned up:

```sql
SELECT
  name,
  created_at,
  metadata->>'size' as size_bytes
FROM storage.objects
WHERE bucket_id = 'csv-uploads'
  AND created_at < NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

If you find orphaned files, you can delete them manually or add a cleanup task to the cron job.

### Storage Usage

Check storage usage in Supabase Dashboard → Settings → Usage

## Troubleshooting

### Error: "syntax error at or near 'CREATE'"

**Cause**: You're pasting the full SQL `CREATE POLICY` statement into the Storage UI policy creator, which only expects the boolean condition.

**Solution**: Use one of these approaches:

**Option A: Use SQL Editor (Recommended)**
1. Go to **SQL Editor** in Supabase Dashboard
2. Copy the full `CREATE POLICY` statement
3. Click **Run**

**Option B: Use Storage UI Policy Creator**

If you prefer the UI, extract only the condition (don't include `CREATE POLICY`, `ON storage.objects`, etc.):

**For Policy 1 (INSERT):**
- **Allowed operation**: Check INSERT only
- **Target roles**: Select "authenticated"
- **Policy definition**:
  ```sql
  bucket_id = 'csv-uploads' AND
  (storage.foldername(name))[1] = auth.uid()::text
  ```

**For Policy 2 (SELECT):**
- **Allowed operation**: Check SELECT only
- **Target roles**: Select "authenticated"
- **Policy definition**: (same condition as above)

**For Policy 3 (DELETE):**
- **Allowed operation**: Check DELETE only
- **Target roles**: Select "authenticated"
- **Policy definition**: (same condition as above)

**For Policy 4 (ALL):**
- **Allowed operation**: Check ALL (all checkboxes)
- **Target roles**: Select "service_role"
- **Policy definition**:
  ```sql
  bucket_id = 'csv-uploads'
  ```

### Error: "Failed to create upload URL"

**Possible causes**:
- Storage bucket `csv-uploads` doesn't exist
- RLS policies not configured correctly
- User not authenticated

**Solution**: Verify bucket exists and RLS policies are set up

### Error: "Failed to upload file to storage"

**Possible causes**:
- Pre-signed URL expired (5-minute limit)
- Network timeout
- File too large (>50 MB on free tier)

**Solution**: Retry upload, check file size, verify network connection

### Error: "Failed to download file from storage"

**Possible causes**:
- File not uploaded successfully
- Service role key not configured
- RLS policy blocking service role

**Solution**: Verify `SUPABASE_SERVICE_ROLE_KEY` is set, check policy 4 exists

### Files Not Being Deleted

**Possible causes**:
- Cleanup code failing silently
- Service role permissions issue

**Solution**: Check Vercel function logs, verify service role has DELETE permission

## Security Considerations

✅ **Secure**:
- Pre-signed URLs expire in 5 minutes
- Files stored in user-specific folders (`{user_id}/`)
- RLS prevents users from accessing other users' files
- Files deleted immediately after processing
- Service role key kept secret (server-side only)

⚠️ **Important**:
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in client-side code
- Always validate file types and sizes before processing
- Monitor storage usage to prevent abuse

## Alternative: Vercel Blob

If you prefer Vercel's native solution, you can use **Vercel Blob** instead:

**Pros**:
- Purpose-built for Vercel
- Simpler integration with `@vercel/blob` package
- Automatic CDN distribution

**Cons**:
- Requires Vercel Pro plan for meaningful storage (500 MB free)
- Additional service to manage
- Storage costs separate from Supabase

The current implementation uses Supabase Storage since you're already using Supabase for the database.

## Reference

- [Supabase Storage Documentation](https://supabase.com/docs/guides/storage)
- [Vercel Function Limitations](https://vercel.com/docs/functions/limitations)
- [Bypassing Vercel Body Size Limit](https://vercel.com/guides/how-to-bypass-vercel-body-size-limit-serverless-functions)
