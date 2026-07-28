from __future__ import annotations

import re

# The product-invariant guard, in one place so every surface that emits user-bound text can
# apply it: the agent's input check, the agent's output check, the holdback stream guard, and
# the deterministic tool summaries (which the /assistant/commands route emits directly, with
# no model in the loop). It lives here rather than in agent.py so summaries.py can import it
# without a cycle.
#
# Reject requests that ask the assistant to score/rank places by safety, danger, or risk —
# the product invariant forbids it. The guard is split into three cooperating patterns:
#   1. UNAMBIGUOUS_SAFETY_PATTERN — terms that alone signal a safety-ranking ask (safe,
#      dangerous, seguridad, peligroso, "crime-free", the rank/rate/score verb arms, the
#      "mal + place-noun" compound, ...). A hit here trips the guard on its own.
#   2. AMBIGUOUS_TERM_PATTERN — colloquial/adjectival terms that ALSO have benign senses
#      ("sketchy" as a proper noun; "seguro" as "I'm sure"; "tranquilo" as "calm"). These
#      only trip if PLACE_CONTEXT_PATTERN also matches the same message.
#   3. PLACE_CONTEXT_PATTERN — deictics + place nouns in English and Spanish.
# Event/offense descriptors ("violent", "threatening", "menacing") are deliberately excluded
# — they are legitimate incident context, not place-ranking words. Word-boundary matching
# keeps legitimate substrings ("safely", "Safeway", "incident rate") and allowed count
# framing ("which area has the most crime") from false-triggering. The guard runs on BOTH
# the incoming user text and the model's final answer (see run_assistant_turn).
#
# SCOPE: this deterministic guard covers English and Spanish only, by design. It is a
# best-effort *backstop*, not the primary defense — the invariant is enforced first at the
# prompt level (app/assistant/prompts.py instructs the model to refuse safety labeling/ranking
# in any language), and mid-stream by the holdback stream guard. Requests in other languages
# (or non-Latin scripts) rely on those layers; extending deterministic coverage would need
# language-agnostic classification (deferred — see docs/ROADMAP.md, "Open — invariant risk").
UNAMBIGUOUS_SAFETY_PATTERN = re.compile(
    r"\b(?:safe(?:ty|st|r)?|unsafe|danger(?:ous)?|hazard(?:ous)?|peril(?:ous)?"
    r"|risk(?:y|ier|iest)?)\b"
    r"|\bcrime[-\s]free\b"
    r"|\b(?:rank\w*|rat[ei]\w*|scor[ei]\w*)[\s,:;\-—]+"
    r"(?:(?:the|these|those|this|that|them|my|your|our|their|its|his|her|a|an|all|both"
    r"|any|some|each|every)\s+)*"
    r"(?:place|block|area|neighbou?rhood|route|street|spot|option|location)s?\b"
    r"|\b(?:seguridad(?:es)?|inseguridad(?:es)?"
    r"|peligros(?:[oa]s?|idad(?:es)?)|peligro|riesgos[oa]s?|riesgos?"
    r"|arriesgad[oa]s?)\b"
    r"|\blibre\s+de\s+crimen\b"
    r"|\b(?:clasific|ranke|calific|puntu|puntú)\w*[\s,:;\-—]+"
    r"(?:(?:el|la|los|las|este|esta|estos|estas|ese|esa|esos|esas|mi|mis|tu|tus|su|sus"
    r"|un|una|unos|unas|todo|toda|todos|todas|cada)\s+)*"
    r"(?:(?:lugar|sector)(?:es)?"
    r"|(?:zona|barrio|[aá]rea|calle|ruta|sitio|cuadra|colonia|vecindario"
    r"|distrito|manzana|avenida)s?"
    r"|ubicaci[oó]n(?:es)?)\b"
    r"|\b(?:mal|mala|mal[oa]s)\s+"
    r"(?:(?:barrio|zona|vecindario|colonia)s?|(?:lugar|sector)(?:es)?)\b"
    r"|\b(?:(?:barrio|zona|vecindario|colonia)s?|(?:lugar|sector)(?:es)?)\s+mal[oa]s?\b",
    re.IGNORECASE,
)

AMBIGUOUS_TERM_PATTERN = re.compile(
    r"\b(?:sketch(?:y|ier|iest)|shad(?:y|ier|iest)|dodg(?:y|ier|iest)"
    r"|seed(?:y|ier|iest)|scar(?:y|ier|iest)|frightening|ghetto"
    r"|wors(?:e|ening)|empeor\w*|peor(?:es)?"
    r"|segur[oa]s?|insegur[oa]s?|tranquil[oa]s?|conflictiv[oa]s?"
    r"|problem[aá]tic[oa]s?|avoid(?:s|ed|ing)?|evit\w*)\b",
    re.IGNORECASE,
)

PLACE_CONTEXT_PATTERN = re.compile(
    r"\b(?:here|there|around|this|that|these|those|area|block"
    r"|neighbou?rhood|route|street|spot|option|location|place|corner"
    r"|downtown|uptown|part\s+of\s+town|side\s+of\s+town)s?\b"
    r"|\b(?:aqu[ií]|all[ií]|all[aá]|ac[aá])\b"
    r"|\b(?:(?:lugar|sector)(?:es)?"
    r"|(?:zona|barrio|[aá]rea|calle|ruta|sitio|cuadra|colonia|vecindario"
    r"|distrito|manzana|avenida|centro|esquina)s?"
    r"|ubicaci[oó]n(?:es)?)\b",
    re.IGNORECASE,
)

