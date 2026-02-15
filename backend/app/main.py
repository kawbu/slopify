from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes.verify import router as verify_router

app = FastAPI(title="Slopify API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r"^chrome-extension://.*$",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(verify_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
