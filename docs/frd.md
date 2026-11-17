# Sourceleaf — Functional Requirements

| ID | Requirement |
|---|---|
| FR-01 | Visitors can ask questions about the preloaded PDF and DOCX without signing in. Google sign-in is required for uploads and saved chats. |
| FR-02 | Signed-in users can upload multiple PDFs and DOCX files. The app shows each file as uploading, processing, ready, or failed. Users can retry failed indexing. Processing continues after they close the tab. |
| FR-03 | The app rejects unsupported or oversized files and explains when a file has no readable text. Upload and daily usage limits are configurable. When a limit is reached, the app explains why. |
| FR-04 | Users can select one or more ready files. Ask answers from those files, uses recent chat context for follow-ups, and says when there is too little evidence. Explain uses the same sources and simpler language. |
| FR-05 | Summarize covers the selected files in order and combines section summaries for long documents. |
| FR-06 | Clicking a citation opens the supporting excerpt and shows its filename and PDF page or DOCX heading or paragraph. |
| FR-07 | Signed-in users can reopen their chats. Each account can access only its own uploads and chats, plus the public samples. |

## Acceptance checks

- Ask a question that needs facts from both file types and open both citations.
- Close the tab during indexing, then return and use the file once it is ready.
- Sign in with a second account and verify that the first account’s files and chats are inaccessible.
