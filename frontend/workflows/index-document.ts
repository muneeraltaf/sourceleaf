import { FatalError, sleep } from "workflow";

type Batch = { status: string; next_at?: string };

export async function indexDocument(jobId: string) {
  "use workflow";

  for (;;) {
    const batch = await processBatch(jobId);
    if (["ready", "failed", "missing"].includes(batch.status)) return batch.status;
    if (batch.next_at) {
      const next = new Date(batch.next_at);
      if (next.getTime() > Date.now()) await sleep(next);
    }
  }
}

async function processBatch(jobId: string): Promise<Batch> {
  "use step";

  const origin = process.env.SOURCELEAF_API_ORIGIN;
  const token = process.env.SOURCELEAF_WORKER_TOKEN;
  if (!origin || !token) throw new FatalError("Hosted indexing variables are missing.");

  const response = await fetch(new URL(`/api/internal/ingestion/${jobId}`, origin), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    cache: "no-store",
  });
  if (response.status === 404) throw new FatalError("The Sourceleaf worker endpoint is unavailable.");
  if (!response.ok) throw new Error("The indexing batch could not finish.");
  return response.json() as Promise<Batch>;
}
