# Text-to-SQL Playground

This project provides a standalone text-to-SQL playground with two operating modes:

- **Mock mode (default)** – rule-based heuristics convert text into illustrative SQL.
- **GPT-4.1 mode** – prompts are proxied through a lightweight Node/Express server that calls OpenAI and can execute safe `SELECT` queries against a local SQLite sample database.

---

## Prerequisites

- Node.js 18+ (for the backend proxy)
- An OpenAI API key with access to GPT-4.1

---

## 1. Start the Backend Proxy

```bash
cd server
npm install
echo OPENAI_API_KEY=sk-your-key >> .env   # or use your preferred secrets manager
npm run start
```

The server boots on `http://localhost:4000` by default and exposes:

- `POST /api/text-to-sql` – forwards prompts to GPT-4.1 and returns the generated SQL.
- `POST /api/run-sql` – executes read-only `SELECT` queries against a seeded SQLite database. Destructive statements are rejected.
- `GET /api/health` – health/status information, including sample data counts.

> **Safety:** The execution endpoint blocks any non-SELECT statements and only processes a single statement per request. Extend validation if you introduce broader SQL capabilities.

---

## 2. Open the Frontend

The frontend is entirely static. Open `index.html` in your browser (double-click or serve locally). Enable “Use GPT-4.1” to switch from mock generation to the live server.

The UI now includes:

- Toggle between mock and GPT-powered conversions.
- “Run SQL” button that calls the proxy and renders results in a table.
- Status messaging for conversions and query execution.

> **Customization:** Set `window.API_BASE_URL` before loading `app.js` to target a non-default backend URL.

---

## Project Structure

```
.
├── index.html        # Standalone UI
├── style.css         # Styling
├── app.js            # Client logic (mock + GPT modes)
└── server/           # Express proxy + SQLite sample data
    ├── server.js
    └── package.json
```

---

## Next Steps / Ideas

- Add authentication or rate limiting to the proxy before exposing it publicly.
- Replace the SQLite demo database with connections to your actual warehouse.
- Enhance prompt engineering by passing real table schemas or sampled rows to GPT-4.1.
- Capture a full chat history to support follow-up questions.

Enjoy exploring natural-language queries with SQL!

