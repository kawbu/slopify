const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const { tavily } = require("@tavily/core");

const REGION = process.env.AWS_REGION || "us-east-1";
const MODEL_ID = process.env.BEDROCK_MODEL_ID || "amazon.nova-micro-v1:0";
const BEDROCK_BEARER_TOKEN = process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.BEDROCK_BEARER_TOKEN;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_SEARCH_DEPTH = process.env.TAVILY_SEARCH_DEPTH || "advanced";
const TAVILY_MAX_QUERY_CHARS = Number(process.env.TAVILY_MAX_QUERY_CHARS || 380);
const MAX_FETCHED_URLS = Number(process.env.MAX_FETCHED_URLS || 2);
const MAX_EVIDENCE_SNIPPETS = Number(process.env.MAX_EVIDENCE_SNIPPETS || 8);
const TAVILY_MAX_RESULTS_PER_CLAIM = Number(process.env.TAVILY_MAX_RESULTS_PER_CLAIM || 3);
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 12000);
const PAGE_FETCH_TIMEOUT_MS = Number(process.env.PAGE_FETCH_TIMEOUT_MS || 6000);
const VERDICT_MAX_TOKENS = Number(process.env.VERDICT_MAX_TOKENS || 280);
const MODEL_FIRST_PASS = String(process.env.MODEL_FIRST_PASS || "true").toLowerCase() === "true";
const MODEL_FIRST_CONFIDENCE_THRESHOLD = Number(process.env.MODEL_FIRST_CONFIDENCE_THRESHOLD || 0.85);
const USE_BEDROCK_CLAIM_EXTRACTION = String(process.env.USE_BEDROCK_CLAIM_EXTRACTION || "false").toLowerCase() === "true";
const FETCH_FULL_PAGES = String(process.env.FETCH_FULL_PAGES || "false").toLowerCase() === "true";
const DEBUG_TIMINGS = String(process.env.DEBUG_TIMINGS || "true").toLowerCase() === "true";

const tavilyClient = TAVILY_API_KEY ? tavily({ apiKey: TAVILY_API_KEY }) : null;

function parseModelJson(rawText) {
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function nowMs() {
  return Number(process.hrtime.bigint() / BigInt(1e6));
}

function logTiming(step, startMs, extra = {}) {
  if (!DEBUG_TIMINGS) {
    return;
  }
  const durationMs = nowMs() - startMs;
  console.log(`[timing] ${step}`, JSON.stringify({ durationMs, ...extra }));
}

function clampText(text, maxChars) {
  const s = String(text || "").trim();
  if (s.length <= maxChars) {
    return s;
  }
  return `${s.slice(0, Math.max(0, maxChars - 1))}…`;
}

function toSourceHint(rawUrl, maxChars = 100) {
  if (!rawUrl) {
    return "";
  }

  try {
    const u = new URL(String(rawUrl));
    const compact = `${u.hostname}${u.pathname}`.replace(/\/$/, "");
    return clampText(compact, maxChars);
  } catch {
    return clampText(String(rawUrl), maxChars);
  }
}

function buildTavilyQuery(claim, url) {
  const trimmedClaim = clampText(claim, TAVILY_MAX_QUERY_CHARS);
  const sourceHint = toSourceHint(url, 100);
  if (!sourceHint) {
    return trimmedClaim;
  }

  const withSource = `${trimmedClaim} source:${sourceHint}`;
  if (withSource.length <= TAVILY_MAX_QUERY_CHARS) {
    return withSource;
  }

  return trimmedClaim;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callBedrockJson(prompt, maxTokens = 400) {
  if (!BEDROCK_BEARER_TOKEN) {
    throw new Error("Bedrock bearer token is missing. Set AWS_BEARER_TOKEN_BEDROCK.");
  }

  const endpoint = `https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(MODEL_ID)}/converse`;
  const started = nowMs();
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BEDROCK_BEARER_TOKEN}`
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: {
        maxTokens,
        temperature: 0.1
      }
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Bedrock request failed: HTTP ${response.status} ${raw}`);
  }

  const payload = JSON.parse(raw);
  const text = payload?.output?.message?.content?.[0]?.text || "";
  logTiming("bedrock.converse", started, { status: response.status, maxTokens });
  return parseModelJson(text);
}

