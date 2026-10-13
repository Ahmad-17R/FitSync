"""Structured text retrieval: non-overlapped lists and overlapped lists.

The ranking models treat a pose guide as a bag of words. These models use its
*structure*: they answer questions about regions of text ("which caution
mentions the knee?") rather than whole documents, and they return the region
itself — which is exactly what a coach needs to show.

Every guide is laid out as one sequence of word positions (see ``index.py``).
A *region* is a span [start, end] of that sequence.

Non-overlapped lists (Burkowski)
--------------------------------
The text is divided into regions several different ways, each kept as its own
flat list:

    section   — one region per field: name, tags, overview, steps, benefits,
                cautions, mistakes
    fault     — one region per mistake + its correction
    sentence  — one region per sentence / step

Inside one list, regions never overlap. *Across* lists they nest: a sentence
sits inside a fault, which sits inside the mistakes section. Queries combine
lists with containment operators:

    cautions CONTAINING knee              section regions holding a word
    fault CONTAINING knee bent            regions holding all of the words
    sentence CONTAINING arms WITHIN steps  regions of one list inside another

Overlapped lists (Clarke et al.)
--------------------------------
Here regions in the *same* list may overlap, and a query can create new regions
rather than only selecting stored ones:

    knee ... ankle                        every span from a "knee" to a later "ankle"
    knee ... ankle WITHIN fault           ...that lies inside a single fault

"knee knee ankle" yields two spans, [knee knee ankle] and [knee ankle], which
overlap. The non-overlapped model cannot represent that answer at all. The
shortest-substring rule (keep only spans that contain no other result span)
reduces it to the tightest match, and both are reported.
"""

import re
from dataclasses import dataclass

from .index import FIELDS, PoseIndex, Region
from .text import preprocess

LISTS = ("section", "fault", "sentence")
DEFAULT_MAX_GAP = 12  # word positions between the two ends of an A ... B span


@dataclass(frozen=True)
class Span:
    doc_id: int
    start: int
    end: int

    def contains(self, other: "Span") -> bool:
        return self.doc_id == other.doc_id and self.start <= other.start and other.end <= self.end


# --------------------------------------------------------------------------- #
# Region algebra
# --------------------------------------------------------------------------- #

def regions_of(index: PoseIndex, list_name: str, label: str | None = None) -> list[Region]:
    return [
        r for r in index.regions
        if r.list_name == list_name and (label is None or r.label == label)
    ]


def _positions_in(index: PoseIndex, term: str, region) -> list[int]:
    return [
        p for p in index.positions.get(term, {}).get(region.doc_id, [])
        if region.start <= p <= region.end
    ]


def containing(index: PoseIndex, regions, terms: list[str]):
    """Regions holding at least one occurrence of every term."""
    return [r for r in regions if all(_positions_in(index, t, r) for t in terms)]


def within(inner, outer):
    """Regions of ``inner`` that lie inside some region of ``outer``."""
    by_doc: dict[int, list] = {}
    for o in outer:
        by_doc.setdefault(o.doc_id, []).append(o)
    return [i for i in inner if any(o.contains(i) for o in by_doc.get(i.doc_id, []))]


def followed_by(index: PoseIndex, a: str, b: str, max_gap: int = DEFAULT_MAX_GAP) -> list[Span]:
    """Every span from an occurrence of ``a`` to a later occurrence of ``b``.

    Spans in the result may overlap one another — that is the defining
    difference from the non-overlapped model.
    """
    spans = []
    a_postings = index.positions.get(a, {})
    b_postings = index.positions.get(b, {})
    for doc_id in a_postings.keys() & b_postings.keys():
        for pa in a_postings[doc_id]:
            for pb in b_postings[doc_id]:
                if pa < pb <= pa + max_gap:
                    spans.append(Span(doc_id, pa, pb))
    return sorted(spans, key=lambda s: (s.doc_id, s.start, s.end))


def shortest(spans: list[Span]) -> list[Span]:
    """Shortest-substring reduction: drop any span containing another span."""
    return [s for s in spans if not any(o != s and s.contains(o) for o in spans)]


def count_overlaps(spans: list[Span]) -> int:
    """Pairs of result spans that share at least one position."""
    n = 0
    for i, s in enumerate(spans):
        for o in spans[i + 1:]:
            if o.doc_id == s.doc_id and o.start <= s.end and s.start <= o.end:
                n += 1
    return n


# --------------------------------------------------------------------------- #
# Query language
# --------------------------------------------------------------------------- #

