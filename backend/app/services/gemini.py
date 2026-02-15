import json

import google.generativeai as genai

from ..config import settings
from ..models.schemas import VerifyResponse

SYSTEM_PROMPT = """You are a fact-checking assistant. Analyze the provided text passage for factual accuracy.

Return your analysis as a JSON object with this exact structure:
{
  "verdict": "Accurate" or "Mostly Accurate" or "Mixed" or "Mostly Inaccurate" or "Inaccurate" or "Unverifiable",
  "confidence": 0-100,
  "claims": [
    {
      "claim": "The specific claim extracted from the text",
      "assessment": "Accurate" or "Inaccurate" or "Misleading" or "Unverifiable" or "Lacks Context",
      "explanation": "Brief explanation of why this claim is rated this way. If the claim is wrong, provide the correct information."
    }
  ],
  "red_flags": ["Any concerning patterns: emotional manipulation, logical fallacies, missing context, etc."],
  "summary": "A 2-3 sentence overall assessment of the passage's factual reliability. Provide additional context when the text is incomplete or misleading."
}

Guidelines:
- Extract and evaluate each distinct factual claim in the passage.
- For well-known facts, state whether they are accurate.
- For claims you cannot verify, mark them as "Unverifiable" rather than guessing.
- Be specific in explanations. Reference what you know to be true when correcting claims.
- If the text is opinion rather than factual claims, note this in the summary.
- Do not add any text outside the JSON object. Return only valid JSON."""


def _get_model():
    genai.configure(api_key=settings.gemini_api_key)
    return genai.GenerativeModel(
        model_name=settings.gemini_model,
        system_instruction=SYSTEM_PROMPT,
    )


async def analyze_text(text: str, url: str | None = None) -> VerifyResponse:
    model = _get_model()

    user_message = f'Fact-check the following passage:\n\n"{text}"'
    if url:
        user_message += f"\n\n[Source URL: {url}]"

    response = await model.generate_content_async(
        user_message,
    )

    raw = response.text.strip()
    # Strip markdown code fences if present (```json ... ``` or ``` ... ```)
    import re
    match = re.match(r"^```(?:json)?\s*\n(.*?)```\s*$", raw, re.DOTALL)
    if match:
        raw = match.group(1).strip()

    # Try to extract JSON object if there's extra text around it
    if not raw.startswith("{"):
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start != -1 and end > start:
            raw = raw[start:end]

    parsed = json.loads(raw)
    return VerifyResponse(**parsed)
