"""The pose-guide corpus and every index built over it.

One document = one pose guide (``data/yoga_corpus.json``). Each guide is split
into named fields, and the same text is indexed three ways:

1. **Inverted index** — term -> {doc_id: term frequency}. Every ranking model
   (Boolean, BIM, BM25) reads this.
2. **Per-field inverted index** — the same, one per field, for field-scoped
   Boolean queries (``name:tree``) and for BM25F's per-field weights.
3. **Positional token stream + region lists** — every document laid out as one
   sequence of word positions, with named regions over it (sections, faults,
   sentences). The structured models in ``structured.py`` work on this.

Built once at import time. Thirty documents index in milliseconds, and the
corpus only changes when the JSON does.
"""

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .text import normalize, preprocess, tokenize

CORPUS_PATH = Path(__file__).parent / "data" / "yoga_corpus.json"

# Field order is also the order the token stream is laid out in.
FIELDS = ("name", "tags", "overview", "steps", "benefits", "cautions", "mistakes")


@dataclass(frozen=True)
class Region:
    """A span of word positions [start, end] (inclusive) inside one document."""
    doc_id: int
    list_name: str   # which region list it belongs to: section | fault | sentence
    label: str       # the field it sits in (for faults: "mistakes")
    start: int
    end: int
    text: str

    def contains(self, other: "Region") -> bool:
        return (
            self.doc_id == other.doc_id
            and self.start <= other.start
            and other.end <= self.end
        )


def _split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in text.replace("!", ".").split(".")]
    return [p + "." for p in parts if p]


def field_units(doc: dict, field: str) -> list[str]:
    """A field's text as a list of sentence-sized units."""
    if field == "name":
        return [f"{doc['name']} ({doc['sanskrit']})"]
    if field == "tags":
        live = " live coaching" if doc.get("trackable") else ""
        parts = [doc["level"], doc["category"], *doc.get("body_parts", [])]
        return [", ".join(parts) + live]
    if field == "steps":
        return list(doc["steps"])
    if field == "mistakes":
        units = []
        for m in doc["mistakes"]:
            units.append(m["mistake"] + ".")
            units.append(m["correction"] + ".")
        return units
    return _split_sentences(doc[field])


class PoseIndex:
    def __init__(self, documents: list[dict]):
        self.documents = documents
        self.by_id = {d["id"]: d for d in documents}
        self.doc_ids = [d["id"] for d in documents]
        self.N = len(documents)

        self.field_terms: dict[str, dict[int, list[str]]] = {f: {} for f in FIELDS}
        self.doc_terms: dict[int, list[str]] = {}
        self.postings: dict[str, dict[int, int]] = {}
        self.field_postings: dict[str, dict[str, dict[int, int]]] = {f: {} for f in FIELDS}

        # Structured view.
        self.raw_tokens: dict[int, list[str]] = {}
        self.positions: dict[str, dict[int, list[int]]] = {}
        self.regions: list[Region] = []

        for doc in documents:
            self._index_document(doc)

        self.doc_len = {d: len(t) for d, t in self.doc_terms.items()}
        self.avg_doc_len = sum(self.doc_len.values()) / self.N
        self.field_len = {
            f: {d: len(t) for d, t in self.field_terms[f].items()} for f in FIELDS
        }
        self.avg_field_len = {
            f: (sum(self.field_len[f].values()) / self.N) or 1.0 for f in FIELDS
        }

    def _index_document(self, doc: dict) -> None:
        doc_id = doc["id"]
        all_terms: list[str] = []
        stream: list[str] = []

        for field in FIELDS:
            units = field_units(doc, field)
            terms = preprocess(" ".join(units))
            self.field_terms[field][doc_id] = terms
            all_terms.extend(terms)
            for term in terms:
                fp = self.field_postings[field].setdefault(term, {})
                fp[doc_id] = fp.get(doc_id, 0) + 1

            # Lay the field out in the positional stream, recording regions.
            # Stopwords keep their positions (so a span's text reads naturally)
            # but are not indexed.
            section_start = len(stream)
            fault_start = None
            for i, unit in enumerate(units):
                unit_start = len(stream)
                for word in tokenize(unit):
                    term = normalize(word)
                    if term:
                        self.positions.setdefault(term, {}).setdefault(doc_id, []).append(len(stream))
                    stream.append(word)
                if len(stream) == unit_start:
                    continue
                unit_end = len(stream) - 1
                self.regions.append(Region(doc_id, "sentence", field, unit_start, unit_end, unit))
                # Mistakes alternate mistake / correction; a fault is the pair.
                if field == "mistakes":
                    if i % 2 == 0:
                        fault_start = unit_start
                    else:
                        self.regions.append(Region(
                            doc_id, "fault", field, fault_start, unit_end,
                            f"{units[i - 1]} {unit}",
                        ))
            if len(stream) > section_start:
                self.regions.append(Region(
                    doc_id, "section", field, section_start, len(stream) - 1,
                    " ".join(units),
                ))

        self.doc_terms[doc_id] = all_terms
        self.raw_tokens[doc_id] = stream
        for term in all_terms:
            p = self.postings.setdefault(term, {})
            p[doc_id] = p.get(doc_id, 0) + 1

    # ------------------------------------------------------------------ #

    def df(self, term: str) -> int:
        """Document frequency: how many documents contain the term at all."""
        return len(self.postings.get(term, {}))

    def tf(self, term: str, doc_id: int) -> int:
        return self.postings.get(term, {}).get(doc_id, 0)

    def posting(self, term: str, field: str | None = None) -> dict[int, int]:
        if field is None:
            return self.postings.get(term, {})
        return self.field_postings.get(field, {}).get(term, {})

    def span_text(self, doc_id: int, start: int, end: int) -> str:
        return " ".join(self.raw_tokens[doc_id][start:end + 1])

    def summary(self, doc_id: int) -> dict:
        d = self.by_id[doc_id]
        return {
            "id": d["id"],
            "slug": d["slug"],
            "name": d["name"],
            "sanskrit": d["sanskrit"],
            "level": d["level"],
            "category": d["category"],
            "trackable": d["trackable"],
            "overview": d["overview"],
        }


def load_documents(path: Path = CORPUS_PATH) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def get_index() -> PoseIndex:
    return PoseIndex(load_documents())
