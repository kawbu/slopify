const { verifySnippet } = require("./verifyService");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS,POST",
      "Access-Control-Allow-Headers": "Content-Type"
    },
    body: JSON.stringify(body)
  };
}

function parseBody(event) {
  if (!event?.body) {
    return {};
  }

  if (typeof event.body === "string") {
    try {
      return JSON.parse(event.body);
    } catch {
      throw new Error("Invalid JSON body");
    }
  }

  return event.body;
}

exports.handler = async (event) => {
  try {
    if (event?.requestContext?.http?.method === "OPTIONS" || event?.httpMethod === "OPTIONS") {
      return json(204, {});
    }

    const body = parseBody(event);
    const snippet = typeof body.snippet === "string" ? body.snippet.trim() : "";

    if (!snippet) {
      return json(400, { error: "Missing required field 'snippet'" });
    }

    if (snippet.length > 6000) {
      return json(400, { error: "Snippet too long. Max length is 6000 characters." });
    }

    const result = await verifySnippet({
      snippet,
      source: body.source || "unknown",
      userContext: body.user_context || {},
      url: body.url || null
    });

    return json(200, {
      ok: true,
      result
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message || "Internal server error"
    });
  }
};