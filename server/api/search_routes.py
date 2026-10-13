"""REST API for the pose-guide retrieval module (``ir/``).

Separate router from the yoga WebSocket: retrieval is request/response and
stateless, and nothing here touches a live session.
"""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from ir.boolean import boolean_search
from ir.evaluate import evaluate
from ir.index import Region, get_index
from ir.ranking import bim_search, bm25_search, bm25f_search, query_terms
from ir.structured import structured_search

router = APIRouter(prefix="/search", tags=["search"])

RankedModel = Literal["bim", "bim_feedback", "bm25", "bm25f"]
Model = Literal["boolean", "bim", "bim_feedback", "bm25", "bm25f"]

_RANKED = {
    "bim": lambda q, ix: bim_search(q, ix),
    "bim_feedback": lambda q, ix: bim_search(q, ix, feedback=True),
    "bm25": bm25_search,
    "bm25f": bm25f_search,
}

MAX_QUERY_LENGTH = 200


def _check(q: str) -> str:
    q = q.strip()
    if not q:
        raise HTTPException(status_code=400, detail="Empty query")
    if len(q) > MAX_QUERY_LENGTH:
        raise HTTPException(status_code=400, detail="Query too long")
    return q


def _best_sentence(doc_id: int, terms: list[str]) -> str | None:
    """The sentence of a guide sharing the most query terms — the snippet.

    Ties go to the earlier sentence, so a match in the name or overview wins
    over the same match buried in the cautions.
    """
    index = get_index()
    wanted = set(terms)
    best: tuple[int, Region] | None = None
    for r in index.regions:
        if r.doc_id != doc_id or r.list_name != "sentence":
            continue
        present = sum(
            1 for t in wanted
            if any(r.start <= p <= r.end for p in index.positions.get(t, {}).get(doc_id, []))
        )
        if present and (best is None or present > best[0]):
            best = (present, r)
    return best[1].text if best else None


def run_model(model: str, q: str, limit: int) -> dict:
    index = get_index()
    if model == "boolean":
        try:
            result = boolean_search(q, index)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "model": model,
            "query": q,
            "expression": result.expression,
            "terms": result.terms,
            "ranked": False,
            "total": len(result.doc_ids),
            "results": [
                {"doc": index.summary(d), "score": None, "terms": [],
                 "snippet": _best_sentence(d, result.terms)}
                for d in result.doc_ids[:limit]
            ],
        }

    terms = query_terms(q)
    ranked = _RANKED[model](q, index)
    return {
        "model": model,
        "query": q,
        "expression": None,
        "terms": terms,
        "ranked": True,
        "total": len(ranked),
        "results": [
            {"doc": index.summary(s.doc_id), "score": s.score, "terms": s.terms,
             "snippet": _best_sentence(s.doc_id, terms)}
            for s in ranked[:limit]
        ],
    }


@router.get("")
async def search(
    q: str = Query(..., description="Query text, or a Boolean expression for model=boolean"),
    model: Model = "bm25f",
    limit: int = Query(10, ge=1, le=30),
):
    """Search the pose guides with one retrieval model."""
    return run_model(model, _check(q), limit)


@router.get("/compare")
async def compare(
    q: str = Query(..., description="Free-text query for the ranked models"),
    boolean: str | None = Query(None, description="Boolean form; defaults to the terms ANDed"),
    limit: int = Query(5, ge=1, le=30),
):
    """The same information need through every model, side by side."""
    q = _check(q)
    boolean_q = _check(boolean) if boolean else q
    return {
        "query": q,
        "boolean": boolean_q,
        "models": [run_model("boolean", boolean_q, limit)]
        + [run_model(m, q, limit) for m in _RANKED],
    }


@router.get("/structured")
async def structured(q: str = Query(..., description="e.g. 'cautions CONTAINING knee' or 'knee ... ankle WITHIN fault'")):
    """Region queries over non-overlapped and overlapped lists."""
    try:
        return structured_search(_check(q), get_index())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/benchmarks")
async def benchmarks():
    """Judged queries and every model's metrics on them."""
    return evaluate()


@router.get("/docs/{slug}")
async def document(slug: str):
    """One full pose guide."""
    for doc in get_index().documents:
        if doc["slug"] == slug:
            return doc
    raise HTTPException(status_code=404, detail="No such pose guide")
