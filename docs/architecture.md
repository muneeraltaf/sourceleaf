# Sourceleaf — Architecture

| Part | Choice |
|---|---|
| Web app | Next.js on Vercel |
| API and parsing | FastAPI on Vercel, with `pypdf` and `python-docx` |
| Sign-in and files | Supabase Auth with Google and private Supabase Storage |
| Data and vector search | Supabase Postgres with `pgvector` |
| AI | Gemini embeddings for search and Gemini Flash for responses |
| Background jobs | Vercel Workflow, with job status and progress saved in Postgres |

## How it works

1. The browser uploads files directly to Supabase Storage. The API verifies ownership and starts an indexing job.
2. The job extracts text, splits it into passages, and saves embeddings in batches. Retries resume from saved progress. A document becomes searchable once indexing finishes.
3. For Ask and Explain, the API searches the selected, authorized files and sends relevant passages to Gemini. It resolves citation IDs to PDF pages or DOCX headings or paragraphs. Summarize reads sections in order and combines section summaries for long files.

Postgres stores documents, jobs, passages, chats, document selections, and messages. Supabase row-level security and storage policies enforce ownership. The public demo can access only the preloaded samples. Gemini keys stay on the server.
