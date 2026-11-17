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
