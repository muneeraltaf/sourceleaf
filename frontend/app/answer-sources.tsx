import { ChevronDown, Files, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type Citation = {
  chunk_id: string;
  filename: string;
  location: string;
  content: string;
};

export type Answer = {
  answer: string;
  sources: Citation[];
  chat_id?: string | null;
};

export function AnswerContent({ content }: { content: string }) {
  return (
    <div className="answer-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => <span>{alt ?? ""}</span>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function AnswerSources({ sources }: { sources: Citation[] }) {
  if (!sources.length) return null;

  return (
    <div className="answer-sources">
      <p className="sources-heading">
        <Files size={14} aria-hidden="true" />
        Sources <span>({sources.length})</span>
      </p>
      {sources.map((source, index) => (
        <details className="source-detail" key={source.chunk_id}>
          <summary className="source-summary">
            <span className="source-number" aria-label={`Source ${index + 1}`}>
              {index + 1}
            </span>
            <span className="source-meta">
              <span className="source-filename">{source.filename}</span>
              <span className="source-location">{source.location}</span>
            </span>
            <ChevronDown size={16} className="source-chevron" aria-hidden="true" />
          </summary>
          <blockquote className="source-excerpt">{source.content}</blockquote>
        </details>
      ))}
    </div>
  );
}

export function AssistantAnswer({ answer }: { answer?: Answer | null }) {
  if (!answer) return null;

  return (
    <article className="assistant-answer" aria-label="Sourceleaf answer">
      <div className="assistant-label">
        <span className="assistant-avatar">
          <FileText size={16} aria-hidden="true" />
        </span>
        <span>source<span className="brand-accent">leaf.</span></span>
      </div>
      <AnswerContent content={answer.answer} />
      <AnswerSources sources={answer.sources} />
    </article>
  );
}
