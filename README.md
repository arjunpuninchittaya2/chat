# chat

A Node.js LLM chat web app with:

- Streaming assistant responses
- Conversation history sidebar
- Model sync from `GET /models` (default: `anthropic/claude-sonnet-latest`)
- User-configurable API base URL + API key in Settings
- Web search grounding via `/exa/search`
- File attachments (images, PDFs, and other files)
- Inline image rendering in chat
- Optional reasoning blocks
- Material-inspired dark mode with light mode toggle

## Run

```bash
npm install
npm start
```

Open http://localhost:3000.

## Test

```bash
npm test
```
