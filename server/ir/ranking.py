"""Ranked retrieval: the Binary Independence Model and BM25 / BM25F.

Both are *probabilistic* models. They rank documents by an estimate of how
likely each one is to be relevant to the query, and both reduce, after the
algebra, to "add up a weight for every query term the document contains". They
differ in what goes into that weight:

    BIM    weight = how rare the term is across the collection        (df only)
    BM25   weight = rarity x how often it occurs here, saturating,
                    discounted for long documents                     (df, tf, length)
    BM25F  BM25, but an occurrence in the pose name counts more than one
           buried in the steps                                        (+ field weights)

Everything returns per-term breakdowns alongside the score, so a result can
always answer "why did this come first?" with numbers, not hand-waving.

Query terms are treated as a set — each distinct term counts once. BIM is binary
on the query side by definition; using the same convention for BM25 keeps the
comparison about the *document* side, which is where the models differ.
"""

import math
from dataclasses import dataclass, field

from .index import FIELDS, PoseIndex
from .text import preprocess

# BM25 parameters: the textbook defaults.
#   k1 — how fast term frequency saturates (0 = binary like BIM, large = linear)
#   b  — how strongly long documents are penalised (0 = not at all, 1 = fully)
K1 = 1.2
B = 0.75

# BM25F field weights: where a word appears says something about what the
# document is *about*. A query word in the pose's name or in its list of
# mistakes is strong evidence; the same word in a caution is weak — a guide that
# warns "avoid this with knee pain" is not a guide *for* knees.
FIELD_WEIGHTS = {
    "name": 3.0,
    "tags": 1.5,
    "mistakes": 1.5,
    "benefits": 1.2,
    "overview": 1.0,
    "steps": 0.8,
    "cautions": 0.6,
}

# Pseudo-relevance feedback: how many top documents BIM assumes are relevant
# when it re-estimates its probabilities.
FEEDBACK_K = 3


@dataclass
class ScoredDoc:
    doc_id: int
    score: float
    terms: list[dict] = field(default_factory=list)


def query_terms(query: str) -> list[str]:
    """Distinct index terms of a query, in the order they were typed."""
    return list(dict.fromkeys(preprocess(query)))


def _rank(scored: dict[int, ScoredDoc]) -> list[ScoredDoc]:
    # Ties broken by id so the order is deterministic.
    return sorted(scored.values(), key=lambda s: (-s.score, s.doc_id))


# --------------------------------------------------------------------------- #
# Binary Independence Model
# --------------------------------------------------------------------------- #

def bim_weight(N: int, df: int, p: float | None = None, u: float | None = None) -> float:
    """The term's Retrieval Status Value contribution, c_t.

        c_t = log[ p(1-u) / (u(1-p)) ]

    p = P(term present | relevant), u = P(term present | not relevant).
    With no relevance information, p = 0.5 and u is estimated from the whole
    collection, which simplifies to the familiar idf-like form

        c_t = log[ (N - df + 0.5) / (df + 0.5) ]

    That can go negative: a term in more than half the collection is evidence
    *against* relevance. With domain stopwords removed this rarely happens.
    """
    if p is None or u is None:
        return math.log((N - df + 0.5) / (df + 0.5))
    return math.log(p / (1 - p)) + math.log((1 - u) / u)


def bim_search(query: str, index: PoseIndex, feedback: bool = False) -> list[ScoredDoc]:
    """Rank by summed BIM weights of the query terms each document contains.

    Only presence counts. A document that says "knee" once and one that says
    it ten times get exactly the same credit — that is the "binary" in the name.

    ``feedback=True`` runs one round of pseudo-relevance feedback: assume the
    top FEEDBACK_K documents of the first pass are relevant, re-estimate p and
    u for each term from them, and rank again.
    """
    terms = query_terms(query)
    N = index.N

    weights = {t: bim_weight(N, index.df(t)) for t in terms if index.df(t) > 0}
    estimates = {t: {"p": 0.5, "u": round((index.df(t) + 0.5) / (N + 1), 4)} for t in weights}
    ranked = _bim_pass(terms, weights, estimates, index)

    if feedback and ranked:
        V = {s.doc_id for s in ranked[:FEEDBACK_K]}
        for t in weights:
            df = index.df(t)
            Vt = sum(1 for d in V if index.tf(t, d) > 0)
            p = (Vt + 0.5) / (len(V) + 1)
            u = (df - Vt + 0.5) / (N - len(V) + 1)
            weights[t] = bim_weight(N, df, p, u)
            estimates[t] = {"p": round(p, 4), "u": round(u, 4)}
        ranked = _bim_pass(terms, weights, estimates, index)

    return ranked


