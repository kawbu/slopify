# Slopify

Chrome extension for right-click fact-checking of selected text, with switchable backends:

- AWS Lambda + Bedrock + Tavily retrieval
- Gemini FastAPI backend (local)

---

## Codebase Map

### Extension runtime

- `manifest.json`:
  - Manifest V3 config
  - Uses `background.js` as the service worker
  - Popup entry: `frontend/popup/popup.html`
- `background.js`:
  - Context-menu trigger (`Fact-check with Slopify`)
  - Backend routing (AWS vs Gemini)
  - Request retries/path probing for AWS
  - Stores popup state and AWS debug output
- `frontend/popup/popup.html`, `frontend/popup/popup.css`, `frontend/popup/popup.js`:
  - UI rendering (risk gauge, summary, claims, red flags)
  - Backend provider settings and URL settings
  - Displays AWS request debug panel

### Gemini backend (FastAPI)

- `backend/app/main.py`: FastAPI app + CORS + `/health`
- `backend/app/routes/verify.py`: `POST /verify`
- `backend/app/services/gemini.py`: Gemini prompting + strict JSON parsing
- `backend/app/models/schemas.py`: request/response schema
- `backend/app/config.py`: environment config (`GEMINI_API_KEY`, `GEMINI_MODEL`)

### AWS backend (Lambda)

- `backend/lambda/verify.js`: Lambda handler (`POST /verify`) + validation/CORS
- `backend/lambda/verifyService.js`: full Bedrock + Tavily verification pipeline

---

## End-to-End Extension Flow

1. User highlights text on a page.
2. User clicks context menu: `Fact-check with Slopify`.
3. `background.js` captures selection and writes loading state to storage.
4. Popup reads storage and shows loading UI.
5. Service worker calls selected backend (`lambda` or `gemini`).
6. Response is normalized and written back to storage.
7. Popup renders risk score, summary, claims, and red flags.

State keys used in storage include:

- `slopifyState`
- `lastResult`
- `backendType` / `backendProvider`
- `awsBackendUrl` / `geminiBackendUrl` / `backendUrl`
- `lastAwsRequestDebug`

---

## Gemini Backend: Prompting and Parsing

Gemini logic lives in `backend/app/services/gemini.py`.

### Prompt strategy

- Uses a strict `SYSTEM_PROMPT` instructing the model to return JSON only.
- Required schema:
  - `verdict`
  - `confidence` (0-100)
  - `claims[]` with `claim`, `assessment`, `explanation`
  - `red_flags[]`
  - `summary`
- User message includes selected text and optional source URL.

### Deterministic generation

- Uses `temperature=0.0` to reduce variability.

### Robust parsing

- Handles accidental markdown code fences
- Extracts JSON object from surrounding text when needed
- Validates with `VerifyResponse` schema before returning

---

## AWS Pipeline: How Verification Works

AWS logic is split into a thin handler + a pipeline service.

### 1) API entrypoint (`backend/lambda/verify.js`)

- Parses event body and validates `snippet`
- Handles `OPTIONS`
- Calls `verifySnippet()`
- Returns `{ ok, result }`

### 2) Pipeline (`backend/lambda/verifyService.js`)

The main stages are:

1. **Claim extraction**
	- Either cheap sentence splitting or Bedrock claim extraction (feature-flagged)
2. **Model-first pass (optional)**
	- Quick high-confidence verdict without retrieval
3. **Tavily retrieval**
	- Search per claim, dedupe URLs
4. **Evidence building**
	- Optionally fetch pages + extract readable text
	- Build compact evidence snippets
5. **Final Bedrock verdict**
	- Prompt includes claims + evidence snippets
	- Returns `label`, `confidence`, `explanation`, `citations`
6. **Scoring + diagnostics**
	- Converts verdict to numeric score
	- Returns timings/count diagnostics

### Lambda response (core fields)

- `score` (0-100)
- `label` (`Supported | Refuted | Misleading | Unclear`)
- `confidence` (0-1)
- `reasoning`
- `citations`
- `claims`

### Extension normalization for AWS

`background.js` maps AWS output into popup schema:

- verdict mapping (`Supported -> Accurate`, etc.)
- confidence normalized to percent
- summary fallback from reasoning/explanation
- red flags from backend `red_flags` or derived from non-accurate claims

---

## Backend Selection and URL Handling

`background.js` reads provider config and routes requests:

- `lambda` request body: `snippet`, `text`, `url`, `source`, `user_context`
- `gemini` request body: `text`, `url`

AWS endpoint probing supports multiple API Gateway URL shapes:

- `<base>`
- `<base>/verify`
- `<base>/prod/verify`

Gemini probing supports local fallback:

- `http://localhost:8000`
- `http://localhost:8787`

AWS attempt details are written to `lastAwsRequestDebug` and shown in popup.

---

## Environment Variables

### Gemini (FastAPI)

- `GEMINI_API_KEY`
- `GEMINI_MODEL` (default: `gemini-3-flash-preview`)

### AWS (Lambda pipeline)

- `AWS_REGION`
- `BEDROCK_MODEL_ID`
- `AWS_BEARER_TOKEN_BEDROCK` (or `BEDROCK_BEARER_TOKEN`)
- `TAVILY_API_KEY`
- Optional performance/tuning flags in `backend/lambda/verifyService.js`

---

## Local Development Notes

- Gemini backend health endpoint: `GET /health`
- In current docker compose, backend is exposed on port `8000`
- If you use `8787`, set `geminiBackendUrl` in popup settings

---

## Known Behavior

- If AWS API Gateway stage/path is misconfigured, popup may show `Not Found`
- AWS debug panel in popup shows attempted URLs and response previews
- Summary and red flags in popup use fallbacks to avoid empty sections
