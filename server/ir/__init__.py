"""Information retrieval over FitSync's pose guides.

Given a posture mistake the live coach detected, or a goal a user typed,
retrieve the pose guide that answers it.

    text.py        tokenize -> stopwords -> stem, shared by documents and queries
    index.py       the corpus, inverted / per-field / positional indexes, regions
    boolean.py     Boolean model (set operations, precedence, parentheses)
    ranking.py     Binary Independence Model, BM25, BM25F
    structured.py  non-overlapped lists and overlapped lists (region queries)
    evaluate.py    judged queries, P@k / MAP / MRR, model comparison

Exposed over HTTP by ``api/search_routes.py``.
"""
