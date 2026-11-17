"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Session } from "@supabase/supabase-js";
import { ArrowUpRight, FilePlus2, LoaderCircle, LogOut, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { request } from "./api-request";
import { supabaseConfig } from "./auth/config";
import DocumentQuestions from "./document-questions";
import SampleQuestions from "./sample-questions";
import { Notice } from "./workspace-ui";

type Reservation = { document_id: string; bucket: string; path: string };
export type Job = { status: "queued" | "processing" | "ready" | "failed"; error_code: string | null };
export type Upload = { id: string; filename: string; job: Job | null };

export default function PrivateUpload({ authFailed }: { authFailed: boolean }) {
  const [supabase] = useState(() => { const config = supabaseConfig(); return config ? createBrowserClient(config.url, config.key) : null; });
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(true);
  const [uploading, setUploading] = useState("");
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState("");
  const [listingError, setListingError] = useState("");
  const [pollingError, setPollingError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<"library" | "samples">("library");
  const fileInput = useRef<HTMLInputElement>(null);
  const currentOwner = useRef<string | null>(null);
  // A new epoch also invalidates requests if an account signs out and back in.
  const ownerEpoch = useRef(0);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextOwner = nextSession?.user.id ?? null;
      if (currentOwner.current !== nextOwner) {
        currentOwner.current = nextOwner;
        ownerEpoch.current += 1;
        setUploads([]); setUploadsLoading(!!nextOwner); setUploading("");
        setError(""); setListingError(""); setPollingError("");
        setBusy(false); setAuthBusy(false); setDragging(false); setView("library");
        if (fileInput.current) fileInput.current.value = "";
      }
      setSession(nextSession); setSessionLoaded(true);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const owner = session?.user.id;
  const token = session?.access_token;
  useEffect(() => {
    if (!supabase || !owner) return;
    const controller = new AbortController();
    const epoch = ownerEpoch.current;
    void supabase.from("documents").select("id,filename,status,ingestion_jobs(status,error_code)")
      .eq("owner_id", owner).order("created_at", { ascending: false }).limit(50).abortSignal(controller.signal)
      .then(({ data, error: queryError }) => {
        if (controller.signal.aborted || ownerEpoch.current !== epoch) return;
        setUploadsLoading(false);
        if (queryError) { setListingError("Your documents couldn't be loaded. Try refreshing the library."); return; }
        setListingError("");
        const saved = (data as unknown as { id: string; filename: string; status: string; ingestion_jobs: Job | null }[] ?? []).map((item) => ({
          id: item.id, filename: item.filename,
          job: item.status === "ready" ? { status: "ready" as const, error_code: null } : item.ingestion_jobs,
        }));
        setUploads((current) => {
          if (ownerEpoch.current !== epoch) return current;
          const ids = new Set(saved.map((item) => item.id));
          return [...current.filter((item) => !ids.has(item.id)), ...saved];
        });
      });
    return () => controller.abort();
  }, [supabase, owner, refresh]);

  const pendingIds = uploads.filter((file) => file.job?.status === "queued" || file.job?.status === "processing").map((file) => file.id).join(",");
  useEffect(() => {
    if (!token || !pendingIds) return;
    const epoch = ownerEpoch.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const results = await Promise.allSettled(pendingIds.split(",").map(async (id) => ({ id, job: await request<Job>(`/api/documents/${id}/ingestion`, token!) })));
      if (cancelled || ownerEpoch.current !== epoch) return;
      setPollingError(results.some((result) => result.status === "rejected")
        ? "Some status updates couldn't be loaded. We'll try again automatically, or you can refresh a file's status."
        : "");
      for (const result of results) {
        if (result.status === "fulfilled") updateJob(result.value.id, result.value.job, epoch);
      }
      timer = setTimeout(poll, 5000);
    }
    timer = setTimeout(poll, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [token, pendingIds]);

  async function signIn() {
    if (!supabase) { setError("Sign-in is temporarily unavailable. You can still try the sample documents."); return; }
    const epoch = ownerEpoch.current;
    setAuthBusy(true); setError("");
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: new URL("/auth/callback", window.location.origin).href } });
      if (authError) throw authError;
    } catch {
      if (ownerEpoch.current === epoch) { setError("Google sign-in couldn't start. Please try again."); setAuthBusy(false); }
    }
  }

  async function signOut() {
    if (!supabase) return;
    const epoch = ownerEpoch.current;
    setAuthBusy(true); setError("");
    try { const { error: authError } = await supabase.auth.signOut({ scope: "local" }); if (authError) throw authError; }
    catch { if (ownerEpoch.current === epoch) setError("You couldn't be signed out. Please try again."); }
    finally { if (ownerEpoch.current === epoch) setAuthBusy(false); }
  }

  function updateJob(id: string, job: Job, epoch: number) {
    setUploads((items) => ownerEpoch.current !== epoch ? items : items.map((item) => item.id === id ? { ...item, job } : item));
  }

  async function upload(files: File[]) {
    if (!supabase || !session || session.user.id !== currentOwner.current || busy) return;
    if (!files.length) return;
    const epoch = ownerEpoch.current;
    setBusy(true); setError("");
    const failures: string[] = [];
    for (const file of files) {
      if (ownerEpoch.current !== epoch) return;
      if (!/\.(pdf|docx)$/i.test(file.name) || !file.size) { failures.push(`${file.name}: choose a non-empty PDF or DOCX file.`); continue; }
      setUploading(file.name);
      try {
        const reservation = await request<Reservation>("/api/documents/uploads", session.access_token, "POST", { filename: file.name, size_bytes: file.size });
        if (ownerEpoch.current !== epoch) return;
        const contentType = file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const { error: uploadError } = await supabase.storage.from(reservation.bucket).upload(reservation.path, file, { contentType, upsert: false });
        if (ownerEpoch.current !== epoch) return;
        if (uploadError) throw new Error("The file couldn't be uploaded. Please try again.");
        setUploads((items) => ownerEpoch.current !== epoch ? items : [{ id: reservation.document_id, filename: file.name, job: null }, ...items]);
        const job = await request<Job>(`/api/documents/${reservation.document_id}/ingestion`, session.access_token, "POST");
        if (ownerEpoch.current !== epoch) return;
        updateJob(reservation.document_id, job, epoch);
      } catch (cause) {
        if (ownerEpoch.current !== epoch) return;
        failures.push(`${file.name}: ${cause instanceof Error ? cause.message : "Upload failed."}`);
      }
    }
    if (ownerEpoch.current !== epoch) return;
    setError(failures.join(" ")); setUploading(""); setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function checkJob(file: Upload) {
    if (!session || session.user.id !== currentOwner.current || busy) return;
    const epoch = ownerEpoch.current;
    setBusy(true); setError("");
    const retry = file.job?.status === "failed";
    try {
      const job = await request<Job>(`/api/documents/${file.id}/ingestion${retry ? "/retry" : ""}`, session.access_token, file.job && !retry ? "GET" : "POST");
      if (ownerEpoch.current !== epoch) return;
      updateJob(file.id, job, epoch); setPollingError("");
    }
    catch (cause) { if (ownerEpoch.current === epoch) setError(cause instanceof Error ? cause.message : "The document status couldn't be refreshed."); }
    finally { if (ownerEpoch.current === epoch) setBusy(false); }
  }

  const uploadPanel = <>
    <input className="sr-only" tabIndex={-1} ref={fileInput} type="file" id="private-document" aria-label="Choose PDF or DOCX files" accept=".pdf,.docx" multiple disabled={busy} onChange={(event) => void upload(Array.from(event.target.files ?? []))} />
    <button className={`upload-zone${dragging ? " dragging" : ""}`} disabled={busy} onClick={() => fileInput.current?.click()}
      onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
      onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void upload(Array.from(event.dataTransfer.files)); }}>
      {busy ? <LoaderCircle className="spin" size={24} aria-hidden="true" /> : <UploadCloud size={24} strokeWidth={1.5} aria-hidden="true" />}<strong>{uploading ? "Uploading your document…" : "Drop a little knowledge here"}</strong><span>{uploading || "PDF or DOCX · Click to browse"}</span>
    </button>
    {uploading && <p role="status" className="upload-status">Keep this tab open until the upload finishes.</p>}
    <p className="upload-caption">Text-based files only. Use public or non-confidential material.</p>
    {pollingError && pendingIds && <p className="upload-status" role="status">{pollingError}</p>}
  </>;

  return <div className="app-shell">
    <header className="app-header">
      <Link className="brand" href="/" aria-label="sourceleaf home">
        source<span className="brand-accent">leaf.</span>
      </Link>
      <div className="header-actions">
        {session ? <><span className="account-name" title={session.user.email}>{typeof session.user.user_metadata.full_name === "string" ? session.user.user_metadata.full_name.split(" ")[0] || "Your workspace" : "Your workspace"}</span><button className="button button-quiet" onClick={signOut} disabled={authBusy || busy}><LogOut size={15} aria-hidden="true" />Sign out</button></> : <button className="button button-primary" onClick={signIn} disabled={authBusy || (!!supabase && !sessionLoaded)}>{authBusy ? "Opening Google…" : "Continue with Google"}<ArrowUpRight size={16} aria-hidden="true" /></button>}
      </div>
    </header>
    {(error || authFailed) && <div className="app-notice"><Notice>{error || "Google sign-in didn't finish. Please try signing in again."}</Notice></div>}
    {session && <nav className="workspace-tabs" aria-label="Workspace"><button className={view === "library" ? "active" : ""} aria-current={view === "library" ? "page" : undefined} onClick={() => setView("library")}><FilePlus2 size={15} aria-hidden="true" />My workspace</button><button className={view === "samples" ? "active" : ""} aria-current={view === "samples" ? "page" : undefined} onClick={() => setView("samples")}>Try samples</button></nav>}
    <main id="conversation" tabIndex={-1} className="workspace-panels">
      {session && supabase && <div className="workspace-panel" hidden={view !== "library"} key={session.user.id}>
        <DocumentQuestions session={session} uploads={uploads} uploadsLoading={uploadsLoading} listingError={listingError} uploadPanel={uploadPanel} uploadBusy={busy} onRefresh={() => setRefresh((value) => value + 1)} onCheckJob={checkJob} />
      </div>}
      <div className="workspace-panel" hidden={!!session && view !== "samples"}>
        <SampleQuestions signedIn={!!session} onSignIn={session ? () => setView("library") : signIn} authBusy={authBusy || (!!supabase && !sessionLoaded)} />
      </div>
    </main>
  </div>;
}
