"""Text processing shared by every retrieval model.

Documents and queries go through exactly the same pipeline — tokenize, drop
stopwords, stem — so that a query word and a document word meet as the same
index term. If the two sides were processed differently, "bending" in a query
would never find "bend" in a document and no model could recover from it.

Ported from the course search engine (Information Retrieval, Semester 7), with
two changes:

* Snowball (Porter2) instead of NLTK's Porter. Same family of stemmer, but a
  pure-Python package with no dependencies — this server is deliberately small
  so it survives a free-tier cold start.
* Domain stopwords. "pose" and "yoga" appear in nearly every document of a yoga
  corpus, so they separate nothing; BIM would even give them a *negative*
  weight. Removing them is the standard fix for corpus-specific common words.
"""

import re

import snowballstemmer

_stemmer = snowballstemmer.stemmer("english")

ENGLISH_STOPWORDS = frozenset({
    "a", "an", "the", "and", "or", "but", "if", "then", "else", "of", "at", "by",
    "for", "with", "about", "against", "between", "into", "through", "during",
    "before", "after", "above", "below", "to", "from", "up", "down", "in", "out",
    "on", "off", "over", "under", "again", "further", "once", "here", "there",
    "when", "where", "why", "how", "all", "any", "both", "each", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
    "so", "than", "too", "very", "s", "t", "can", "will", "just", "don", "should",
    "now", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "having", "do", "does", "did", "doing", "it", "its", "this", "that", "these",
    "those", "i", "me", "my", "we", "you", "he", "she", "they", "them", "their",
    "our", "your", "as", "us", "am", "which", "who", "whom", "what", "if", "let",
})

DOMAIN_STOPWORDS = frozenset({"pose", "poses", "yoga", "asana"})

STOPWORDS = ENGLISH_STOPWORDS | DOMAIN_STOPWORDS

_WORD_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    """Lowercase and split into word tokens. Hyphens and apostrophes split."""
    return _WORD_RE.findall(text.lower())


def stem(word: str) -> str:
    return _stemmer.stemWord(word)


def normalize(word: str) -> str | None:
    """One raw token -> its index term, or None if it is a stopword."""
    if word in STOPWORDS:
        return None
    return stem(word)


def preprocess(text: str) -> list[str]:
    """Full pipeline: tokenize -> remove stopwords -> stem."""
    return [term for term in (normalize(w) for w in tokenize(text)) if term]
