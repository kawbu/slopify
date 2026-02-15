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

    return json(200, {
      ok: true,
      result
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error?.message || "Internal server error"
    });
  }
};
