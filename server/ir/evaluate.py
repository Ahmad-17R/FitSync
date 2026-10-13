"""Compare the retrieval models on judged queries.

Each benchmark query comes from a real FitSync situation — a correction the live
coach emits, or something a user would type while planning a session — and has
a hand-made relevance judgement: the set of pose guides that actually answer it.

    python -m ir.evaluate              table + top-3 per query
    python -m ir.evaluate --markdown   the same, as Markdown for the slides

Metrics
-------
P@k   of the top k results, the fraction that are relevant
R@5   of all relevant guides, the fraction found in the top 5
AP    average of the precision at each rank where a relevant guide appears
      (MAP = its mean over queries) — rewards putting relevant guides early
RR    1 / rank of the first relevant guide (MRR = mean over queries)

The Boolean model returns an unordered set, so ranked metrics are not
meaningful for it: its set precision, recall and F1 are reported separately,
and its "ranking" is just document-id order.
"""

import argparse
from dataclasses import dataclass

from .boolean import boolean_search
from .index import PoseIndex, get_index
from .ranking import bim_search, bm25_search, bm25f_search


@dataclass(frozen=True)
class Benchmark:
    id: str
    text: str            # what the ranked models receive
    boolean: str         # the same need, written as a Boolean expression
    source: str          # where in FitSync this query comes from
    relevant: frozenset  # slugs of the guides that answer it


BENCHMARKS = (
    Benchmark(
        "Q1", "standing leg bent tree", "standing AND leg AND bent AND tree",
        "Live coach: Tree Pose emitted 'Standing leg is bent'",
        frozenset({"tree"}),
    ),
    Benchmark(
        "Q2", "beginner balance", "beginner AND balance NOT floor",
        "User: wants beginner-friendly balance work, no floor poses",
        frozenset({"tree", "triangle"}),
    ),
    Benchmark(
        "Q3", "gentle stretch lower back", "gentle AND stretch AND lower AND back",
        "User: stiff lower back, wants something gentle",
        frozenset({"childs_pose", "cat_cow", "cobra", "sphinx", "supine_twist"}),
    ),
    Benchmark(
        "Q4", "hamstring stretch", "hamstring AND stretch",
        "User: tight hamstrings",
        frozenset({"seated_forward_bend", "standing_forward_bend", "wide_forward_bend",
                   "downward_dog", "triangle"}),
    ),
    Benchmark(
        "Q5", "arms overhead", "arms AND overhead",
        "Live coach: Warrior I emitted 'Arms not raised overhead'",
        frozenset({"upward_salute", "warrior_i", "tree", "chair"}),
    ),
)

RANKED_MODELS = {
    "BIM": lambda q, ix: bim_search(q, ix),
    "BIM + feedback": lambda q, ix: bim_search(q, ix, feedback=True),
    "BM25": bm25_search,
    "BM25F": bm25f_search,
}
MODEL_ORDER = ("Boolean", *RANKED_MODELS)


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #

def precision_at(ranking: list[str], relevant, k: int) -> float:
    return sum(1 for s in ranking[:k] if s in relevant) / k


def recall_at(ranking: list[str], relevant, k: int) -> float:
    return sum(1 for s in ranking[:k] if s in relevant) / len(relevant)


def average_precision(ranking: list[str], relevant) -> float:
    hits, total = 0, 0.0
    for rank, s in enumerate(ranking, start=1):
        if s in relevant:
            hits += 1
            total += hits / rank
    return total / len(relevant)


def reciprocal_rank(ranking: list[str], relevant) -> float:
    for rank, s in enumerate(ranking, start=1):
        if s in relevant:
            return 1 / rank
    return 0.0


def set_scores(retrieved: set[str], relevant) -> dict:
    tp = len(retrieved & relevant)
    p = tp / len(retrieved) if retrieved else 0.0
    r = tp / len(relevant)
    f1 = 2 * p * r / (p + r) if p + r else 0.0
    return {"precision": p, "recall": r, "f1": f1, "retrieved": len(retrieved)}


# --------------------------------------------------------------------------- #

