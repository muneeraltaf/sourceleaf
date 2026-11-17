"use client";

import { ArrowRight, ArrowUp, BookOpen, ChevronDown, FileText, Layers, LoaderCircle, MessageSquare, Plus, ScanText } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";

export type Mode = "ask" | "explain" | "summarize";
export type DocumentItem = { id: string; filename: string };
export const MAX_DOCUMENTS = 5;

export function Workspace({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const sidebarId = useId();
  return (
    <div className="workspace">
      <button className="mobile-library" aria-expanded={open} aria-controls={sidebarId} onClick={() => setOpen(!open)}>
        <Layers size={17} aria-hidden="true" /> Documents & chats <ChevronDown size={17} className={open ? "rotated" : ""} aria-hidden="true" />
      </button>
      <aside id={sidebarId} className={`sidebar${open ? " sidebar-open" : ""}`} aria-label="Documents and chats">{sidebar}</aside>
      <section className="conversation" aria-label="Document conversation">{children}</section>
    </div>
  );
}

export function FileChoice({ document, checked, disabled, onChange, subtitle = "Ready to explore" }: {
  document: DocumentItem; checked: boolean; disabled?: boolean; onChange: () => void; subtitle?: string;
}) {
  return (
    <label className={`file-choice${checked ? " selected" : ""}${disabled ? " unavailable" : ""}`}>
      <span className="file-icon"><FileText size={20} strokeWidth={1.5} aria-hidden="true" /><span>{document.filename.toLowerCase().endsWith(".pdf") ? "PDF" : "DOCX"}</span></span>
      <span className="file-info"><span className="file-name" title={document.filename}>{document.filename}</span><span className="file-subtitle">{subtitle}</span></span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={`Select ${document.filename}`} />
    </label>
  );
}

export function ConversationHeader({ title, count, sample }: { title: string; count: number; sample?: boolean }) {
  return (
    <div className="conversation-header">
      <div className="conversation-title"><MessageSquare size={16} aria-hidden="true" /><span>{title}</span></div>
      <span className="source-count">{sample ? "Sample workspace" : `${count} ${count === 1 ? "source" : "sources"} selected`}</span>
    </div>
  );
}

export function Welcome({ sample, empty, onPrompt, disabled }: { sample?: boolean; empty?: boolean; onPrompt: (mode: Mode, prompt: string) => void; disabled?: boolean }) {
  const headingId = useId();
  const cards: { icon: typeof MessageSquare; title: string; description: string; mode: Mode; prompt: string }[] = sample ? [
    { icon: MessageSquare, title: "Find an answer", description: "Start with the key ideas", mode: "ask", prompt: "What are the key ideas in these documents?" },
    { icon: ScanText, title: "Explore the details", description: "See what matters most", mode: "ask", prompt: "What are the most important details I should know?" },
    { icon: Layers, title: "Connect the dots", description: "Look across your sources", mode: "ask", prompt: "How do these documents relate to each other?" },
  ] : [
    { icon: MessageSquare, title: "Ask a question", description: "Find the answer in your files", mode: "ask", prompt: "What are the key ideas in these documents?" },
    { icon: ScanText, title: "Make it simpler", description: "Understand the tricky parts", mode: "explain", prompt: "Explain the main ideas in simple terms." },
    { icon: BookOpen, title: "Get the big picture", description: "Turn pages into a summary", mode: "summarize", prompt: "" },
  ];
  return (
    <section className="welcome" aria-labelledby={headingId}>
      <p className="eyebrow">A LITTLE MORE CLARITY</p>
      <h1 id={headingId}>Your documents.<br />A new perspective<span className="coral-period">.</span></h1>
      <p className="welcome-description">{empty ? "Add your notes, books, or ideas. Then ask away." : "Ask a question. Untangle an idea. Find the bigger picture."}<br /><span>{sample ? "Try the sample files. No sign-in needed." : "Every answer starts with your sources."}</span></p>
      <div className="prompt-grid">
        {cards.map(({ icon: Icon, title, description, mode, prompt }) => (
          <button key={title} className="prompt-card" disabled={disabled} onClick={(event) => {
            const workspace = event.currentTarget.closest(".workspace");
            onPrompt(mode, prompt);
            requestAnimationFrame(() => workspace?.querySelector("textarea")?.focus());
          }}>
            <Icon size={21} strokeWidth={1.5} aria-hidden="true" /><strong>{title}</strong><span>{description}</span><ArrowRight className="prompt-arrow" size={15} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

export function Composer({ question, setQuestion, mode = "ask", setMode, busy, disabled, onSubmit, count, sample }: {
  question: string; setQuestion: (value: string) => void; mode?: Mode; setMode?: (mode: Mode) => void;
  busy: boolean; disabled?: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; count: number; sample?: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  return (
    <div className="composer-wrap">
      <form className={`composer${busy ? " composer-busy" : ""}`} onSubmit={onSubmit} aria-label="Ask your documents" aria-busy={busy}>
        {mode === "summarize" ? <p className="summary-hint">Bring the key ideas from your selected documents together in one summary.</p> : <>
          <label className="sr-only" htmlFor={inputId}>{mode === "explain" ? "What would you like explained?" : "Your question"}</label>
          <textarea id={inputId} ref={input} name="question" rows={2} required maxLength={2000} value={question} onChange={(event) => setQuestion(event.target.value)} disabled={busy || disabled}
            placeholder={disabled ? "Select a ready document to get started…" : mode === "explain" ? "What would you like to understand better?" : "What would you like to know?"}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !busy) {
                event.preventDefault(); event.currentTarget.form?.requestSubmit();
              }
            }} />
        </>}
        <div className="composer-toolbar">
          {setMode ? <div className="mode-switch" role="group" aria-label="Answer mode">
            {(["ask", "explain", "summarize"] as Mode[]).map((item) => <button type="button" key={item} aria-pressed={mode === item} className={mode === item ? "active" : ""} disabled={busy} onClick={() => setMode(item)}>{item === "summarize" ? "Summarize" : item === "explain" ? "Explain" : "Ask"}</button>)}
          </div> : <span className="composer-context"><FileText size={15} aria-hidden="true" />{count} sample {count === 1 ? "source" : "sources"}</span>}
          <button type="submit" className="send-button" disabled={busy || disabled || count === 0 || (mode !== "summarize" && !question.trim())} aria-label={mode === "summarize" ? "Summarize selected documents" : "Send question"}>
            {busy ? <LoaderCircle className="spin" size={20} aria-hidden="true" /> : <ArrowUp size={21} aria-hidden="true" />}
          </button>
        </div>
      </form>
      <p className="composer-note">{sample ? "Sample answers are not saved. " : ""}AI can make mistakes. Check the sources.<span className="keyboard-hint">Enter to send · Shift + Enter for a new line</span></p>
    </div>
  );
}

export function NewChatButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return <button className="button button-primary new-chat" onClick={onClick} disabled={disabled}><Plus size={18} aria-hidden="true" />New conversation</button>;
}

export function Working({ summarize = false }: { summarize?: boolean }) {
  return <p className="working" role="status"><LoaderCircle className="spin" size={17} aria-hidden="true" />{summarize ? "Bringing your ideas together…" : "Reading your sources…"}</p>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="notice" role="alert">{children}</p>;
}
