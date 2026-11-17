"use client";

import type { Session } from "@supabase/supabase-js";
import { BookOpen, FileText, MessageSquare, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AssistantAnswer, type Answer, type Citation } from "./answer-sources";
import { request } from "./api-request";
import type { Upload } from "./private-upload";
import { Composer, ConversationHeader, FileChoice, MAX_DOCUMENTS, NewChatButton, Notice, Welcome, Working, Workspace, type Mode } from "./workspace-ui";

type Chat = { id: string; title: string };
type Message = { turn_number: number; role: "user" | "assistant"; content: string; sources: Citation[] };
type SavedChat = Chat & { document_ids: string[]; messages: Message[] };

export default function DocumentQuestions({ session, uploads, uploadsLoading, listingError, uploadPanel, uploadBusy, onRefresh, onCheckJob }: {
  session: Session; uploads: Upload[]; uploadsLoading: boolean; listingError: string; uploadPanel: ReactNode;
  uploadBusy: boolean; onRefresh: () => void; onCheckJob: (file: Upload) => void;
}) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [chat, setChat] = useState<SavedChat | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [mode, setMode] = useState<Mode>("ask");
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const token = session.access_token;
  const ready = uploads.filter((file) => file.job?.status === "ready");
  const ids = chat?.document_ids ?? (selection ?? ready.slice(0, MAX_DOCUMENTS).map((file) => file.id)).filter((id) => ready.some((file) => file.id === id));
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void request<Chat[]>("/api/chats", token).then((items) => {
      if (!cancelled) {
        setChats((current) => [...current.filter((local) => !items.some((item) => item.id === local.id)), ...items]);
        setHistoryLoading(false); setHistoryError("");
      }
    }, () => { if (!cancelled) { setHistoryError("Your saved conversations couldn't be loaded."); setHistoryLoading(false); } });
    return () => { cancelled = true; };
  }, [token, historyRefresh]);

  useEffect(() => {
    if (chat || pendingQuestion || answer) end.current?.scrollIntoView({ block: "nearest" });
  }, [chat, pendingQuestion, answer]);

  function newChat() {
    setChat(null); setAnswer(null); setError(""); setQuestion(""); setPendingQuestion(""); setMode("ask");
  }

  async function openChat(id: string) {
    setBusy(true); setOpening(true); setError("");
    try {
      setChat(await request<SavedChat>(`/api/chats/${id}`, token));
      setAnswer(null); setPendingQuestion(""); setQuestion(""); setMode("ask");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The conversation couldn't be opened."); }
    finally { setBusy(false); setOpening(false); }
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const text = question.trim();
    if (!ids.length || ids.length > MAX_DOCUMENTS || (mode !== "summarize" && !text)) {
      setError(`Choose one to ${MAX_DOCUMENTS} ready documents${mode !== "summarize" ? " and enter a question" : ""}.`); return;
    }
    setSelection([...ids]);
    setError(""); setAnswer(null); setBusy(true);
    setPendingQuestion(mode === "summarize" ? "Summarize the selected documents." : text);
    try {
      if (mode === "summarize") {
        setAnswer(await request<Answer>("/api/documents/summarize", token, "POST", { document_ids: ids }));
      } else {
        const result = await request<Answer>("/api/documents/ask", token, "POST", { question: text, document_ids: ids, mode, chat_id: chat?.id, save_chat: true });
        setAnswer(result);
        if (result.chat_id) {
          // Keep the successful response visible and the chat usable even if reloading history fails.
          const turn = (chat?.messages.at(-1)?.turn_number ?? 0) + 1;
          const saved: SavedChat = { id: result.chat_id, title: chat?.title ?? text, document_ids: ids, messages: [
            ...(chat?.messages ?? []),
            { turn_number: turn, role: "user", content: text, sources: [] },
            { turn_number: turn, role: "assistant", content: result.answer, sources: result.sources },
          ] };
          setChat(saved); setAnswer(null); setPendingQuestion("");
          setChats((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
        }
        setQuestion("");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your request couldn't be completed. Please try again."); }
    finally { setBusy(false); }
  }

  return <Workspace sidebar={<>
    <NewChatButton onClick={newChat} disabled={busy} />
    <section className="sidebar-section" aria-labelledby="documents-heading">
      <div className="sidebar-heading"><h2 className="section-label" id="documents-heading">YOUR DOCUMENTS</h2><div className="sidebar-heading-actions"><span className="section-count">{uploads.length}</span><button className="icon-button" aria-label="Refresh documents" title="Refresh documents" onClick={onRefresh} disabled={uploadBusy}><RefreshCw size={14} aria-hidden="true" /></button></div></div>
      <p className="sidebar-note">{chat ? "Start a new conversation to change sources." : `Choose up to ${MAX_DOCUMENTS} files to explore together.`}</p>
      {listingError && <Notice>{listingError}</Notice>}
      {uploadsLoading && <p className="sidebar-empty" role="status">Loading your library…</p>}
      {!uploadsLoading && !uploads.length && !listingError && <div className="empty-library"><FileText size={26} strokeWidth={1.3} aria-hidden="true" /><p>Your next discovery<br />starts with a document.</p></div>}
      <div className="file-list">{uploads.map((file) => <div key={file.id} className="upload-file">
        <FileChoice document={file} checked={ids.includes(file.id)} disabled={busy || !!chat || file.job?.status !== "ready" || (!ids.includes(file.id) && ids.length >= MAX_DOCUMENTS)} subtitle={file.job?.status === "ready" ? "Ready to explore" : file.job?.status === "queued" ? "Waiting to be processed" : file.job?.status === "processing" ? "Reading your document…" : file.job?.status === "failed" ? "Could not process this file" : "Upload complete"} onChange={() => setSelection(ids.includes(file.id) ? ids.filter((id) => id !== file.id) : [...ids, file.id])} />
        {file.job?.error_code && <p className="file-error" role="status">{file.job.error_code}</p>}
        {file.job?.status !== "ready" && <div className="file-action"><button className="retry-button" disabled={uploadBusy} onClick={() => onCheckJob(file)}>{file.job?.status === "failed" ? "Try again" : file.job ? "Refresh status" : "Start processing"}</button>{file.job?.status === "processing" && <span className="processing-line" aria-hidden="true" />}</div>}
      </div>)}</div>
    </section>
    {uploadPanel}
    <section className="sidebar-section history-section" aria-labelledby="history-heading">
      <div className="sidebar-heading"><h2 className="section-label" id="history-heading">YOUR CONVERSATIONS</h2></div>
      {historyLoading && <p className="sidebar-empty" role="status">Loading conversations…</p>}
      {historyError && <><Notice>{historyError}</Notice><button className="retry-button" disabled={busy} onClick={() => setHistoryRefresh((value) => value + 1)}>Try again</button></>}
      {!historyLoading && !historyError && !chats.length && <p className="sidebar-empty">Your questions will find a home here.</p>}
      <div className="history-list">{chats.map((item) => <button key={item.id} className={`history-item${chat?.id === item.id ? " history-active" : ""}`} aria-current={chat?.id === item.id ? "true" : undefined} disabled={busy} title={item.title} onClick={() => void openChat(item.id)}><MessageSquare size={15} aria-hidden="true" /><span className="history-title">{item.title}</span></button>)}</div>
    </section>
    <div className="sidebar-footer"><BookOpen size={18} strokeWidth={1.5} aria-hidden="true" /><div><strong>Your ideas, all in one place.</strong><span>Read. Ask. Understand.</span></div></div>
  </>}>
    <ConversationHeader title={chat?.title ?? "New conversation"} count={ids.length} />
    <div className="chat-scroll">
      {!chat && !pendingQuestion && !answer ? <Welcome empty={ready.length === 0} disabled={busy || !ids.length} onPrompt={(nextMode, prompt) => { setMode(nextMode); setQuestion(prompt); }} /> : <div className="message-list" role="log" aria-label="Conversation" aria-live="polite">
        {chat?.messages.map((message) => message.role === "user" ? <article className="user-message" key={`${message.turn_number}:user`}><p className="user-label">You</p><p className="user-content">{message.content}</p></article> : <AssistantAnswer key={`${message.turn_number}:assistant`} answer={{ answer: message.content, sources: message.sources }} />)}
        {pendingQuestion && <article className="user-message"><p className="user-label">You</p><p className="user-content">{pendingQuestion}</p></article>}
        <AssistantAnswer answer={answer} />
        {answer && mode === "summarize" && <p className="summary-save-note">Summaries are shown here and are not added to chat history.</p>}
        {busy && !opening && <Working summarize={mode === "summarize"} />}
        <div className="message-end" ref={end} />
      </div>}
      {opening && <p className="working" role="status">Opening your conversation…</p>}
    </div>
    {error && <div className="conversation-notice"><Notice>{error}</Notice></div>}
    <Composer question={question} setQuestion={setQuestion} mode={mode} setMode={setMode} busy={busy} disabled={ids.length === 0} count={ids.length} onSubmit={ask} />
  </Workspace>;
}
