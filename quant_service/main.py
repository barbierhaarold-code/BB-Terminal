"""
Quant microservice — Engle-Granger cointegration test for pairs trading.

Kept as its own tiny FastAPI process (port 6901) rather than a route bolted
onto the pip-installed `openbb-api` package: openbb-api's FastAPI app is
assembled by the OpenBB Platform itself, not code that lives in this repo,
so there's nowhere in-tree to add a route to it. statsmodels/scipy/numpy/
pandas/fastapi/uvicorn are already installed in .venv as OpenBB Platform
dependencies — no new packages needed.

The frontend fetches and date-aligns both price series itself (same daily
closes it already pulls for every other panel), then POSTs the two aligned
arrays here. This service does no data fetching of its own.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import numpy as np
from statsmodels.tsa.stattools import coint

app = FastAPI(title="BBterminal Quant Service")


class CointegrationRequest(BaseModel):
    a: list[float] = Field(..., min_length=10)
    b: list[float] = Field(..., min_length=10)


class CointegrationResponse(BaseModel):
    score: float
    pvalue: float
    critical_values: dict[str, float]
    hedge_ratio: float
    intercept: float
    cointegrated_95: bool


@app.post("/cointegration", response_model=CointegrationResponse)
def cointegration(req: CointegrationRequest) -> CointegrationResponse:
    if len(req.a) != len(req.b):
        raise HTTPException(400, "Series a and b must be the same length (caller must date-align them first)")

    a = np.asarray(req.a, dtype=float)
    b = np.asarray(req.b, dtype=float)

    # Engle-Granger two-step test (statsmodels handles the first-step OLS
    # and the ADF-on-residuals step internally; trend='c' matches the
    # standard pairs-trading setup — a constant, no deterministic trend).
    score, pvalue, crit = coint(a, b, trend="c")

    # Hedge ratio for the spread (a - hedge_ratio * b): same OLS regression
    # Engle-Granger's first step runs internally, exposed here so the
    # frontend can build the spread/z-score without a second regression.
    hedge_ratio, intercept = np.polyfit(b, a, 1)

    return CointegrationResponse(
        score=float(score),
        pvalue=float(pvalue),
        critical_values={"1%": float(crit[0]), "5%": float(crit[1]), "10%": float(crit[2])},
        hedge_ratio=float(hedge_ratio),
        intercept=float(intercept),
        cointegrated_95=bool(pvalue < 0.05),
    )


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=6901)
