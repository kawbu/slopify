# Slopify Web Extension

## 1. Overview

### 1.1 Summary

(Slopify) is a Chrome extension that evaluates websites for Misinformation and Deceptive AI Use:

- Phishing risk  
- AI-generated content likelihood  
- Potential deepfake indicators  

When a user visits a webpage, the extension analyzes page metadata, structure, and content signals, then returns a **0–100 trust score** representing overall risk.
-   0 = Very Safe
-   100 = High Risk

### System Components

The system consists of:

- Chrome Extension (context menu + selected text capture)
- API Gateway (`POST /verify`)
- Lambda verifier orchestrator
- Bedrock model + live web retrieval via Tavily

---

## 2. Goals & Non-Goals

### 2.1 Goals

- Allow users to highlight text and run a quick right-click action
- Send selected snippet to AWS verification endpoint and return a score

---

### 2.2 Non-Goals

- ❌ Database / caching (for now)

The application focuses strictly on **webpage-level analysis**.

---

## 3. System Architecture
User <br>
↓<br>
Chrome Extension<br>
↓<br>
Context menu: "Check if Slopped"<br>
↓<br>
API Gateway `POST /verify`<br>
↓<br>
Lambda verifier<br>
↓<br>
Bedrock + Retrieval<br>
↓<br>
Score + reasoning response<br>

---

## 4. Implemented AWS Lambda code

Lambda files:

- [backend/lambda/verify.js](backend/lambda/verify.js) (API handler)
- [backend/lambda/verifyService.js](backend/lambda/verifyService.js) (Bedrock + retrieval orchestration)

Expected request body:

```json
{
	"snippet": "text selected by user",
	"source": "chrome-extension",
	"url": "https://example.com/article",
	"user_context": {
		"pageTitle": "Example",
		"browserLocale": "en-US"
	}
}
```

Response shape:

```json
{
	"ok": true,
	"result": {
		"score": 67,
		"label": "Supported",
		"confidence": 0.74,
		"reasoning": "...",
		"citations": []
	}
}
```

### Required Lambda environment variables

- `AWS_REGION` (example: `us-east-1`)
- `BEDROCK_MODEL_ID` (recommended for latency: `amazon.nova-micro-v1:0`)
- `AWS_BEARER_TOKEN_BEDROCK` (or `BEDROCK_BEARER_TOKEN`)
- `TAVILY_API_KEY`

### Extension configuration

Set your API Gateway URL in [background.js](background.js):

- `VERIFY_API_URL = "https://<api-id>.execute-api.<region>.amazonaws.com/prod/verify"`

### Live fact-check flow implemented

1. Extension sends: `snippet`, `user_context`, `url`
2. Lambda extracts 1–3 atomic claims (Bedrock)
3. Lambda performs web retrieval via Tavily
4. Lambda fetches top URLs and extracts main article text
5. Lambda asks Bedrock for verdict using only provided evidence
6. Lambda returns `label`, `confidence`, `reasoning`, `citations`

### Additional Lambda env vars for live retrieval

- `TAVILY_API_KEY` (required)
- `TAVILY_SEARCH_DEPTH` (optional, default `advanced`)
- `MAX_FETCHED_URLS` (optional, default `4`)
- `MAX_EVIDENCE_SNIPPETS` (optional, default `8`)
