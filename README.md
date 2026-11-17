# Sourceleaf

Sourceleaf is a portfolio app for asking questions about PDFs and Word documents and opening the passages behind each answer.

[Scope](docs/scope.md) · [Architecture](docs/architecture.md) · [Functional requirements](docs/frd.md)

## Run locally

Use Node.js 24 and Python 3.14. No provider credentials are required to run the scaffold.

Start FastAPI from the project root:

```sh
python3.14 -m venv api/.venv
api/.venv/bin/python -m pip install -r api/requirements.txt
api/.venv/bin/python -m uvicorn main:app --app-dir api --reload
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open the URL printed by Next.js. To route local `/api/health` through Next.js, copy `frontend/.env.example` to `frontend/.env.local` and set `LOCAL_API_ORIGIN` to the URL printed by Uvicorn. Restart Next.js after changing it.

Run `npm run lint`, `npm run typecheck`, and `npm run build` from `frontend`.

## Configuration and Git

- Commit only the blank `.env.example` templates. Keep real values in ignored local environment files or shell variables. Set deployed values through Vercel project settings.
- Use `NEXT_PUBLIC_` only for browser-safe values. Keep Gemini and Supabase secret keys on the server. When setting up Google sign-in, store its OAuth client secret in Supabase Auth settings.
- After initializing Git, run `pre-commit install` with [pre-commit](https://pre-commit.com/#install) installed to scan staged changes for secrets. Enable GitHub push protection when creating the remote repository.

The root `vercel.json` serves Next.js and FastAPI under one project using [Vercel Services](https://vercel.com/docs/services). Requests under `/api/` go to FastAPI.

## Test sample Q&A locally

Apply the [Supabase migrations](supabase/migrations/) and set the provider values in `api/.env`. Add these local settings:

```dotenv
SOURCELEAF_CHUNK_CHARS=1600
SOURCELEAF_MATCH_COUNT=4
SOURCELEAF_REQUEST_TIMEOUT_SECONDS=45
```

After installing the updated API requirements, index public sample files and ask a question:

```sh
api/.venv/bin/python api/sample_cli.py index /path/to/sample.pdf /path/to/sample.docx
api/.venv/bin/python api/sample_cli.py list
api/.venv/bin/python api/sample_cli.py ask "Your question" PDF_DOCUMENT_ID DOCX_DOCUMENT_ID
```

The CLI returns the answer with excerpts and source locations. On the local home page, visitors can ask questions about the seeded samples without signing in. The public endpoint shares a daily quota.

If macOS Python reports that it cannot read the provider response and its certificate store is empty, run the local command with `SSL_CERT_FILE=/etc/ssl/cert.pem`.

## Set up private uploads

1. In Supabase, open **Storage → New bucket**. Name it `sourceleaf-documents` and leave **Public bucket** off. Set a 20 MB upload limit and allow `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. [Supabase bucket settings](https://supabase.com/docs/guides/storage/buckets/fundamentals)
2. Add `SUPABASE_STORAGE_BUCKET=sourceleaf-documents` and `SOURCELEAF_MAX_UPLOAD_BYTES=20000000` to the ignored `api/.env` file. If you choose other limits, keep the API limit at or below the bucket limit.
3. After applying the accounts and jobs migration, run the [upload queue migration](supabase/migrations/20261117000300_upload_queue.sql) in the Supabase SQL Editor.

The API expects the signed-in user's Supabase access token. Register the file with `POST /api/documents/uploads` and a JSON body containing `filename` and `size_bytes`. Upload the file directly to the returned bucket and path with the same Supabase session, then call `POST /api/documents/{document_id}/ingestion`. Poll `GET /api/documents/{document_id}/ingestion` to read the job's status. Queued jobs are available to the indexing worker.

## Run the indexing worker

In Supabase SQL Editor, run the [indexing worker migration](supabase/migrations/20261117000400_ingestion_worker.sql) after the upload queue migration. Add these settings to `api/.env`:

```dotenv
SOURCELEAF_INGEST_BATCH_SIZE=3
SOURCELEAF_INGEST_LEASE_SECONDS=360
SOURCELEAF_INGEST_FAILURE_LIMIT=3
SOURCELEAF_INGEST_RETRY_SECONDS=60
```

From the project root, run the worker in a separate terminal alongside the API:

```sh
api/.venv/bin/python api/ingestion_worker.py --watch 5
```

The worker processes queued files while it runs, even after the uploader closes the browser. To process one batch and exit, omit `--watch 5`. A restarted worker can reclaim an unfinished batch once its lease expires. Keep the same embedding and chunk settings while indexing is in progress. The local worker is optional in a Vercel deployment configured as described below.

## Try Google sign-in and a private upload

1. In Supabase, open **Authentication → Sign In / Providers → Google** and copy the provider's callback URL.
2. In [Google Auth Platform](https://console.cloud.google.com/auth/overview), select a Google Cloud project. Set up the consent screen for **External** users. If you keep the app in **Testing**, add the Google account you will use under **Audience → Test users**.
3. Under **Clients**, create a **Web application** client. In **Authorized redirect URIs**, paste the callback URL from Supabase. Paste the client ID and secret into the Google provider settings in Supabase, then enable Google. [Supabase Google sign-in guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
4. In **Supabase → Authentication → URL Configuration**, set the local Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/callback` under **Redirect URLs**. If you use another local URL, add that exact callback instead. [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
5. Copy `frontend/.env.example` to `frontend/.env.local`. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` using the matching values from the backend environment. Set `LOCAL_API_ORIGIN` to the address Uvicorn prints. Keep the Supabase secret key and Gemini key in the backend environment. The Google OAuth secret belongs in the Supabase dashboard.
6. With the API and worker running, run `npm ci` and `npm run dev` in `frontend`. Open the local site, select **Continue with Google**, then click the upload area in **My workspace** and choose a small PDF or DOCX. Processing status updates automatically. **Ready to explore** means the file can answer questions; **Refresh status** checks it manually.

Use `SSL_CERT_FILE=/etc/ssl/cert.pem` before the Uvicorn command on a Mac where Python has no default certificate bundle.

## Finish local setup

Apply [application features](supabase/migrations/20261117000500_application_features.sql) in the Supabase SQL Editor after the first four migrations. Store these example budgets in the ignored `api/.env`. The daily counters reset at midnight UTC.

```dotenv
SOURCELEAF_DAILY_DEMO_LIMIT=30
SOURCELEAF_DAILY_AI_LIMIT=60
SOURCELEAF_DAILY_AI_ACCOUNT_LIMIT=20
SOURCELEAF_DAILY_INDEX_LIMIT=1000
SOURCELEAF_DAILY_UPLOADS_LIMIT=10
SOURCELEAF_DAILY_UPLOADS_ACCOUNT_LIMIT=3
SOURCELEAF_MAX_DOCUMENT_CHUNKS=1000
SOURCELEAF_SUMMARY_SECTIONS=6
SOURCELEAF_SUMMARY_SECTION_CHARS=60000
```

Leave the hosted variables empty for local use. After updating the dependencies with `npm ci` in `frontend`, restart the web server, API, and indexing worker. On the home page, try sample Q&A without signing in. Then sign in, select one or more ready files, and try Ask, a follow-up, Explain, and Summarize. Reload the page and reopen the saved chat. A **Try again** button is shown for failed jobs. Use **New conversation** to change the sources for a saved chat. Click a source beneath an answer to open its supporting excerpt.

Each Ask or Explain reserves one embedding and one generation call, plus one generation call for a follow-up search rewrite. Summaries use the number of section and combination calls. Indexing is bounded by daily upload reservations, a daily embedding-call budget, and the maximum number of chunks per file. The limits are application controls. Gemini also enforces its own per-project quotas.

## Hosted indexing on Vercel

Deploy both services from the repository root using `vercel.json`. In Vercel, copy the required API and browser variables from the example files and your local configuration. Use your deployment's HTTPS origin, with no path, for both `SOURCELEAF_WORKFLOW_ORIGIN` and `SOURCELEAF_API_ORIGIN`. Set a high-entropy `SOURCELEAF_WORKER_TOKEN` on both services. Keep it server-side. Set the Supabase Auth Site URL and allowed callback URL for that same deployment host.

When the API queues an upload, the web service starts a Vercel Workflow which calls the protected API once per indexing batch. Queuing is idempotent and the database guards each batch and workflow start. The hosted flow has no local worker dependency. Verify on the deployed URL with a small sample upload, close its tab after the job is queued, then return and confirm the document is ready. [Vercel Workflow](https://vercel.com/workflows)