# Single source for the refusal/redirect text, reused by the input- and output-side guards.
SAFETY_REDIRECT = (
    "That's not something I can pull from the files — I can't label places safe or unsafe, "
    "rank them by safety, danger, or risk, or produce a personal safety score. I can order "
    "places by reported incident counts or compare exposure-adjusted incident rates — just "
    "ask it that way."
)

# Presence-claim guard — the third prong of the product invariant: the assistant MUST NOT
# assert that the user was personally present at, witnessed, or was victimized by a reported
# incident (CompCat knows only self-reported visit counts near a place, never presence at an
# event). This catches both a model answer asserting it ("you were present at this incident",
# "you were robbed here") and a user asking for it ("was I present at any of these?"). It is
# deliberately narrow — a first/second-person subject tied to a victimization word, or to a
# presence/witness word *followed by* an incident noun — so ordinary "a place you visit" /
# "incidents reported near you" phrasing does NOT trip it. Runs on both the incoming user text
# and the model's final answer (see run_assistant_turn).
PRESENCE_CLAIM_PATTERN = re.compile(
    r"\b(?:you|i|we)\b[^.?!]{0,40}?\b(?:"
    r"robbed|mugged|assaulted|attacked|burglar(?:ized|ised)|carjacked|stabbed"
    r"|victim|victimi[sz]ed"
    r")\b"
    r"|\b(?:you|i|we)\b[^.?!]{0,40}?"
    r"\b(?:present|witness(?:ed|ing)?|experienced|involved|at\s+the\s+scene)\b"
    r"[^.?!]{0,40}?"
    r"\b(?:incident|crime|offen[sc]e|robbery|assault|burglary|shooting|homicide"
    r"|attack|mugging|event)s?\b"
    r"|\bhappened\s+to\s+(?:you|me|us)\b"
    # Proximity arm: "was I near/around/close to any of these incidents?" asks for the same
    # placement the presence arm does. Anchored to an explicit first/second-person
    # subject-verb pair so third-person proximity — "incidents near Pike Place", the
    # product's core question — passes untouched.
    r"|\b(?:(?:was|were|am|are|have|had|did)\s+(?:i|you|we)"
    r"|(?:i|you|we)\s+(?:was|were|am|have|had|been))\b"
    r"[^.?!]{0,40}?"
    r"\b(?:near|nearby|close\s+to|around|(?:there|present)\s+(?:when|during))\b"
    r"[^.?!]{0,40}?"
    r"\b(?:incident|crime|offen[sc]e|robbery|assault|burglary|shooting|homicide"
    r"|attack|mugging|event)s?\b",
    re.IGNORECASE,
)

PRESENCE_REDIRECT = (
    "CompCat reports incidents near a place, but it can't determine anyone's personal presence "
    "at or involvement in a specific incident — it only knows the places you've saved, not where "
    "you have been. I can show the reported incidents near a place instead."
)

# Output-ONLY guard for place-ranking / livability prose that carries no banned safety word and
# so slips contains_safety_ranking (e.g. "a bad area to live", "the worst of the three", "a
# high-crime area", "I wouldn't recommend living here"). A small local model can produce these
# even though the system prompt forbids them, and this is the last line before the answer
# streams. It is applied ONLY to the model's answer, never to user input — the terms ("bad",
# "worst", "place to live") are far too common in legitimate questions to gate input on, and are
# anchored to a place noun / living context here so neutral count framing ("the most reported
# thefts", "more incidents than the others", "the worst month for theft") passes untouched.
OUTPUT_RANKING_PROSE_PATTERN = re.compile(
    r"\b(?:bad|worse|worst|rough(?:er|est)?|lousy|terrible|nasty|seedier|seediest)\b"
    r"[^.?!]{0,30}?"
    r"\b(?:area|neighbou?rhood|block|part\s+of\s+town|side\s+of\s+town|place|spot|zone)s?\b"
    r"|\b(?:area|neighbou?rhood|block|place|spot|zone)s?\b[^.?!]{0,20}?"
    r"\bto\s+(?:live|move|relocate|settle|stay|avoid)\b"
    r"|\bhigh(?:er|est)?[-\s]crime\b"
    r"|\brecommend(?:ed|ing|s)?\b[^.?!]{0,20}?\b(?:living|moving|relocat\w+|settling|staying)\b"
    r"|\b(?:worst|best)\b\s+(?:one\s+)?(?:of|among)\s+"
    r"(?:the|these|those|them|all|your)\b",
    re.IGNORECASE,
)


def contains_safety_ranking(text: str) -> bool:
    if UNAMBIGUOUS_SAFETY_PATTERN.search(text):
        return True
    return bool(AMBIGUOUS_TERM_PATTERN.search(text) and PLACE_CONTEXT_PATTERN.search(text))


def claims_user_presence(text: str) -> bool:
    return bool(PRESENCE_CLAIM_PATTERN.search(text))


def ranks_places(text: str) -> bool:
    return bool(OUTPUT_RANKING_PROSE_PATTERN.search(text))


def output_guard_redirect(text: str) -> str | None:
    """The output-side invariant guard as a single predicate: the matching redirect
    when the text violates it, else None. Used on full finals, on every deterministic
    tool summary, and — via the stream guard — on accumulated narration text."""
    if contains_safety_ranking(text) or ranks_places(text):
        return SAFETY_REDIRECT
    if claims_user_presence(text):
        return PRESENCE_REDIRECT
    return None


def guarded(text: str) -> str:
    """``text``, or the matching redirect when it violates the invariant."""
    return output_guard_redirect(text) or text
