import json
import re

from google import genai
from google.genai import types

from ..config import settings
from ..models.schemas import VerifyResponse

SYSTEM_PROMPT = """Fact-check the given text.
Return ONLY a JSON object — no markdown, no extra text.

Schema:
{"verdict":"Accurate|Mostly Accurate|Mixed|Mostly Inaccurate|Inaccurate|Unverifiable","confidence":0-100,"claims":[{"claim":"...","assessment":"Accurate|Inaccurate|Misleading|Unverifiable|Lacks Context","explanation":"One sentence. Correct the claim if wrong."}],"red_flags":["..."],"summary":"1-2 sentences."}

Rules: Mark unverifiable claims as "Unverifiable". Keep explanations to one sentence. Note opinions in summary."""


def _get_client():
    return genai.Client(api_key=settings.gemini_api_key)


async def analyze_text(text: str, url: str | None = None) -> VerifyResponse:
    client = _get_client()

    user_message = f'Fact-check the following passage:\n\n"{text}"'
    if url:
        user_message += f"\n\n[Source URL: {url}]"

    response = await client.aio.models.generate_content(
        model=settings.gemini_model,
        contents=user_message,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=0.0,
        ),
    )

    raw = response.text.strip()
    # Strip markdown code fences if present (```json ... ``` or ``` ... ```)
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
