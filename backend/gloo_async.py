# gloo_async.py
import os, asyncio, json, time, random, pathlib
import httpx

BASE = os.getenv("GLOO_BASE", "https://platform.ai.gloo.com")
TOKEN_URL = f"{BASE}/oauth2/token"
CLIENT_ID = os.getenv("GLOO_CLIENT_ID")
CLIENT_SECRET = os.getenv("GLOO_CLIENT_SECRET")
MODEL = os.getenv("GLOO_MODEL", "us.anthropic.claude-sonnet-4-20250514-v1:0")

# Prompts used across concurrent runs
PROMPTS = [
    "Give a one-line summary of Sermon on the Mount.",
    "Give a one-line summary of the birth of Jesus.",
    "Give a one-line summary of Moses and the 10 commandments.",
    "Explain the symbolism of the seven seals in two sentences.",
    "Explain Psalm 23 in 2 sentences."
]

CONCURRENCY   = int(os.getenv("GLOO_CONCURRENCY", str(len(PROMPTS))))
POLL_TIMEOUT  = int(os.getenv("GLOO_TIMEOUT", "45"))     # seconds
POLL_MIN_INT  = float(os.getenv("GLOO_INTERVAL_MIN", "1.0"))
POLL_MAX_INT  = float(os.getenv("GLOO_INTERVAL_MAX", "3.0"))
OUT_DIR       = pathlib.Path(os.getenv("GLOO_OUT_DIR", "./out"))
OUT_DIR.mkdir(parents=True, exist_ok=True)

assert CLIENT_ID and CLIENT_SECRET, "Set GLOO_CLIENT_ID and GLOO_CLIENT_SECRET"

_token = None
_token_exp = 0.0

def _rand_interval(a,b): return a + (b-a)*random.random()

async def get_token():
    global _token, _token_exp
    if _token and time.time() < _token_exp - 60:
        return _token
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            TOKEN_URL,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={"grant_type": "client_credentials", "scope": "api/access"},
            auth=(CLIENT_ID, CLIENT_SECRET),
        )
        r.raise_for_status()
        data = r.json()
        _token = data["access_token"]
        _token_exp = time.time() + data["expires_in"]
        return _token

async def auth_headers():
    return {"Authorization": f"Bearer {await get_token()}", "Content-Type": "application/json"}

def log_headers(tag: str, r: httpx.Response):
    rid = r.headers.get("x-request-id") or r.headers.get("x-amzn-requestid") or r.headers.get("x-correlation-id")
    usvc = r.headers.get("x-envoy-upstream-service-time")
    print(f"{tag} status={r.status_code} request_id={rid} upstream_ms={usvc}")

# ---------- Controls ----------
async def sse_completions(prompt: str):
    url = f"{BASE}/ai/v1/chat/completions"
    payload = {"model": MODEL, "messages": [{"role": "user", "content": prompt}], "stream": True}
    headers = await auth_headers()
    headers["Accept"] = "text/event-stream"
    out_path = OUT_DIR / "control_sse.txt"
    async with httpx.AsyncClient(timeout=None) as c, c.stream("POST", url, headers=headers, json=payload) as resp:
        log_headers("SSE", resp)
        resp.raise_for_status()
        with out_path.open("w", encoding="utf-8") as f:
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"): 
                    continue
                chunk = line[5:].strip()
                if chunk == "[DONE]": 
                    break
                f.write(chunk + "\n")
    print(f"SSE control written -> {out_path}")

async def nonstream_completions(prompt: str):
    url = f"{BASE}/ai/v1/chat/completions"
    payload = {"model": MODEL, "messages": [{"role": "user", "content": prompt}]}
    headers = await auth_headers()
    async with httpx.AsyncClient(timeout=120) as c:
        r = await c.post(url, headers=headers, json=payload)
        log_headers("COMPLETIONS", r)
        r.raise_for_status()
        data = r.json()
    path = OUT_DIR / "control_completions.json"
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"Non-stream control written -> {path}")

# ---------- Session flow ----------
async def create_chat(prompt: str):
    url = f"{BASE}/ai/v1/chat"
    payload = {"model": MODEL, "messages": [{"role": "user", "content": prompt}]}
    headers = await auth_headers()
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(url, headers=headers, json=payload)
        log_headers("CREATE_CHAT", r)
        r.raise_for_status()
        d = r.json()
        return d.get("chat_id") or d.get("id"), d

async def get_chat(chat_id: str):
    url = f"{BASE}/ai/v1/chat"
    headers = await auth_headers()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(url, headers=headers, params={"chat_id": chat_id})
        log_headers(f"GET_CHAT {chat_id}", r)
        r.raise_for_status()
        return r.json()

async def poll_until_messages(chat_id: str):
    deadline = time.time() + POLL_TIMEOUT
    tries = 0
    last_seen = None
    while time.time() < deadline:
        data = await get_chat(chat_id)
        stamp = f"{data.get('updated_at')}|{len(data.get('messages') or [])}"
        if stamp != last_seen:
            print(f"{chat_id}: updated_at={data.get('updated_at')} messages={len(data.get('messages') or [])}")
            last_seen = stamp
        msgs = data.get("messages") or []
        if msgs:
            return {"chat_id": chat_id, "messages": msgs, "final_payload": data}
        # exponential-ish backoff with jitter
        tries += 1
        await asyncio.sleep(min(POLL_MAX_INT, POLL_MIN_INT*(1.5**tries)) + _rand_interval(0,0.3))
    return {"chat_id": chat_id, "timeout": True}

async def run_session(idx: int):
    prompt = PROMPTS[idx % len(PROMPTS)]
    cid, create_payload = await create_chat(prompt)
    print(f"[run {idx}] chat_id={cid} prompt={prompt}")
    res = await poll_until_messages(cid)
    res["prompt"] = prompt
    # persist per-chat JSONL for easy sharing
    out = OUT_DIR / f"chat_{cid}.jsonl"
    with out.open("w", encoding="utf-8") as f:
        f.write(json.dumps({"phase":"create","payload":create_payload}) + "\n")
        f.write(json.dumps({"phase":"result","payload":res}) + "\n")
    print(f"[run {idx}] saved -> {out}")
    return res

async def main():
    print("=== controls ===")
    try:
        await asyncio.wait_for(sse_completions(PROMPTS[0]), timeout=45)
    except Exception as e:
        print("SSE control failed:", repr(e))
    try:
        await asyncio.wait_for(nonstream_completions(PROMPTS[1]), timeout=60)
    except Exception as e:
        print("Non-stream control failed:", repr(e))

    print("\n=== parallel chat sessions ===")
    tasks = [asyncio.create_task(run_session(i)) for i in range(CONCURRENCY)]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    timeouts = [r for r in results if isinstance(r, dict) and r.get("timeout")]
    summary = {"runs": len(results), "timeouts": len(timeouts)}
    (OUT_DIR / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\nSummary: {summary['runs']} runs, {summary['timeouts']} timeouts")
    print(f"Artifacts in: {OUT_DIR.resolve()}")

if __name__ == "__main__":
    asyncio.run(main())