def _region_selector(index: PoseIndex, text: str):
    """'cautions' | 'section:cautions' | 'fault' | 'sentence:steps' -> regions."""
    text = text.strip().lower()
    if not text:
        raise ValueError("Missing region name")
    if ":" in text:
        list_name, label = text.split(":", 1)
    elif text in LISTS:
        list_name, label = text, None
    elif text in FIELDS:
        list_name, label = "section", text
    else:
        raise ValueError(
            f"Unknown region '{text}'. Use one of {', '.join(LISTS)} "
            f"or a field: {', '.join(FIELDS)}"
        )
    if list_name not in LISTS:
        raise ValueError(f"Unknown region list '{list_name}'")
    if label is not None and label not in FIELDS:
        raise ValueError(f"Unknown field '{label}'")
    return regions_of(index, list_name, label), f"{list_name}:{label}" if label else list_name


_WITHIN_RE = re.compile(r"\s+WITHIN\s+", re.IGNORECASE)
_CONTAINING_RE = re.compile(r"\s+CONTAINING\s+", re.IGNORECASE)


def structured_search(query: str, index: PoseIndex, max_gap: int = DEFAULT_MAX_GAP) -> dict:
    """Parse and run a structured query. Raises ValueError on bad syntax."""
    query = query.strip()
    main, outer_text = query, None
    parts = _WITHIN_RE.split(query, maxsplit=1)
    if len(parts) == 2:
        main, outer_text = parts

    outer = outer_label = None
    if outer_text is not None:
        outer, outer_label = _region_selector(index, outer_text)

    if "..." in main:
        return _overlapped(main, outer, outer_label, index, max_gap)
    return _non_overlapped(main, outer, outer_label, index)


def _non_overlapped(main, outer, outer_label, index: PoseIndex) -> dict:
    parts = _CONTAINING_RE.split(main, maxsplit=1)
    if len(parts) != 2:
        raise ValueError(
            "Structured queries look like 'cautions CONTAINING knee' "
            "or 'knee ... ankle WITHIN fault'"
        )
    selector, words = parts
    regions, label = _region_selector(index, selector)
    terms = preprocess(words)
    if not terms:
        raise ValueError("CONTAINING needs at least one non-stopword")

    matched = containing(index, regions, terms)
    if outer is not None:
        matched = within(matched, outer)

    expression = f"{label} CONTAINING {' AND '.join(terms)}"
    if outer_label:
        expression += f" WITHIN {outer_label}"

    hits = [
        {"doc_id": r.doc_id, "list": r.list_name, "label": r.label,
         "start": r.start, "end": r.end, "text": r.text}
        for r in matched
    ]
    return {
        "model": "non_overlapped",
        "expression": expression,
        "terms": terms,
        "regions_considered": len(regions),
        "documents": _group(hits, index),
        "total_regions": len(hits),
        "overlapping_pairs": 0,  # impossible by construction: one flat list
    }


def _overlapped(main, outer, outer_label, index: PoseIndex, max_gap: int) -> dict:
    left, right = (s.strip() for s in main.split("...", 1))
    a_terms, b_terms = preprocess(left), preprocess(right)
    if len(a_terms) != 1 or len(b_terms) != 1:
        raise ValueError("Use one word on each side of '...', e.g. 'knee ... ankle'")
    a, b = a_terms[0], b_terms[0]

    spans = followed_by(index, a, b, max_gap)
    if outer is not None:
        spans = within(spans, outer)
    minimal = shortest(spans)

    expression = f"{a} ... {b} (gap <= {max_gap})"
    if outer_label:
        expression += f" WITHIN {outer_label}"

    minimal_set = set(minimal)
    hits = [
        {"doc_id": s.doc_id, "list": "span", "label": "shortest" if s in minimal_set else "overlapping",
         "start": s.start, "end": s.end, "text": index.span_text(s.doc_id, s.start, s.end)}
        for s in spans
    ]
    return {
        "model": "overlapped",
        "expression": expression,
        "terms": [a, b],
        "regions_considered": len(spans),
        "documents": _group(hits, index),
        "total_regions": len(spans),
        "shortest_regions": len(minimal),
        "overlapping_pairs": count_overlaps(spans),
    }


def _group(hits: list[dict], index: PoseIndex) -> list[dict]:
    """Group region hits by document; more matching regions ranks first, then
    the tightest region (a short sentence beats a whole section)."""
    by_doc: dict[int, list[dict]] = {}
    for h in hits:
        by_doc.setdefault(h["doc_id"], []).append(h)
    order = sorted(
        by_doc,
        key=lambda d: (-len(by_doc[d]), min(r["end"] - r["start"] for r in by_doc[d]), d),
    )
    return [{"doc": index.summary(d), "regions": by_doc[d]} for d in order]
