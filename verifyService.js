const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const { BedrockRuntimeClient, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");
const { tavily } = require("@tavily/core");

const REGION = process.env.AWS_REGION || "us-east-1";
const MODEL_ID = process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-5-sonnet-20241022-v2:0";
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_SEARCH_DEPTH = process.env.TAVILY_SEARCH_DEPTH || "advanced";
const MAX_FETCHED_URLS = Number(process.env.MAX_FETCHED_URLS || 4);
const MAX_EVIDENCE_SNIPPETS = Number(process.env.MAX_EVIDENCE_SNIPPETS || 8);

const bedrockRuntime = new BedrockRuntimeClient({ region: REGION });
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

async function callBedrockJson(prompt, maxTokens = 400) {
  const response = await bedrockRuntime.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: {
        maxTokens,
        temperature: 0.1
      }
    })
  );

  const text = response?.output?.message?.content?.[0]?.text || "";
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
  for (const claim of claims) {
    const query = url ? `${claim} source:${url}` : claim;

    const payload = await tavilyClient.search(query, {
      searchDepth: TAVILY_SEARCH_DEPTH,
      maxResults: 5,
      includeAnswer: false,
      includeRawContent: false,
      topic: "general",
      includeDomains,
      excludeDomains
    });

    const results = Array.isArray(payload?.results) ? payload.results : [];
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

  return deduped.slice(0, Math.max(3, MAX_FETCHED_URLS));
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
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": "SlopifyFactCheckBot/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  const html = await response.text();
  const article = extractMainTextFromHtml(html, url);
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
      snippet: text.slice(0, 1200)
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
  const claims = await extractClaims({ snippet, userContext, url });
  const searchMatches = await searchClaims({ claims, userContext, url });

  const pages = [];
  for (const item of searchMatches.slice(0, Math.max(3, MAX_FETCHED_URLS))) {
    try {
      const page = await fetchAndExtractPage(item.url);
      pages.push(page);
    } catch {
      // skip failing URLs
    }
  }

  const evidenceSnippets = buildEvidenceSnippets(pages, searchMatches);

  const verdictRaw = await callBedrockJson(
    buildVerdictPrompt({ snippet, claims, evidenceSnippets, userContext, url }),
    500
  );

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
      evidenceSnippets: evidenceSnippets.length
    }
  };
}

module.exports = {
  verifySnippet
};