def _bim_pass(terms, weights, estimates, index: PoseIndex) -> list[ScoredDoc]:
    scored: dict[int, ScoredDoc] = {}
    for t, w in weights.items():
        for doc_id in index.posting(t):
            s = scored.setdefault(doc_id, ScoredDoc(doc_id, 0.0))
            s.score += w
            s.terms.append({
                "term": t,
                "df": index.df(t),
                "p": estimates[t]["p"],
                "u": estimates[t]["u"],
                "contribution": round(w, 4),
            })
    for s in scored.values():
        s.score = round(s.score, 4)
    return _rank(scored)


# --------------------------------------------------------------------------- #
# BM25 and BM25F
# --------------------------------------------------------------------------- #

def bm25_idf(N: int, df: int) -> float:
    """BIM's weight, shifted so it is never negative (the Lucene form)."""
    return math.log(1 + (N - df + 0.5) / (df + 0.5))


def bm25_search(query: str, index: PoseIndex, k1: float = K1, b: float = B) -> list[ScoredDoc]:
    """Okapi BM25 over each guide's full text.

        score(d) = sum over t in q of  idf(t) * tf(k1+1) / (tf + k1(1 - b + b*dl/avgdl))

    Two things BIM ignores:
      * tf — more occurrences help, but each helps less (saturation via k1).
      * dl — a long guide mentions everything once, so its matches count less.
    """
    scored: dict[int, ScoredDoc] = {}
    for t in query_terms(query):
        df = index.df(t)
        if df == 0:
            continue
        idf = bm25_idf(index.N, df)
        for doc_id, tf in index.posting(t).items():
            norm = 1 - b + b * index.doc_len[doc_id] / index.avg_doc_len
            contribution = idf * tf * (k1 + 1) / (tf + k1 * norm)
            s = scored.setdefault(doc_id, ScoredDoc(doc_id, 0.0))
            s.score += contribution
            s.terms.append({
                "term": t,
                "tf": tf,
                "df": df,
                "idf": round(idf, 4),
                "length_norm": round(norm, 4),
                "contribution": round(contribution, 4),
            })
    for s in scored.values():
        s.score = round(s.score, 4)
    return _rank(scored)


def bm25f_search(
    query: str,
    index: PoseIndex,
    weights: dict[str, float] | None = None,
    k1: float = K1,
    b: float = B,
) -> list[ScoredDoc]:
    """BM25F: field-weighted BM25.

    Term frequencies are length-normalised *per field*, weighted, and summed
    into one pseudo-frequency before the saturation curve is applied:

        tf~ = sum over fields f of  w_f * tf_f / (1 - b + b * len_f/avglen_f)
        score(d) = sum over t in q of  idf(t) * tf~(k1+1) / (tf~ + k1)

    Summing before saturating matters: a word in three fields is not three
    independent pieces of evidence, which is what adding three separate BM25
    scores would claim.
    """
    weights = weights or FIELD_WEIGHTS
    scored: dict[int, ScoredDoc] = {}
    for t in query_terms(query):
        df = index.df(t)
        if df == 0:
            continue
        idf = bm25_idf(index.N, df)
        for doc_id in index.posting(t):
            pseudo_tf = 0.0
            by_field = {}
            for f in FIELDS:
                tf_f = index.posting(t, f).get(doc_id, 0)
                if not tf_f:
                    continue
                norm = 1 - b + b * index.field_len[f][doc_id] / index.avg_field_len[f]
                pseudo_tf += weights.get(f, 1.0) * tf_f / norm
                by_field[f] = tf_f
            contribution = idf * pseudo_tf * (k1 + 1) / (pseudo_tf + k1)
            s = scored.setdefault(doc_id, ScoredDoc(doc_id, 0.0))
            s.score += contribution
            s.terms.append({
                "term": t,
                "fields": by_field,
                "df": df,
                "idf": round(idf, 4),
                "weighted_tf": round(pseudo_tf, 4),
                "contribution": round(contribution, 4),
            })
    for s in scored.values():
        s.score = round(s.score, 4)
    return _rank(scored)
