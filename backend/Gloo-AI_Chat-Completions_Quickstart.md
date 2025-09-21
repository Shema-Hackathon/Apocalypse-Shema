# Gloo AI — Chat Completions Quickstart (OAuth2 `client_credentials`)

Guide de référence **prêt à mettre dans GitHub** pour appeler l’endpoint officiel et stateless `POST /ai/v1/chat/completions` de Gloo AI.  
Inclut cURL, tests de santé, SSE, pièges courants, et un **tableau de configuration Postman** (Token + Test).

> ℹ️ **Important**
> - La page de **doc “open/playground”** peut afficher un **exemple statique** (le fameux “Hello…”). Pour une exécution **live**, utilise **Gloo AI Studio** (authentifié) ou un client HTTP (cURL, httpx, etc.).
> - `POST /ai/v1/chat/completions` est **stateless** (schéma OpenAI‑like) : garde l’historique **côté client** et renvoie‑le dans `messages` à chaque appel.
> - L’endpoint `POST /ai/v1/chat` (et `GET .../ai/v1/chat?chat_id=`) est **non documenté / non‑GA** : il peut renvoyer `chat_id` mais **`messages: []`**. Pour la production, reste sur **`.../chat/completions`**.

---

## Table des matières
1. [Pré‑requis](#pré-requis)
2. [Variables d’environnement](#variables-denvironnement)
3. [1) Token OAuth2](#1-token-oauth2)
4. [2) Chat Completion (non‑stream)](#2-chat-completion-non-stream)
5. [3) Chat Completion (SSE)](#3-chat-completion-sse)
6. [Tests de santé minimaux](#tests-de-santé-minimaux)
7. [Pièges & Conseils](#pièges--conseils)
8. [Configuration “tableau” (Postman)](#configuration-tableau-postman--token--test-dapi)
9. [Appendice Postman](#appendice-postman)

---

## Pré‑requis
- Identifiants Gloo AI: **CLIENT_ID**, **CLIENT_SECRET** avec le scope `api/access`.
- Accès réseau à `https://platform.ai.gloo.com`.

## Variables d’environnement
```bash
export GLOO_BASE="https://platform.ai.gloo.com"
export GLOO_CLIENT_ID="YOUR_CLIENT_ID"
export GLOO_CLIENT_SECRET="YOUR_CLIENT_SECRET"
export GLOO_MODEL="us.meta.llama3-3-70b-instruct-v1:0"
```

---

## 1) Token OAuth2
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
Et cette structure :
```json
{
  "model": "us.meta.llama3-3-70b-instruct-v1:0",
  "messages": [
    {"role":"system","content":"You are a Revelation scholar..."},
    {"role":"user","content":"Who are the 24 elders?"},
    {"role":"assistant","content":"..."},
    {"role":"user","content":"Give 3 scriptural cross-references."}
  ]
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
> Postman affiche mal le **SSE**. Préfère `curl`/`httpx` pour un streaming lisible.

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

## Tests de santé minimaux

**A. Echo exact**
```bash
curl -sS -H "Authorization: Bearer $TOKEN"      -H "Content-Type: application/json"      "$GLOO_BASE/ai/v1/chat/completions"      -d '{
       "model": "'"$GLOO_MODEL"'",
       "messages": [{"role":"user","content":"Return EXACTLY this string and nothing else: PING-9473e0"}],
       "max_tokens": 8,
       "temperature": 0.0,
       "stream": false
     }' | jq .
```

**B. Déterminisme (`n`)**
```bash
curl -sS -H "Authorization: Bearer $TOKEN"      -H "Content-Type: application/json"      "$GLOO_BASE/ai/v1/chat/completions"      -d '{
       "model": "'"$GLOO_MODEL"'",
       "messages": [{"role":"user","content":"Say ONE word that is exactly SUN."}],
       "n": 3,
       "temperature": 0.0
     }' | jq '.choices[].message.content'
```

---

## Pièges & Conseils
- **Stateless** : toujours renvoyer l’historique complet dans `messages`. Le dernier item doit être un **`role":"user"`**.
- `Content-Type` = `application/json`.
- Surveille `usage.prompt_tokens` (éviter les prompts géants).
- Garde les headers de réponse (`x-request-id`, etc.) pour le support si besoin.
- **Évite** `POST /ai/v1/chat` et `GET .../ai/v1/chat?chat_id=` (non‑GA → `messages: []`).

---

## Configuration “tableau” (Postman) — Token & Test d’API

### 1) Requête Token (client_credentials)

| Clé            | Valeur                                                                            |
|----------------|------------------------------------------------------------------------------------|
| **Nom**        | Get OAuth Token                                                                    |
| **Méthode**    | POST                                                                               |
| **URL**        | `https://platform.ai.gloo.com/oauth2/token`                                        |
| **Headers**    | `Content-Type: application/x-www-form-urlencoded`                                  |
| **Body Type**  | x-www-form-urlencoded                                                              |
| **Body Data**  | `grant_type=client_credentials` • `scope=api/access`                               |
| **Auth**       | Basic Auth (`username = CLIENT_ID`, `password = CLIENT_SECRET`)                    |
| **Réponse**    | `access_token` (à copier / script Tests ci-dessous le stocke automatiquement)      |

**Script _Tests_ (Postman)**
```js
let data = pm.response.json();
pm.collectionVariables.set("access_token", data.access_token);
```

---

### 2) Test d’API (bon endpoint — **/ai/v1/chat/completions**) ✅

| Clé            | Valeur                                                                                                       |
|----------------|---------------------------------------------------------------------------------------------------------------|
| **Nom**        | Send Chat Message (Completions — WORKS)                                                                       |
| **Méthode**    | POST                                                                                                          |
| **URL**        | `https://platform.ai.gloo.com/ai/v1/chat/completions`                                                         |
| **Headers**    | `Content-Type: application/json` • `Authorization: Bearer {{access_token}}`                                   |
| **Body Type**  | raw / JSON                                                                                                    |
| **Body Data**  | ```json
{
  "model": "us.meta.llama3-3-70b-instruct-v1:0",
  "messages": [{"role":"user","content":"Explain the seven seals in two sentences."}],
  "max_tokens": 1024,
  "stream": false,
  "temperature": 0.7
}
``` |
| **Réponse**    | Objet `chat.completion` → lire `choices[0].message.content`                                                   |

> **Pourquoi celui‑ci marche** : endpoint officiel **stateless**, compatible OpenAI. Pas de persistance serveur — **historique côté client**.

---

### 3) Test d’API (ancien endpoint — **/ai/v1/chat**) ❌

| Clé            | Valeur                                                                                      |
|----------------|----------------------------------------------------------------------------------------------|
| **Nom**        | Send Chat Message (Legacy Chat — NOT GA)                                                    |
| **Méthode**    | POST                                                                                         |
| **URL**        | `https://platform.ai.gloo.com/ai/v1/chat`                                                    |
| **Headers**    | `Content-Type: application/json` • `Authorization: Bearer {{access_token}}`                  |
| **Body Type**  | raw / JSON                                                                                   |
| **Body Data**  | `{"query": "Votre question sur l'Apocalypse..."}`                                           |
| **Réponse**    | Peut renvoyer `chat_id`, mais `GET .../ai/v1/chat?chat_id=...` → **`messages: []`**          |

> **Pourquoi il ne marchait pas** : non documenté, non‑GA. Il ne fournit pas d’historique exploitable ; le champ `query` n’est pas l’interface contractuelle. **Ne pas utiliser en production**.

---

## Appendice Postman

- Collection recommandée : `Gloo_AI_Postman_Collection_v2.2.json` (inclut Auth, Completions, SSE, “Table Examples”, et Legacy Chat en lecture seule).
- Environnement : `Gloo_AI_Environment.postman_environment.json` (variables `BASE`, `CLIENT_ID`, `CLIENT_SECRET`, `MODEL`, etc.).

**Sécurité** : ne committe pas vos secrets. Utilise des variables d’environnement / vaults / Postman Environments ignorés via `.gitignore`.
