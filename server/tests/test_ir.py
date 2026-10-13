"""Retrieval module: each model on a tiny hand-checkable corpus, then the real
corpus and the HTTP endpoints."""

import math

import pytest
from fastapi.testclient import TestClient

from ir.boolean import boolean_search
from ir.evaluate import BENCHMARKS, average_precision, evaluate, precision_at, reciprocal_rank
from ir.index import PoseIndex, get_index
from ir.ranking import bim_search, bm25_search, bm25f_search, bim_weight
from ir.structured import count_overlaps, followed_by, shortest, structured_search
from ir.text import preprocess
from main import app


def _doc(id_, slug, name, overview, steps=(), mistakes=()):
    return {
        "id": id_, "slug": slug, "name": name, "sanskrit": slug.title(),
        "level": "beginner", "category": "standing", "trackable": False,
        "body_parts": [], "overview": overview, "steps": list(steps),
        "benefits": "", "cautions": "",
        "mistakes": [{"mistake": m, "correction": c} for m, c in mistakes],
    }


@pytest.fixture(scope="module")
def tiny():
    return PoseIndex([
        _doc(1, "a", "Alpha", "knee knee knee strong legs"),
        _doc(2, "b", "Beta", "knee balance"),
        _doc(3, "c", "Gamma", "balance focus calm calm calm calm calm calm calm calm calm calm"),
        _doc(4, "d", "Delta", "arms reach high",
             mistakes=[("Knee bent", "Keep the knee over the ankle")]),
    ])


# --------------------------------------------------------------------------- #
# Text
# --------------------------------------------------------------------------- #

def test_preprocess_stems_and_drops_stopwords():
    assert preprocess("Bending the knees") == ["bend", "knee"]


def test_domain_stopwords_are_removed():
    assert preprocess("Tree Pose yoga") == ["tree"]


# --------------------------------------------------------------------------- #
# Boolean
# --------------------------------------------------------------------------- #

def test_boolean_and_or_not(tiny):
    assert boolean_search("knee AND balance", tiny).doc_ids == [2]
    assert boolean_search("knee OR calm", tiny).doc_ids == [1, 2, 3, 4]
    assert boolean_search("knee NOT balance", tiny).doc_ids == [1, 4]


def test_boolean_adjacent_terms_mean_and(tiny):
    assert boolean_search("knee balance", tiny).doc_ids == [2]


def test_boolean_precedence_and_parentheses(tiny):
    # AND binds tighter than OR.
    assert boolean_search("calm OR knee AND arms", tiny).doc_ids == [3, 4]
    assert boolean_search("(calm OR knee) AND arms", tiny).doc_ids == [4]


def test_boolean_field_restriction(tiny):
    assert boolean_search("mistakes:knee", tiny).doc_ids == [4]


@pytest.mark.parametrize("bad", ["knee AND", "(knee", "knee )", "colour:red"])
def test_boolean_rejects_malformed_queries(tiny, bad):
    with pytest.raises(ValueError):
        boolean_search(bad, tiny)


# --------------------------------------------------------------------------- #
# BIM
# --------------------------------------------------------------------------- #

def test_bim_weight_matches_formula():
    assert bim_weight(30, 3) == pytest.approx(math.log((30 - 3 + 0.5) / 3.5))
    # A term in most of the collection is evidence against relevance.
    assert bim_weight(30, 25) < 0


def test_bim_ignores_term_frequency(tiny):
    """Doc 1 says 'knee' three times, doc 2 once: BIM cannot tell them apart."""
    scores = {s.doc_id: s.score for s in bim_search("knee", tiny)}
    assert scores[1] == scores[2]


def test_bim_feedback_reestimates_probabilities(tiny):
    plain = bim_search("balance focus", tiny)
    fed = bim_search("balance focus", tiny, feedback=True)
    assert [t["p"] for t in plain[0].terms] != [t["p"] for t in fed[0].terms]


# --------------------------------------------------------------------------- #
# BM25
# --------------------------------------------------------------------------- #

def test_bm25_rewards_term_frequency(tiny):
    scores = {s.doc_id: s.score for s in bm25_search("knee", tiny)}
    assert scores[1] > scores[2]


def test_bm25_saturates_term_frequency(tiny):
    """Three occurrences score well under three times one occurrence."""
    one = next(t for s in bm25_search("knee", tiny) if s.doc_id == 2 for t in s.terms)
    three = next(t for s in bm25_search("knee", tiny) if s.doc_id == 1 for t in s.terms)
    assert three["contribution"] < 3 * one["contribution"]


def test_bm25_penalises_long_documents(tiny):
    """Doc 2 and doc 3 each say 'balance' once; doc 3 is much longer."""
    scores = {s.doc_id: s.score for s in bm25_search("balance", tiny)}
    assert scores[2] > scores[3]


def test_bm25_with_b_zero_ignores_length(tiny):
    scores = {s.doc_id: s.score for s in bm25_search("balance", tiny, b=0.0)}
    assert scores[2] == pytest.approx(scores[3])


def test_bm25f_weights_the_name_field(tiny):
    top = bm25f_search("delta knee", tiny)[0]
    assert top.doc_id == 4
    assert "name" in next(t for t in top.terms if t["term"] == "delta")["fields"]


# --------------------------------------------------------------------------- #
# Structured: non-overlapped and overlapped lists
# --------------------------------------------------------------------------- #

