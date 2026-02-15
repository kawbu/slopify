from pydantic import BaseModel


class VerifyRequest(BaseModel):
    text: str
    url: str | None = None


class ClaimAnalysis(BaseModel):
    claim: str
    assessment: str
    explanation: str


class VerifyResponse(BaseModel):
    verdict: str
    confidence: int
    claims: list[ClaimAnalysis]
    red_flags: list[str]
    summary: str