def rankings_for(bench: Benchmark, index: PoseIndex) -> dict[str, list[str]]:
    slug = lambda d: index.by_id[d]["slug"]
    out = {"Boolean": [slug(d) for d in boolean_search(bench.boolean, index).doc_ids]}
    for name, fn in RANKED_MODELS.items():
        out[name] = [slug(s.doc_id) for s in fn(bench.text, index)]
    return out


def evaluate(index: PoseIndex | None = None) -> dict:
    """Every metric for every model on every benchmark, plus the means."""
    index = index or get_index()
    per_query = []
    for bench in BENCHMARKS:
        rankings = rankings_for(bench, index)
        metrics = {
            model: {
                "P@3": precision_at(r, bench.relevant, 3),
                "P@5": precision_at(r, bench.relevant, 5),
                "R@5": recall_at(r, bench.relevant, 5),
                "AP": average_precision(r, bench.relevant),
                "RR": reciprocal_rank(r, bench.relevant),
            }
            for model, r in rankings.items()
        }
        per_query.append({
            "id": bench.id,
            "text": bench.text,
            "boolean": bench.boolean,
            "source": bench.source,
            "relevant": sorted(bench.relevant),
            "rankings": {m: r[:5] for m, r in rankings.items()},
            "metrics": metrics,
            "boolean_set": set_scores(set(rankings["Boolean"]), bench.relevant),
        })

    def mean(model: str, key: str) -> float:
        return sum(q["metrics"][model][key] for q in per_query) / len(per_query)

    summary = {
        model: {
            "P@3": mean(model, "P@3"),
            "P@5": mean(model, "P@5"),
            "R@5": mean(model, "R@5"),
            "MAP": mean(model, "AP"),
            "MRR": mean(model, "RR"),
        }
        for model in MODEL_ORDER
    }
    return {"queries": per_query, "summary": summary}


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def _table(headers: list[str], rows: list[list[str]], markdown: bool) -> str:
    if markdown:
        lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
        lines += ["| " + " | ".join(r) + " |" for r in rows]
        return "\n".join(lines)
    widths = [max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    fmt = lambda cells: "  ".join(c.ljust(w) for c, w in zip(cells, widths))
    return "\n".join([fmt(headers), fmt(["-" * w for w in widths]), *map(fmt, rows)])


def report(markdown: bool = False) -> str:
    result = evaluate()
    out = []
    h = "## " if markdown else ""

    out.append(f"{h}Mean over {len(BENCHMARKS)} queries\n")
    keys = ["P@3", "P@5", "R@5", "MAP", "MRR"]
    rows = []
    for model in MODEL_ORDER:
        label = model + (" *" if model == "Boolean" else "")
        rows.append([label, *(f"{result['summary'][model][k]:.3f}" for k in keys)])
    out.append(_table(["Model", *keys], rows, markdown))
    out.append("\n* Boolean returns an unranked set; its ranked metrics use arbitrary "
               "id order. Set-based scores are below.\n")

    rows = [
        [q["id"], q["boolean"], str(q["boolean_set"]["retrieved"]),
         f"{q['boolean_set']['precision']:.2f}", f"{q['boolean_set']['recall']:.2f}",
         f"{q['boolean_set']['f1']:.2f}"]
        for q in result["queries"]
    ]
    out.append(f"{h}Boolean as a set\n")
    out.append(_table(["Query", "Expression", "Retrieved", "Precision", "Recall", "F1"], rows, markdown))

    for q in result["queries"]:
        out.append(f"\n{h}{q['id']}: \"{q['text']}\"\n")
        out.append(f"Source: {q['source']}  \nRelevant: {', '.join(q['relevant'])}\n")
        rows = []
        for model in MODEL_ORDER:
            top = q["rankings"][model][:3]
            marked = [f"{s}{' ✓' if s in q['relevant'] else ''}" for s in top]
            m = q["metrics"][model]
            rows.append([model, ", ".join(marked) or "(nothing)", f"{m['P@3']:.2f}", f"{m['AP']:.2f}"])
        out.append(_table(["Model", "Top 3 (✓ = relevant)", "P@3", "AP"], rows, markdown))

    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--markdown", action="store_true", help="emit Markdown tables")
    print(report(markdown=parser.parse_args().markdown))


if __name__ == "__main__":
    main()
