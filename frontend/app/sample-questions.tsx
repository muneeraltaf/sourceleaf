"use client";

import { ArrowUpRight, BookOpen, FilePlus2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AssistantAnswer, type Answer } from "./answer-sources";
import { request } from "./api-request";
import { Composer, ConversationHeader, FileChoice, MAX_DOCUMENTS, NewChatButton, Notice, Welcome, Working, Workspace, type DocumentItem } from "./workspace-ui";

export default function SampleQuestions({ onSignIn, authBusy, signedIn = false }: { onSignIn: () => void; authBusy: boolean; signedIn?: boolean }) {
  const [samples, setSamples] = useState<DocumentItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [question, setQuestion] = useState("");
  const [sentQuestion, setSentQuestion] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void request<DocumentItem[]>("/api/samples", null).then((items) => {
      if (cancelled) return;
      setSamples(items); setSelected(items.slice(0, MAX_DOCUMENTS).map((item) => item.id));
      setLoading(false); setLoadError("");
    }, () => {
      if (!cancelled) { setLoadError("The sample files couldn't be loaded. Please try again."); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [reload]);

  useEffect(() => {
    if (busy || answer) end.current?.scrollIntoView({ block: "nearest" });
  }, [busy, answer]);

  function reset() { setAnswer(null); setSentQuestion(""); setQuestion(""); setError(""); }
  function toggle(id: string) {
    setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const text = question.trim();
    if (!text || !selected.length || selected.length > MAX_DOCUMENTS) {
      setError(`Choose one to ${MAX_DOCUMENTS} sample files and enter a question.`); return;
    }
    setError(""); setAnswer(null); setSentQuestion(text); setBusy(true);
    try {
      setAnswer(await request<Answer>("/api/samples/ask", null, "POST", { question: text, document_ids: selected }));
      setQuestion("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The sample question failed. Try again.");
    } finally { setBusy(false); }
  }

  return (
    <Workspace sidebar={<>
      <NewChatButton onClick={reset} disabled={busy} />
      <section className="sidebar-section" aria-labelledby="sample-files-heading">
        <div className="sidebar-heading"><h2 className="section-label" id="sample-files-heading">SAMPLE DOCUMENTS</h2><span className="section-count">{samples.length}</span></div>
        <p className="sidebar-note">A few pages to get you started.</p>
        {loading && <p role="status" className="sidebar-empty">Loading your sample library…</p>}
        {loadError && <><Notice>{loadError}</Notice><button className="button button-quiet" onClick={() => { setLoading(true); setReload((value) => value + 1); }}><RefreshCw size={14} aria-hidden="true" />Try again</button></>}
        {!loading && !loadError && samples.length === 0 && <p className="sidebar-empty">No sample files are available yet. Sign in to explore your own documents.</p>}
        <div className="file-list">{samples.map((sample) => <FileChoice key={sample.id} document={sample} checked={selected.includes(sample.id)} disabled={busy || (!selected.includes(sample.id) && selected.length >= MAX_DOCUMENTS)} onChange={() => toggle(sample.id)} subtitle="Sample document" />)}</div>
      </section>
      <button className="upload-zone" onClick={onSignIn} disabled={authBusy}><FilePlus2 size={24} strokeWidth={1.5} aria-hidden="true" /><strong>Bring your own documents</strong><span>{signedIn ? "Explore your own PDFs & DOCX" : "Sign in to upload PDFs & DOCX"}</span><span className="upload-link">{signedIn ? "Open your workspace" : "Get started"} <ArrowUpRight size={14} aria-hidden="true" /></span></button>
      <section className="sidebar-section history-section" aria-label="Chat history"><h2 className="section-label">YOUR CONVERSATIONS</h2><p className="sidebar-empty">{signedIn ? "Your saved chats are in My workspace. Sample answers stay in this tab." : "A good question is worth coming back to. Sign in to save your chats."}</p></section>
      <div className="sidebar-footer"><BookOpen size={18} strokeWidth={1.5} aria-hidden="true" /><div><strong>A space for your curiosity.</strong><span>Read. Ask. Understand.</span></div></div>
    </>}>
      <ConversationHeader title="New conversation" count={selected.length} sample />
      <div className="chat-scroll">
        {!sentQuestion ? <Welcome sample onPrompt={(_, prompt) => setQuestion(prompt)} disabled={busy || selected.length === 0} /> : <div className="message-list" role="log" aria-label="Conversation" aria-live="polite"><article className="user-message"><p className="user-label">You</p><p className="user-content">{sentQuestion}</p></article><AssistantAnswer answer={answer} />{busy && <Working />}<div className="message-end" ref={end} /></div>}
      </div>
      {error && <div className="conversation-notice"><Notice>{error}</Notice></div>}
      <Composer sample question={question} setQuestion={setQuestion} count={selected.length} busy={busy} disabled={loading || selected.length === 0} onSubmit={ask} />
    </Workspace>
  );
}
