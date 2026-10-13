"""Boolean retrieval model — set theory over posting lists.

Every term names a *set* of documents (its posting list). AND is intersection,
OR is union, NOT is complement against the whole collection. A document either
satisfies the expression or it does not; there is no notion of "more relevant",
so the result is an unordered set.

Grammar, with the usual precedence NOT > AND > OR and parentheses:

    expr  := and ( OR and )*
    and   := unary ( [AND] unary )*        adjacent terms mean AND
    unary := NOT unary | atom
    atom  := ( expr ) | word | field:word

``field:word`` restricts the lookup to one field, e.g. ``name:tree`` or
``cautions:knee``. Unlike the course engine (left-to-right, default OR), adjacent
terms default to AND — the classic Boolean convention, and the one that makes
the "too strict or too loose, never ranked" behaviour easy to demonstrate.
"""

import re
from dataclasses import dataclass, field

from .index import FIELDS, PoseIndex
from .text import preprocess

_TOKEN_RE = re.compile(r"\(|\)|[^\s()]+")
_OPERATORS = {"AND", "OR", "NOT"}


@dataclass
class BooleanResult:
    doc_ids: list[int]
    expression: str                       # the parsed tree, for explanation
    terms: list[str] = field(default_factory=list)


class _Parser:
    """Recursive-descent parser that evaluates as it parses.

    Each rule returns ``(docs, text)``. ``docs`` is ``None`` when the atom was
    only stopwords — a neutral element that drops out of AND / OR rather than
    matching everything or nothing.
    """

    def __init__(self, query: str, index: PoseIndex):
        self.tokens = _TOKEN_RE.findall(query)
        self.pos = 0
        self.index = index
        self.universe = set(index.doc_ids)
        self.terms: list[str] = []

    def peek(self) -> str | None:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def take(self) -> str:
        token = self.tokens[self.pos]
        self.pos += 1
        return token

    def parse(self):
        if not self.tokens:
            return set(), ""
        docs, text = self.expr()
        if self.peek() is not None:
            raise ValueError(f"Unexpected '{self.peek()}' in Boolean query")
        return (docs or set()), text

    def expr(self):
        docs, text = self.and_()
        while self.peek() is not None and self.peek().upper() == "OR":
            self.take()
            rdocs, rtext = self.and_()
            docs, text = _combine(docs, rdocs, set.union), f"({text} OR {rtext})"
        return docs, text

    def and_(self):
        docs, text = self.unary()
        while True:
            nxt = self.peek()
            if nxt is None or nxt == ")" or nxt.upper() == "OR":
                return docs, text
            if nxt.upper() == "AND":
                self.take()
            rdocs, rtext = self.unary()
            docs, text = _combine(docs, rdocs, set.intersection), f"({text} AND {rtext})"

    def unary(self):
        nxt = self.peek()
        if nxt is not None and nxt.upper() == "NOT":
            self.take()
            docs, text = self.unary()
            if docs is None:
                return None, text
            return self.universe - docs, f"NOT {text}"
        return self.atom()

    def atom(self):
        token = self.peek()
        if token is None:
            raise ValueError("Boolean query ends where a term was expected")
        if token == ")":
            raise ValueError("Unexpected ')' in Boolean query")
        self.take()
        if token == "(":
            docs, text = self.expr()
            if self.peek() != ")":
                raise ValueError("Missing ')' in Boolean query")
            self.take()
            return docs, text
        if token.upper() in _OPERATORS:
            raise ValueError(f"Operator '{token}' needs a term after it")

        fld = None
        word = token
        if ":" in token:
            prefix, word = token.split(":", 1)
            if prefix.lower() not in FIELDS:
                raise ValueError(f"Unknown field '{prefix}'. Fields: {', '.join(FIELDS)}")
            fld = prefix.lower()

        terms = preprocess(word)
        if not terms:
            return None, token
        # A hyphenated word ("cat-cow") becomes several terms; require all.
        docs = None
        for term in terms:
            self.terms.append(term)
            posting = set(self.index.posting(term, fld))
            docs = posting if docs is None else docs & posting
        label = "+".join(terms)
        return docs, f"{fld}:{label}" if fld else label


def _combine(a, b, op):
    if a is None:
        return b
    if b is None:
        return a
    return op(a, b)


def boolean_search(query: str, index: PoseIndex) -> BooleanResult:
    parser = _Parser(query, index)
    docs, text = parser.parse()
    # Sorted by id only so output is stable. This order means nothing — the
    # Boolean model has no way to say which matching document is better.
    return BooleanResult(doc_ids=sorted(docs), expression=text, terms=parser.terms)