function buildClaimExtractionPrompt({ snippet, userContext, url }) {
  return [
    "Turn the snippet into 1-3 atomic factual claims.",
    "Return ONLY JSON: {\"claims\":[\"...\"]}.",
    "Each claim must be independently verifiable, concise, and non-overlapping.",
    "If snippet is opinion or not factual, still return best-effort claims.",
    "",
    `URL context: ${url || "unknown"}`,
    `User context: ${JSON.stringify(userContext || {})}`,
    "",
    "Snippet:",
    snippet
  ].join("\n");
}

async function extractClaims({ snippet, userContext, url }) {
  if (!USE_BEDROCK_CLAIM_EXTRACTION) {
    const coarseClaims = String(snippet || "")
      .split(/[\n\.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 20)
      .slice(0, 2);

    if (coarseClaims.length > 0) {
      return coarseClaims;
    }

    return [String(snippet || "").slice(0, 240)];
  }

  const parsed = await callBedrockJson(buildClaimExtractionPrompt({ snippet, userContext, url }), 220);
  const claims = Array.isArray(parsed?.claims) ? parsed.claims.map((c) => String(c).trim()).filter(Boolean) : [];
  if (claims.length > 0) {
    return claims.slice(0, 3);
  }
  return [snippet.slice(0, 500)];
}

async function searchClaims({ claims, userContext, url }) {
  if (!tavilyClient) {
    throw new Error("Tavily not configured. Set TAVILY_API_KEY.");
  }

  const language = userContext?.language || "en";
  const includeDomains = Array.isArray(userContext?.includeDomains)
    ? userContext.includeDomains
    : undefined;
  const excludeDomains = Array.isArray(userContext?.excludeDomains)
    ? userContext.excludeDomains
    : undefined;

  const allResults = [];
  const claimSearchTasks = claims.map(async (claim) => {
    const started = nowMs();
    const query = buildTavilyQuery(String(claim || ""), url);

    const payload = await tavilyClient.search(query, {
      searchDepth: TAVILY_SEARCH_DEPTH,
      maxResults: TAVILY_MAX_RESULTS_PER_CLAIM,
      includeAnswer: false,
      includeRawContent: false,
      topic: "general",
      language,
      includeDomains,
      excludeDomains
    });

    const results = Array.isArray(payload?.results) ? payload.results : [];
    logTiming("tavily.search", started, { claimLength: claim.length, resultCount: results.length });
    return { claim, results };
  });

  const claimSearchResults = await Promise.all(claimSearchTasks);
  for (const { claim, results } of claimSearchResults) {
    for (const r of results) {
      if (r?.url) {
        allResults.push({
          claim,
          url: r.url,
          title: r.title || "",
          snippet: r.content || "",
          publishedAt: r.publishedAt || null
        });
      }
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const item of allResults) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      deduped.push(item);
    }
  }

  return deduped.slice(0, Math.max(1, MAX_FETCHED_URLS));
}

function extractMainTextFromHtml(html, pageUrl) {
  try {
    const dom = new JSDOM(html, { url: pageUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article?.textContent) {
      return {
        title: article.title || "",
        text: article.textContent.replace(/\s+/g, " ").trim()
      };
    }
  } catch {
    // fallback below
  }

  const plain = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { title: "", text: plain };
}

async function fetchAndExtractPage(url) {
  const started = nowMs();
  const response = await fetchWithTimeout(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": "SlopifyFactCheckBot/1.0"
    }
  }, PAGE_FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  const html = await response.text();
  const article = extractMainTextFromHtml(html, url);
  logTiming("page.fetch_extract", started, {
    status: response.status,
    url,
    htmlLength: html.length,
    textLength: article.text.length
  });
  return {
    url,
    title: article.title,
    text: article.text.slice(0, 20000)
  };
}

