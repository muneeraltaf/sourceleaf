import { timingSafeEqual } from "node:crypto";

import { start } from "workflow/api";

import { indexDocument } from "../../../workflows/index-document";

export async function POST(request: Request) {
  const token = process.env.SOURCELEAF_WORKER_TOKEN;
  if (!token) return new Response(null, { status: 404 });

  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return new Response(null, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (typeof body?.jobId !== "string" ||
      !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.jobId)) {
    return new Response(null, { status: 400 });
  }

  const run = await start(indexDocument, [body.jobId]);
  return Response.json({ runId: run.runId }, { status: 202 });
}