def test_non_overlapped_region_query(tiny):
    result = structured_search("fault CONTAINING ankle", tiny)
    assert [d["doc"]["id"] for d in result["documents"]] == [4]
    assert result["documents"][0]["regions"][0]["text"].startswith("Knee bent.")
    assert result["overlapping_pairs"] == 0


def test_regions_within_one_list_never_overlap():
    index = get_index()
    for list_name in ("section", "fault", "sentence"):
        for doc_id in index.doc_ids:
            spans = sorted(
                (r.start, r.end) for r in index.regions
                if r.doc_id == doc_id and r.list_name == list_name
            )
            for (_, end), (start, _) in zip(spans, spans[1:]):
                assert end < start, (list_name, doc_id)


def test_within_restricts_to_an_outer_list():
    index = get_index()
    everywhere = structured_search("sentence CONTAINING arms", index)["total_regions"]
    steps_only = structured_search("sentence CONTAINING arms WITHIN steps", index)
    assert 0 < steps_only["total_regions"] < everywhere
    assert all(r["label"] == "steps" for d in steps_only["documents"] for r in d["regions"])


def test_overlapped_spans_can_overlap(tiny):
    # Doc 1: "knee knee knee strong legs" -> three spans ending at "leg".
    spans = [s for s in followed_by(tiny, "knee", "leg") if s.doc_id == 1]
    assert len(spans) == 3
    assert count_overlaps(spans) == 3
    assert len(shortest(spans)) == 1


@pytest.mark.parametrize("bad", ["knee", "nowhere CONTAINING knee", "knee bent ... ankle",
                                  "fault CONTAINING the"])
def test_structured_rejects_malformed_queries(tiny, bad):
    with pytest.raises(ValueError):
        structured_search(bad, tiny)


# --------------------------------------------------------------------------- #
# Real corpus and evaluation
# --------------------------------------------------------------------------- #

def test_corpus_covers_every_live_pose():
    from exercises.yoga_registry import SUPPORTED_YOGA_LABELS
    trackable = {d["slug"] for d in get_index().documents if d["trackable"]}
    assert trackable == set(SUPPORTED_YOGA_LABELS)


def test_coach_corrections_are_in_the_guides():
    """Every correction the server can speak appears in its pose's guide, so a
    query built from a live correction can find the guide that explains it."""
    import ast
    from pathlib import Path

    source = (Path(__file__).parent.parent / "exercises" / "yoga_poses.py").read_text()
    spoken = {
        node.args[0].value
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "append"
        and getattr(node.func.value, "id", "") == "c"
    }
    in_guides = {m["correction"] for d in get_index().documents for m in d["mistakes"]}
    assert spoken - in_guides == set()


def test_metrics():
    assert precision_at(["a", "x", "b"], {"a", "b"}, 3) == pytest.approx(2 / 3)
    assert average_precision(["a", "x", "b"], {"a", "b"}) == pytest.approx((1 + 2 / 3) / 2)
    assert reciprocal_rank(["x", "a"], {"a"}) == 0.5


def test_benchmark_relevance_judgements_name_real_guides():
    slugs = {d["slug"] for d in get_index().documents}
    for bench in BENCHMARKS:
        assert bench.relevant <= slugs, bench.id


def test_bm25_beats_bim_on_the_benchmarks():
    """The comparison the presentation rests on. If a corpus edit flips it, the
    slides are wrong, and this is where that shows up."""
    summary = evaluate()["summary"]
    assert summary["BM25"]["MAP"] > summary["BIM"]["MAP"]
    assert summary["BM25F"]["MRR"] == 1.0


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

client = TestClient(app)


def test_search_endpoint_explains_scores():
    r = client.get("/api/search", params={"q": "standing leg bent tree", "model": "bm25f"})
    assert r.status_code == 200
    body = r.json()
    assert body["results"][0]["doc"]["slug"] == "tree"
    assert body["results"][0]["terms"]
    assert body["results"][0]["snippet"]


def test_boolean_endpoint_is_unranked():
    r = client.get("/api/search", params={"q": "hamstring AND stretch", "model": "boolean"})
    body = r.json()
    assert body["ranked"] is False
    assert all(res["score"] is None for res in body["results"])


def test_compare_endpoint_runs_every_model():
    r = client.get("/api/search/compare", params={"q": "arms overhead"})
    assert [m["model"] for m in r.json()["models"]] == ["boolean", "bim", "bim_feedback", "bm25", "bm25f"]


def test_structured_endpoint_and_errors():
    assert client.get("/api/search/structured", params={"q": "cautions CONTAINING knee"}).status_code == 200
    assert client.get("/api/search/structured", params={"q": "knee"}).status_code == 400
    assert client.get("/api/search", params={"q": "knee AND", "model": "boolean"}).status_code == 400
    assert client.get("/api/search", params={"q": "   "}).status_code == 400


def test_doc_endpoint():
    assert client.get("/api/search/docs/tree").json()["sanskrit"] == "Vrksasana"
    assert client.get("/api/search/docs/nope").status_code == 404


def test_every_coach_correction_retrieves_its_own_guide_first():
    """The session summary links each correction to /search with the pose name
    and the correction as the query. That link is only useful if it lands on
    the right guide, for every correction the coach can give."""
    index = get_index()
    for doc in index.documents:
        if not doc["trackable"]:
            continue
        for m in doc["mistakes"]:
            top = bm25f_search(f"{doc['name']} {m['correction']}", index)[0]
            assert index.by_id[top.doc_id]["slug"] == doc["slug"], m["correction"]
