import json

from fastapi import APIRouter, HTTPException

from ..models.schemas import VerifyRequest, VerifyResponse
from ..services.gemini import analyze_text

router = APIRouter()


@router.post("/verify", response_model=VerifyResponse)
async def verify(request: VerifyRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    try:
        result = await analyze_text(request.text, request.url)
        return result
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}")
        raise HTTPException(
            status_code=502, detail="Failed to parse Gemini response as JSON"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
