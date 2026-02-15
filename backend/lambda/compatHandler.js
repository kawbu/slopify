const { verifySnippet } = require("./verifyService");

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "*",
  "Access-Control-Allow-Headers": "*"
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

function parseBody(event) {
  if (!event?.body) {
    return {};
  }

  let rawBody = event.body;
  if (event.isBase64Encoded && typeof rawBody === "string") {
    rawBody = Buffer.from(rawBody, "base64").toString("utf8");
  }

  if (typeof rawBody === "string") {
    try {
      return JSON.parse(rawBody);
    } catch {
      throw new Error("Invalid JSON body");
    }
  }

  return rawBody;
}

function extractSnippet(body) {
  const candidates = [
    body?.snippet,
    body?.text,
    body?.selectionText,
    body?.selectedText,
    body?.content
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function toPercentConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 50;
  }
  if (n <= 1) {
    return Math.max(0, Math.min(100, Math.round(n * 100)));
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

function mapVerdictLabel(label, confidencePct) {
  if (label === "Supported") {
    return confidencePct >= 80 ? "Mostly Accurate" : "Partially Accurate";
  }
  if (label === "Refuted") {
    return "Inaccurate";
  }
  if (label === "Misleading") {
    return "Misleading";
  }
  return "Unclear";
}

function mapAssessmentFromLabel(label) {
  if (label === "Supported") {
    return "Accurate";
  }
  if (label === "Refuted") {
    return "Inaccurate";
  }
  if (label === "Misleading") {
    return "Misleading";
  }
  return "Unverified";
}

function normalizeClaims(claims, label, fallbackExplanation) {
  const assessment = mapAssessmentFromLabel(label);
  const explanation = fallbackExplanation || "Assessment derived from available evidence.";
  const list = Array.isArray(claims) ? claims : [];

  return list.slice(0, 8).map((item) => {
    if (item && typeof item === "object") {
      return {
        claim: String(item.claim || item.text || "").trim(),
        assessment: String(item.assessment || assessment),
        explanation: String(item.explanation || explanation)
      };
    }

    return {
      claim: String(item || "").trim(),
      assessment,
      explanation
    };
  }).filter((c) => c.claim.length > 0);
}

function buildRedFlags(result, confidencePct) {
  const flags = [];
  const label = String(result?.label || "");
  const citations = Array.isArray(result?.citations) ? result.citations : [];

  if (label === "Refuted") {
    flags.push("contradicted by sources");
  }
  if (label === "Misleading") {
    flags.push("missing context");
  }
  if (label === "Unclear") {
    flags.push("insufficient evidence");
  }
  if (citations.length === 0) {
    flags.push("no cited sources");
  }
  if (confidencePct < 60) {
    flags.push("low confidence");
  }

  return [...new Set(flags)];
}

function toClientSchema(result) {
  const label = String(result?.label || "Unclear");
  const confidence = toPercentConfidence(result?.confidence);
  const verdict = mapVerdictLabel(label, confidence);
  const summary = String(result?.reasoning || result?.summary || "No summary provided.");
  const claims = normalizeClaims(result?.claims, label, summary);
  const red_flags = buildRedFlags(result, confidence);

  return {
    verdict,
    confidence,
    claims,
    red_flags,
    summary,
    citations: Array.isArray(result?.citations) ? result.citations : [],
    diagnostics: result?.diagnostics || null,
    source: result?.source || null,
    raw_label: label,
    raw_score: result?.score ?? null
  };
}

exports.handler = async (event) => {
  try {
    const method = event?.requestContext?.http?.method || event?.httpMethod;
    if (method === "OPTIONS") {
      return { statusCode: 204, headers: CORS_HEADERS, body: "" };
    }

    const body = parseBody(event);
    const snippet = extractSnippet(body);

    if (!snippet) {
      return json(400, {
        ok: false,
        error: "Missing text input. Provide one of: snippet, text, selectionText, selectedText, content"
      });
    }

    if (snippet.length > 6000) {
      return json(400, {
        ok: false,
        error: "Snippet too long. Max length is 6000 characters."
      });
    }

    const result = await verifySnippet({
      snippet,
      source: body?.source || "unknown",
      userContext: body?.user_context || body?.userContext || {},
      url: body?.url || body?.pageUrl || null
    });

    const normalized = toClientSchema(result);

    return json(200, {
      ok: true,
      ...normalized,
      result: normalized
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error?.message || "Internal server error"
    });
  }
};
