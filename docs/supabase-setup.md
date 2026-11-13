# Supabase backend setup

The browser continues to call the FastAPI `/api/*` routes. Only the backend
receives the Supabase database connection string.

## 1. Configure the backend

In Supabase, open **Project Settings → Database → Connection string** and copy
the PostgreSQL session-pooler URL:

```text
DATABASE_URL=postgresql://...
VTN_DATABASE_REQUIRED=1
```

Do not put this URL or a Supabase service-role key in `frontend/`.

## 2. Apply the schema

The backend applies the portable schema on startup. You can also paste
`supabase/migrations/202611130001_vtn_backend.sql` into the Supabase SQL Editor.

## 3. Verify

Start the backend, then check `/api/health`. A successful Supabase connection
reports:

```json
{"storage_ready": true, "database_backend": "supabase"}
```

The frontend only sends completed records. Draft and pending recordings remain
in browser storage and do not enter Supabase.