function buildEvidenceSnippets(pages, searchMatches) {
  const snippets = [];

  for (const page of pages) {
    const text = page.text || "";
    if (!text) {
      continue;
    }
    snippets.push({
      url: page.url,
      title: page.title || searchMatches.find((m) => m.url === page.url)?.title || "",
      snippet: text.slice(0, 900)
    });
    if (snippets.length >= MAX_EVIDENCE_SNIPPETS) {
      break;
    }
  }

  for (const match of searchMatches) {
    if (!match?.snippet) {
      continue;
    }
    if (snippets.find((s) => s.url === match.url)) {
      continue;
    }
    snippets.push({
      url: match.url,
      title: match.title || "",
      snippet: String(match.snippet).slice(0, 600)
    });
    if (snippets.length >= MAX_EVIDENCE_SNIPPETS) {
      break;
    }
  }

  return snippets;
}

function buildVerdictPrompt({ snippet, claims, evidenceSnippets, userContext, url }) {
  const evidenceText = evidenceSnippets.length
    ? evidenceSnippets
        .map(
          (e, i) =>
            `[${i + 1}] URL: ${e.url}\nTitle: ${e.title}\nExcerpt: ${e.snippet}`
        )
        .join("\n\n")
    : "No evidence snippets available.";

  return [
    "You are a fact-check judge.",
    "Decide Supported/Refuted/Misleading/Unclear using ONLY provided sources.",
    "Return ONLY JSON with keys:",
    "label (Supported|Refuted|Misleading|Unclear), confidence (0-1), explanation, citations.",
    "citations must be an array of objects: {url, snippetIndex, claim, quote}.",
    "Use at most 3 citations.",
    "Keep explanation under 60 words.",
    "If evidence is weak or missing, output Unclear.",
    "",
    `URL context: ${url || "unknown"}`,
    `User context: ${JSON.stringify(userContext || {})}`,
    "",
    "Original snippet:",
    snippet,
    "",
    "Atomic claims:",
    JSON.stringify(claims),
    "",
    "Evidence:",
    evidenceText
  ].join("\n");
}

function buildPriorKnowledgePrompt({ snippet, claims, userContext, url }) {
  return [
    "You are a careful fact-check prefilter.",
    "Use prior knowledge only. Do NOT browse or cite sources.",
    "Return ONLY JSON with keys:",
    "canAnswer (boolean), label (Supported|Refuted|Misleading|Unclear), confidence (0-1), explanation.",
    "Set canAnswer=true only when confidence is very high.",
    "Keep explanation under 40 words.",
    "",
    `URL context: ${url || "unknown"}`,
    `User context: ${JSON.stringify(userContext || {})}`,
    "",
    "Snippet:",
    snippet,
    "",
    "Claims:",
    JSON.stringify(claims)
  ].join("\n");
}

function normalizeVerdict(verdict, evidenceSnippets) {
  const allowed = new Set(["Supported", "Refuted", "Misleading", "Unclear"]);
  const label = allowed.has(verdict?.label) ? verdict.label : "Unclear";
  const confidenceNum = Number(verdict?.confidence);
  const confidence = Number.isFinite(confidenceNum) ? Math.max(0, Math.min(1, confidenceNum)) : 0.5;
  const explanation = verdict?.explanation || "Insufficient high-quality evidence.";

  const citations = Array.isArray(verdict?.citations)
    ? verdict.citations
        .map((c) => ({
          url: c?.url || null,
          snippetIndex: Number.isFinite(Number(c?.snippetIndex)) ? Number(c.snippetIndex) : null,
          claim: c?.claim || null,
          quote: c?.quote || null
        }))
        .filter((c) => Boolean(c.url))
    : [];

  return {
    label,
    confidence,
    explanation,
    citations,
    evidenceUsed: evidenceSnippets.length
  };
}

