# Gloo AI — Chat Completions Quickstart (OAuth2 `client_credentials`)

A **GitHub-ready reference** for calling Gloo AI’s **official, stateless** endpoint `POST /ai/v1/chat/completions`.  
Includes cURL, health checks, SSE, common pitfalls, and a **Postman configuration table** (Token + Test).

> ℹ️ **Important**
> - The **API Reference “open/playground”** page can show a **static example** (the familiar “Hello…” JSON). For **live** execution, use **Gloo AI Studio** (authenticated) or a real HTTP client (cURL, httpx, etc.).
> - `POST /ai/v1/chat/completions` is **stateless** (OpenAI‑like schema): keep your chat history **client‑side** and include it in `messages` on every call.
> - The endpoint `POST /ai/v1/chat` (and `GET .../ai/v1/chat?chat_id=`) is **undocumented / not GA**: it may return a `chat_id`, but `messages` from subsequent GETs are typically **empty**. For production, stick to **`.../chat/completions`**.

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Variables](#environment-variables)
3. [1) OAuth2 Token](#1-oauth2-token)
4. [2) Chat Completion (non‑stream)](#2-chat-completion-non-stream)
5. [3) Chat Completion (SSE)](#3-chat-completion-sse)
6. [Minimal Health Checks](#minimal-health-checks)
7. [Common Pitfalls & Tips](#common-pitfalls--tips)
8. [Configuration Table (Postman)](#configuration-table-postman--token--api-test)
9. [Postman Appendix](#postman-appendix)

---

## Prerequisites
- Gloo AI credentials: **CLIENT_ID**, **CLIENT_SECRET** with scope `api/access`.
- Network access to `https://platform.ai.gloo.com`.

## Environment Variables
```bash
export GLOO_BASE="https://platform.ai.gloo.com"
export GLOO_CLIENT_ID="YOUR_CLIENT_ID"
export GLOO_CLIENT_SECRET="YOUR_CLIENT_SECRET"
export GLOO_MODEL="us.meta.llama3-3-70b-instruct-v1:0"
```

---

## 1) OAuth2 Token
**HTTP**  
`POST https://platform.ai.gloo.com/oauth2/token`

**Headers**: `Content-Type: application/x-www-form-urlencoded`  
**Auth**: Basic (`username = CLIENT_ID`, `password = CLIENT_SECRET`)  
**Body** (x-www-form-urlencoded):
```
grant_type=client_credentials
scope=api/access
```

**cURL**
```bash
TOKEN="$(curl -sS -u "$GLOO_CLIENT_ID:$GLOO_CLIENT_SECRET"   -H "Content-Type: application/x-www-form-urlencoded"   -d "grant_type=client_credentials&scope=api/access"   "$GLOO_BASE/oauth2/token" | jq -r '.access_token')"

echo "TOKEN acquired? ${#TOKEN} chars"
```

---

## 2) Chat Completion (non‑stream)
**HTTP**  
`POST https://platform.ai.gloo.com/ai/v1/chat/completions`

**Headers**: `Authorization: Bearer <ACCESS_TOKEN>`, `Content-Type: application/json`

**Body**
```json
{
  "model": "us.meta.llama3-3-70b-instruct-v1:0",
  "messages": [
    { "role": "user", "content": "Explain the seven seals in two concise sentences." }
  ],
  "max_tokens": 256,
  "temperature": 0.7,
  "stream": false
}
```

**cURL**
```bash
curl -sS -H "Authorization: Bearer $TOKEN"      -H "Content-Type: application/json"      "$GLOO_BASE/ai/v1/chat/completions"      -d '{
       "model": "'"$GLOO_MODEL"'",
       "messages": [{"role":"user","content":"Explain the seven seals in two concise sentences."}],
       "max_tokens": 256,
       "temperature": 0.7,
       "stream": false
     }' | jq .
```

---

## 3) Chat Completion (SSE)
> Postman often renders **SSE** poorly. Prefer `curl`/`httpx` for readable streaming.

**cURL**
```bash
curl -N   -H "Authorization: Bearer $TOKEN"   -H "Content-Type: application/json"   -H "Accept: text/event-stream"   "$GLOO_BASE/ai/v1/chat/completions"   -d '{
    "model": "'"$GLOO_MODEL"'",
    "messages": [{"role":"user","content":"Reply with only: STREAM-OK"}],
    "stream": true,
    "temperature": 0.0,
    "max_tokens": 8
  }'
```

---

## Minimal Health Checks

**A. Exact echo**
```bash
curl -sS -H "Authorization: Bearer $TOKEN"      -H "Content-Type: application/json"      "$GLOO_BASE/ai/v1/chat/completions"      -d '{
       "model": "'"$GLOO_MODEL"'",
       "messages": [{"role":"user","content":"Return EXACTLY this string and nothing else: PING-9473e0"}],
       "max_tokens": 8,
       "temperature": 0.0,
       "stream": false
     }' | jq .
```

**B. Determinism (`n`)**
```bash
curl -sS -H "Authorization: Bearer $TOKEN"      -H "Content-Type: application/json"      "$GLOO_BASE/ai/v1/chat/completions"      -d '{
       "model": "'"$GLOO_MODEL"'",
       "messages": [{"role":"user","content":"Say ONE word that is exactly SUN."}],
       "n": 3,
       "temperature": 0.0
     }' | jq '.choices[].message.content'
```

---

## Common Pitfalls & Tips
- **Stateless**: always send the **full** conversation in `messages`. The last item must be a **`role":"user"`** message.
- `Content-Type` must be `application/json`.
- Watch `usage.prompt_tokens` (avoid giant prompts).
- Preserve response headers (`x-request-id`, etc.) for support if needed.
- Avoid `POST /ai/v1/chat` and `GET .../ai/v1/chat?chat_id=` (not GA → `messages: []`).

---

## Configuration Table (Postman) — Token & API Test

### 1) Token Request (client_credentials)

| Key           | Value                                                                           |
|---------------|----------------------------------------------------------------------------------|
| **Name**      | Get OAuth Token                                                                  |
| **Method**    | POST                                                                             |
| **URL**       | `https://platform.ai.gloo.com/oauth2/token`                                      |
| **Headers**   | `Content-Type: application/x-www-form-urlencoded`                                |
| **Body Type** | x-www-form-urlencoded                                                            |
| **Body Data** | `grant_type=client_credentials` • `scope=api/access`                             |
| **Auth**      | Basic Auth (`username = CLIENT_ID`, `password = CLIENT_SECRET`)                  |
| **Response**  | `access_token` (copy or auto-store via Postman Tests)                            |

**Postman Tests snippet**
```js
let data = pm.response.json();
pm.collectionVariables.set("access_token", data.access_token);
```

---

### 2) API Test (correct endpoint — **/ai/v1/chat/completions**) ✅

| Key           | Value                                                                                                      |
|---------------|------------------------------------------------------------------------------------------------------------|
| **Name**      | Send Chat Message (Completions — WORKS)                                                                     |
| **Method**    | POST                                                                                                       |
| **URL**       | `https://platform.ai.gloo.com/ai/v1/chat/completions`                                                      |
| **Headers**   | `Content-Type: application/json` • `Authorization: Bearer {{access_token}}`                                |
| **Body Type** | raw / JSON                                                                                                 |
| **Body Data** | ```json
{
  "model": "us.meta.llama3-3-70b-instruct-v1:0",
  "messages": [{"role":"user","content":"Explain the seven seals in two sentences."}],
  "max_tokens": 1024,
  "stream": false,
  "temperature": 0.7
}
``` |
| **Response**  | `chat.completion` object → read `choices[0].message.content`                                               |

> **Why this works**: it’s the **official, stateless** endpoint (OpenAI‑compatible). No server‑side history — keep the chat **client‑side**.

---

### 3) API Test (legacy endpoint — **/ai/v1/chat**) ❌

| Key           | Value                                                                                     |
|---------------|---------------------------------------------------------------------------------------------|
| **Name**      | Send Chat Message (Legacy Chat — NOT GA)                                                   |
| **Method**    | POST                                                                                        |
| **URL**       | `https://platform.ai.gloo.com/ai/v1/chat`                                                   |
| **Headers**   | `Content-Type: application/json` • `Authorization: Bearer {{access_token}}`                 |
| **Body Type** | raw / JSON                                                                                  |
| **Body Data** | `{"query": "Your question about Revelation..."}`                                            |
| **Response**  | May return a `chat_id`, but `GET .../ai/v1/chat?chat_id=...` → **`messages: []`**           |

> **Why it didn’t work**: it’s **undocumented / not GA**. It does not expose usable persisted history; the `query` field is **not** the official interface. **Do not use in production**.

---

## Postman Appendix

- Recommended collection: `Gloo_AI_Postman_Collection_v2.2_EN.json` (includes Auth, Completions, SSE, “Table Examples”, and Legacy Chat for reference only).
- Environment: `Gloo_AI_Environment_EN.postman_environment.json` (variables `BASE`, `CLIENT_ID`, `CLIENT_SECRET`, `MODEL`, etc.).

**Security**: do not commit secrets. Use environment variables, secret managers, or Postman environments excluded via `.gitignore`.