function scoreFromVerdict(label, confidence) {
  const map = {
    Supported: 15,
    Unclear: 50,
    Misleading: 80,
    Refuted: 92
  };
  const base = map[label] ?? 50;
  return Math.max(0, Math.min(100, Math.round(base * (0.6 + confidence * 0.4))));
}

async function verifySnippet({ snippet, source, userContext, url }) {
  const t0 = nowMs();

  const claimsStarted = nowMs();
  const claims = await extractClaims({ snippet, userContext, url });
  logTiming("pipeline.extract_claims", claimsStarted, { claims: claims.length });

  if (MODEL_FIRST_PASS) {
    const firstPassStarted = nowMs();
    const prior = await callBedrockJson(
      buildPriorKnowledgePrompt({ snippet, claims, userContext, url }),
      160
    );
    logTiming("pipeline.model_first_pass", firstPassStarted);

    const priorConfidence = Number(prior?.confidence);
    const canAnswer = Boolean(prior?.canAnswer);
    const label = ["Supported", "Refuted", "Misleading", "Unclear"].includes(prior?.label)
      ? prior.label
      : "Unclear";
    const confidence = Number.isFinite(priorConfidence)
      ? Math.max(0, Math.min(1, priorConfidence))
      : 0;

    if (canAnswer && confidence >= MODEL_FIRST_CONFIDENCE_THRESHOLD && label !== "Unclear") {
      return {
        score: scoreFromVerdict(label, confidence),
        label,
        confidence,
        reasoning: prior?.explanation || "High-confidence model-first verdict.",
        citations: [],
        claims,
        source,
        diagnostics: {
          searchedUrls: 0,
          fetchedPages: 0,
          evidenceSnippets: 0,
          totalDurationMs: nowMs() - t0,
          strategy: "model-first"
        }
      };
    }
  }

  const searchStarted = nowMs();
  const searchMatches = await searchClaims({ claims, userContext, url });
  logTiming("pipeline.search_claims", searchStarted, { matches: searchMatches.length });

  const pages = [];
  const fetchStarted = nowMs();
  if (FETCH_FULL_PAGES) {
    const selectedMatches = searchMatches.slice(0, Math.max(1, MAX_FETCHED_URLS));
    const pageTasks = selectedMatches.map((item) => fetchAndExtractPage(item.url));
    const pageResults = await Promise.allSettled(pageTasks);
    for (const result of pageResults) {
      if (result.status === "fulfilled") {
        pages.push(result.value);
      }
    }
  }
  logTiming("pipeline.fetch_pages", fetchStarted, { pages: pages.length, enabled: FETCH_FULL_PAGES });

  const evidenceStarted = nowMs();
  const evidenceSnippets = buildEvidenceSnippets(pages, searchMatches);
  logTiming("pipeline.build_evidence", evidenceStarted, { evidenceSnippets: evidenceSnippets.length });

  const verdictStarted = nowMs();
  const verdictRaw = await callBedrockJson(
    buildVerdictPrompt({ snippet, claims, evidenceSnippets, userContext, url }),
    VERDICT_MAX_TOKENS
  );
  logTiming("pipeline.verdict", verdictStarted);

  const verdict = normalizeVerdict(verdictRaw, evidenceSnippets);
  const score = scoreFromVerdict(verdict.label, verdict.confidence);

  return {
    score,
    label: verdict.label,
    confidence: verdict.confidence,
    reasoning: verdict.explanation,
    citations: verdict.citations,
    claims,
    source,
    diagnostics: {
      searchedUrls: searchMatches.length,
      fetchedPages: pages.length,
      evidenceSnippets: evidenceSnippets.length,
      totalDurationMs: nowMs() - t0
    }
  };
}

module.exports = {
  verifySnippet
};