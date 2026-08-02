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
# SCOPE: this deterministic guard covers English and Spanish, plus a narrow set of common
# French safety-ranking constructions. It is a best-effort *backstop*, not the primary defense
# — the invariant is enforced first at the prompt level (app/assistant/prompts.py instructs the
# model to refuse safety labeling/ranking in any language), and mid-stream by the holdback
# stream guard. Other languages (or French constructions outside this small lexicon) rely on
# those layers; comprehensive coverage needs language-agnostic classification (deferred — see
# docs/ROADMAP.md, "Open — invariant risk").
UNAMBIGUOUS_SAFETY_PATTERN = re.compile(
    r"\b(?:safe(?:ty|st|r)?|unsafe|danger(?:ous)?|hazard(?:ous)?|peril(?:ous)?"
    r"|risk(?:y|ier|iest)?)\b"
    r"|\bcrime[-\s]free\b"
    r"|\b(?:rank\w*|rat[ei]\w*|scor[ei]\w*|grad(?:e[sd]?|ing))[\s,:;\-—]+"
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
    r"|\b(?:(?:barrio|zona|vecindario|colonia)s?|(?:lugar|sector)(?:es)?)\s+mal[oa]s?\b"
    # French: safety nouns/adjectives with unambiguous place-safety meaning, plus bare
    # rank/rate verbs when they take an explicitly French place-noun phrase as their object.
    r"|\b(?:s[eé]curit[eé]|ins[eé]curit[eé]|dangereu(?:x|se|ses))\b"
    r"|\b(?:class(?:e[rz]?|ons)|not(?:e[rz]?|ons)|[eé]valu(?:e[rz]?|ons))"
    r"[\s,:;\-—]+"
    r"(?:(?:le|la|les|ce|cet|cette|ces|mon|ma|mes|ton|ta|tes|son|sa|ses|un|une|des"
    r"|chaque)\s+)+"
    r"(?:quartier|zone|endroit|rue|trajet|itin[eé]raire|secteur|avenue)s?\b",
    re.IGNORECASE,
)

AMBIGUOUS_TERM_PATTERN = re.compile(
    r"\b(?:sketch(?:y|ier|iest)|shad(?:y|ier|iest)|dodg(?:y|ier|iest)"
    r"|seed(?:y|ier|iest)|scar(?:y|ier|iest)|frightening|ghetto"
    r"|wors(?:e|ening)|empeor\w*|peor(?:es)?"
    r"|segur[oa]s?|insegur[oa]s?|tranquil[oa]s?|conflictiv[oa]s?"
    r"|problem[aá]tic[oa]s?|avoid(?:s|ed|ing)?|evit\w*"
    # "sûr" (safe) and "risqué" (risky) need a place word. Bare unaccented "sur"/"risque"
    # have common non-safety meanings, so only the explicit "le/la plus sur" comparative is
    # accepted without its accent.
    r"|sûr(?:e|es|s)?|(?:le|la)\s+plus\s+sur|risqué(?:e|es|s)?)\b",
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
    r"|ubicaci[oó]n(?:es)?)\b"
    r"|\b(?:quartier|zone|endroit|rue|trajet|itin[eé]raire|secteur|lieu|avenue)s?\b",
    re.IGNORECASE,
)

# Explicit proxy rating formats are still place judgments even when the model avoids the
# words "safe" and "dangerous". Keep these arms anchored to rating/livability syntax so
# legitimate statistics such as "2 out of 10 reported incidents" and incident rates pass.
_RATING_VALUE = r"(?:\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten)"
_RATING_SCALE = (
    rf"{_RATING_VALUE}\s*(?:/\s*(?:5|10|100)"
    r"|out\s+of\s+(?:5|10|100|five|ten|one\s+hundred)"
    r"|sur\s+(?:5|10|100))"
)
_RATING_RANGE = r"(?:1|one)\s*(?:-|–|—|to)\s*(?:10|ten)"
_RATING_TARGET = (
    r"(?:it|this\s+one|that\s+one|each|every|"
    r"(?:(?:the|this|that|a|an)\s+)?"
    r"(?:place|block|area|neighbou?rhood|route|street|spot|option|location))"
)
_PLACE_RATING_SUBJECT = (
    r"(?:it|this\s+one|that\s+one"
    r"|(?:(?:the|this|that|a|an)\s+)?"
    r"(?:place|block|area|neighbou?rhood|route|street|spot|option|location)"
    r"|(?:(?:le|la|ce|cet|cette|un|une)\s+)?"
    r"(?:quartier|zone|endroit|rue|trajet|itin[eé]raire|secteur|lieu))"
)

EXPLICIT_RATING_PATTERN = re.compile(
    rf"\b(?:rating|rated|score[sd]?|graded?)\b"
    rf"[^.?!]{{0,40}}?(?:{_RATING_SCALE}|{_RATING_RANGE})"
    rf"|\b(?:give|gave|giving|rate|rated)\b[^.?!]{{0,20}}?\b{_RATING_TARGET}\b"
    rf"[^.?!]{{0,24}}?(?:{_RATING_SCALE}|{_RATING_RANGE})"
    rf"|\b{_PLACE_RATING_SUBJECT}\b[^.?!]{{0,20}}?"
    rf"\b(?:is|gets?|got|earns?|deserves?|m[eé]rite)\b[^.?!]{{0,20}}?"
    rf"(?:{_RATING_SCALE}|{_RATING_RANGE})"
    rf"|{_RATING_SCALE}[^.?!]{{0,32}}?\b(?:rating|score|grade|for\s+"
    r"(?:living|livability)|place\s+to\s+live)\b",
    re.IGNORECASE,
)

STAR_RATING_PATTERN = re.compile(
    r"\b(?:rating|score[sd]?)\b[^.?!]{0,24}?(?:[★☆⭐]\ufe0f?\s*){2,}"
    r"|(?:[★☆⭐]\ufe0f?\s*){2,}[^.?!]{0,20}?\b(?:rating|score|grade)\b"
    rf"|\b{_RATING_VALUE}\s+stars?\s+out\s+of\s+(?:5|five)\b"
    rf"|\b(?:rating|score[sd]?)\b[^.?!]{{0,32}}?"
    rf"\b{_RATING_VALUE}\s+stars?\b"
    rf"|\b(?:give|gave|giving)\b[^.?!]{{0,20}}?\b{_RATING_TARGET}\b"
    rf"[^.?!]{{0,20}}?\b{_RATING_VALUE}\s+stars?\b"
    rf"|\b{_PLACE_RATING_SUBJECT}\b[^.?!]{{0,24}}?"
    rf"\b(?:gets?|earns?|deserves?|is)\b[^.?!]{{0,12}}?"
    rf"\b{_RATING_VALUE}[-\s]stars?\b"
    rf"|\b{_RATING_VALUE}[-\s]stars?\b[^.?!]{{0,16}}?"
    r"\b(?:area|neighbou?rhood|block|place|spot|zone)\b"
    r"|\bhow\s+many\s+stars?\b[^.?!]{0,40}?\b(?:give|award|rate)\b"
    rf"[^.?!]{{0,24}}?\b{_RATING_TARGET}\b",
    re.IGNORECASE,
)

# Keep the grade token itself case-sensitive so ordinary prose containing the articles "a"
# or "an" cannot accidentally look like an A grade.
_LETTER_GRADE = r"(?<![A-Za-z])[A-F](?:[+-])?(?![A-Za-z])"
LETTER_GRADE_PATTERN = re.compile(
    rf"\b(?i:grade[sd]?|rating|score[sd]?)\b[^.?!]{{0,32}}?{_LETTER_GRADE}"
    rf"|\b(?i:give|gave|giving)\b[^.?!]{{0,20}}?\b(?i:{_RATING_TARGET})\b"
    rf"[^.?!]{{0,12}}?(?i:(?:an?\s+)?)?{_LETTER_GRADE}"
    rf"|\b(?i:{_PLACE_RATING_SUBJECT})\b[^.?!]{{0,20}}?"
    rf"\b(?i:gets?|got|earns?|deserves?|is)\b[^.?!]{{0,8}}?"
    rf"(?i:(?:an?\s+)?)?{_LETTER_GRADE}"
    rf"|{_LETTER_GRADE}\s+(?i:(?:letter\s+)?grade)\b"
)

# Numeric/star/letter formats are ambiguous outside a place judgment (API reliability,
# confidence, and data quality all legitimately use the same syntax). Require an explicit
# place/livability noun, a deictic that stands alone as the rated option, or a possessive
# personal rating phrase before treating those formats as an invariant violation. The rating
# regexes themselves stay broad; _contains_proxy_rating binds their context within the same
# sentence and through a small set of rating predicates.
PROXY_RATING_CONTEXT_PATTERN = re.compile(
    r"\b(?:place|block|area|neighbou?rhood|route|street|spot|option|location|zone"
    r"|quartier|endroit|rue|trajet|itin[eé]raire|secteur|lieu)s?\b"
    r"|\b(?:it|this\s+one|that\s+one)\b"
    r"|\b(?:my|your|our|their|its)\s+(?:rating|score|grade)\b"
    r"|\b(?:living|livability|place\s+to\s+live)\b",
    re.IGNORECASE,
)

# A model can also emit a compact comparison with no rating noun at all:
# ``Ballard: 2/10. Fremont: 8/10.``  The repeated proper-name/value grammar is the
# place-ranking signal here.  A single colon-delimited pair is deliberately not enough —
# headings such as ``Accuracy: 4/5`` are ordinary document metadata.  Direct predicates
# (``Ballard gets 2/10``) and labels that explicitly include a place noun are unambiguous and
# may stand alone.
_PROPER_NAME_TOKEN = r"[A-Z][a-z]+(?:['’\-][A-Za-z]+)?"
_PROPER_NAME_LABEL = rf"{_PROPER_NAME_TOKEN}(?:\s+{_PROPER_NAME_TOKEN}){{0,3}}"
_EXPLICIT_PLACE_LABEL_SUFFIX = r"(?:area|block|neighbou?rhood|place|route|spot|street|zone)"
_BARE_RATING_VALUE = (
    rf"(?i:{_RATING_SCALE}|{_RATING_VALUE}\s+stars?(?:\s+out\s+of\s+(?:5|five))?)"
    r"|(?:[★☆⭐]\ufe0f?\s*){2,}"
    rf"|{_LETTER_GRADE}"
)
NAMED_SUBJECT_RATING_PATTERN = re.compile(
    rf"(?<![A-Za-z])(?P<label>{_PROPER_NAME_LABEL})"
    rf"(?:\s+(?P<place_suffix>{_EXPLICIT_PLACE_LABEL_SUFFIX}))?\s*"
    r"(?P<binding>:|[—–]|\b(?:gets?|got|earns?|earned|deserves?|is|receives?|rates?)\b)"
    rf"\s*(?:an?\s+)?(?P<value>{_BARE_RATING_VALUE})"
    r"(?=\s*(?:[.,;!?)]|$))"
)

# Labels made entirely from these words describe measurements or document structure, not
# places.  Keeping this deny-list narrow prevents a compact quality report from looking like a
# pair of neighborhood ratings while still allowing arbitrary user-defined place labels.
_NON_PLACE_LABEL_WORDS = frozenset(
    {
        "accuracy",
        "analysis",
        "completeness",
        "confidence",
        "coverage",
        "data",
        "documentation",
        "model",
        "quality",
        "reliability",
        "service",
        "system",
    }
)

# Choosing or recommending where someone should live is a place judgment, even without an
# explicit safety adjective. Requiring a living/relocation phrase avoids blocking ordinary
# product actions such as "choose A to filter the incident list" or recommendations to compare
# reported counts.
LIVABILITY_PREFERENCE_PATTERN = re.compile(
    r"\b(?:choose|chose|chosen|pick(?:ed|ing|s)?|prefer(?:red|ring|s)?"
    r"|recommend(?:ed|ing|s)?)\b[^.?!]{0,64}?"
    r"\b(?:for\s+(?:living|livability|relocating|settling)"
    r"|to\s+(?:live|relocate|settle)|as\s+(?:a\s+)?place\s+to\s+live)\b"
    r"|\b(?:best|worst|better)\b[^.?!]{0,32}?"
    r"\b(?:place|area|neighbou?rhood|block|spot|zone)\b[^.?!]{0,16}?"
    r"\b(?:to\s+live|for\s+(?:living|livability))\b",
    re.IGNORECASE,
)

# Single source for the refusal/redirect text, reused by the input- and output-side guards.
SAFETY_REDIRECT = (
    "That's not something I can pull from the files — I can't label places safe or unsafe, "
    "rank them by safety, danger, or risk, or produce a personal safety score. I can order "
    "places by reported incident counts or compare them with statistically tested geographic "
    "baselines — just ask it that way."
)

# The guard already covers Spanish asks; refusing them in English reads as a failure to
# understand rather than a deliberate limit, which is exactly the wrong impression for a
# refusal. Same three beats as the English text: what it can't do, why, what it can do.
SAFETY_REDIRECT_ES = (
    "Eso no puedo sacarlo de los archivos: no puedo etiquetar lugares como seguros o "
    "inseguros, ni clasificarlos por seguridad, peligro o riesgo, ni generar una puntuación "
    "de seguridad personal. Sí puedo ordenar lugares por número de incidentes reportados o "
    "compararlos con referencias geográficas evaluadas estadísticamente — pídemelo así."
)

# Presence-claim guard — the third prong of the product invariant: the assistant MUST NOT
# assert that the user was personally present at, witnessed, or was victimized by a reported
# incident (CompCat has only place-level context, never a person's presence at an event).
# This catches both a model answer asserting it ("you were present at this incident",
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
    r"|attack|mugging|event)s?\b"
    # Temporal-presence arm: "incidents happened while I was at Downtown" states the
    # user's presence first and names the incidents earlier in the sentence, so it is the
    # inverse word order of the arms above. Keep the first-person subject explicit so the
    # ordinary product question "what happened while Downtown was busy?" still passes.
    r"|\b(?:incident|crime|offen[sc]e|robbery|assault|burglary|shooting|homicide"
    r"|attack|mugging|event)s?\b"
    r"[^.?!]{0,60}?\bwhile\s+(?:i|you|we)\s+"
    r"(?:was|were|am|are|have\s+been|had\s+been)\b"
    r"[^.?!]{0,30}?\b(?:at|in|near|around|visiting)\b",
    re.IGNORECASE,
)

# Spanish first/second-person presence and victimization. Spanish commonly omits the subject
# pronoun, so the verb forms themselves carry person. Third-person forms are only accepted when
# the formal second-person pronoun ``usted`` is explicit; "ella estuvo presente" must not be
# turned into a claim about the user.
_SPANISH_PERSONAL_ESTAR = (
    r"(?:(?:yo\s+)?(?:estuve|estaba)"
    r"|(?:t[uú]\s+)?(?:estuviste|estabas)"
    r"|(?:(?:nosotros|nosotras)\s+)?(?:estuvimos|est[aá]bamos)"
    r"|usted\s+(?:estuvo|estaba))"
)
_SPANISH_INCIDENT = r"(?:incidente|delito|crimen|robo|asalto|homicidio|ataque|tiroteo|evento)s?"
_SPANISH_WITNESS = (
    r"(?:(?:yo\s+)?presenci(?:[ée]|aba)"
    r"|(?:t[uú]\s+)?(?:presenciaste|presenciabas)"
    r"|(?:(?:nosotros|nosotras)\s+)?(?:presenciamos|presenci[aá]bamos)"
    r"|usted\s+(?:presenci[oó]|presenciaba))"
)
_SPANISH_PERSONAL_SER = (
    r"(?:(?:yo\s+)?fui|(?:t[uú]\s+)?fuiste"
    r"|(?:(?:nosotros|nosotras)\s+)?fuimos|usted\s+fue)"
)

SPANISH_PRESENCE_CLAIM_PATTERN = re.compile(
    rf"\b{_SPANISH_PERSONAL_ESTAR}\s+presente\b[^.?!]{{0,50}}?\b{_SPANISH_INCIDENT}\b"
    rf"|\b{_SPANISH_PERSONAL_ESTAR}\b[^.?!]{{0,36}}?"
    rf"\b(?:cerca|alrededor|all[ií]|aqu[ií]|en\s+el\s+lugar)\b"
    rf"[^.?!]{{0,50}}?\b{_SPANISH_INCIDENT}\b"
    rf"|\b{_SPANISH_WITNESS}\b[^.?!]{{0,40}}?\b{_SPANISH_INCIDENT}\b"
    rf"|\b{_SPANISH_PERSONAL_SER}\s+(?:una?\s+)?v[ií]ctimas?\b"
    rf"[^.?!]{{0,40}}?\b{_SPANISH_INCIDENT}\b"
    rf"|\b{_SPANISH_PERSONAL_SER}\s+"
    r"(?:robad[oa]s?|asaltad[oa]s?|atacad[oa]s?|apuñalad[oa]s?)\b"
    r"|\b(?:me|te|nos)\s+(?:robaron|asaltaron|atacaron|apuñalaron|victimizaron)\b"
    rf"|\b(?:me|te|nos)\s+(?:pas[oó]|ocurri[oó])\b[^.?!]{{0,36}}?"
    rf"\b{_SPANISH_INCIDENT}\b"
    rf"|\b{_SPANISH_INCIDENT}\b[^.?!]{{0,60}}?\bmientras\s+"
    rf"{_SPANISH_PERSONAL_ESTAR}\b[^.?!]{{0,32}}?"
    r"\b(?:en|cerca\s+de|alrededor\s+de|visitando)\b",
    re.IGNORECASE,
)

PRESENCE_REDIRECT = (
    "CompCat reports incidents near a place, but it can't determine anyone's personal presence "
    "at or involvement in a specific incident — it only knows the places you've saved, not where "
    "you have been. I can show the reported incidents near a place instead."
)

PRESENCE_REDIRECT_ES = (
    "CompCat informa de incidentes cerca de un lugar, pero no puede determinar la presencia ni "
    "la participación de nadie en un incidente concreto: solo conoce los lugares que has "
    "guardado, no dónde has estado. En su lugar puedo mostrarte los incidentes reportados "
    "cerca de un lugar."
)

# Best-effort Spanish detector, used only to pick the language of a refusal that has already
# been decided — never to decide whether to refuse. Deliberately built from tokens with no
# English homograph: articles and pronouns (el, la, un, es, mi, por, con) are excluded because
# "Is LA safe?" and similar would false-positive.
SPANISH_MARKER_PATTERN = re.compile(
    r"[¿¡áéíóúüñ]"
    r"|\b(?:est[aá]|este|esta|estos|estas|qu[eé]|c[oó]mo|d[oó]nde|donde|cu[aá]l(?:es)?"
    r"|cu[aá]nt[oa]s?|muy|seguro|segura|inseguro|insegura|seguridad|inseguridad"
    r"|peligro|peligros[oa]|peligrosidad|riesgoso|barrio|barrios|zona|zonas|vecindario"
    r"|colonia|lugar|lugares|sector|sectores|calle|cuadra|ruta|sitio|aqu[ií]|all[ií]|ac[aá]"
    r"|debo|debe|deber[ií]a|puedo|evitar|caminar|mal[oa]s?|tranquil[oa]|conflictiv[oa]"
    r"|problem[aá]tic[oa]|empeorando|peor|clasifica|califica|compara"
    r"|estuve|estuviste|estuvimos|est[aá]bamos|presente|presenci[eé]|presenciaste"
    r"|presenciamos|v[ií]ctima|incidente|delito|robo|asalto|fui|fuiste|fuimos"
    r"|robaron|asaltaron|atacaron|apuñalaron|victimizaron)\b",
    re.IGNORECASE,
)

# The Spanish detector predates the narrow French guard and treats any acute-accented vowel as
# a Spanish clue. Suppress that heuristic when an unmistakably French token is present so a
# French safety ask falls back to the English refusal instead of receiving a Spanish one.
FRENCH_MARKER_PATTERN = re.compile(
    r"[ûœç]"
    r"|\b(?:quartier|endroit|trajet|itin[eé]raire|lieu|s[eé]curit[eé]|ins[eé]curit[eé]"
    r"|dangereu(?:x|se|ses)|risqué(?:e|es|s)|quel(?:le)?|classez?|notez?)\b",
    re.IGNORECASE,
)

_SPANISH_BY_ENGLISH = {
    SAFETY_REDIRECT: SAFETY_REDIRECT_ES,
    PRESENCE_REDIRECT: PRESENCE_REDIRECT_ES,
}
REDIRECTS = frozenset(_SPANISH_BY_ENGLISH) | frozenset(_SPANISH_BY_ENGLISH.values())


def is_spanish(text: str) -> bool:
    return bool(SPANISH_MARKER_PATTERN.search(text) and not FRENCH_MARKER_PATTERN.search(text))


def localized(redirect: str | None, spanish: bool) -> str | None:
    """``redirect`` in Spanish when the conversation is in Spanish, else unchanged."""
    if redirect is None or not spanish:
        return redirect
    return _SPANISH_BY_ENGLISH.get(redirect, redirect)


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


def _contains_proxy_rating(text: str) -> bool:
    # Bind context to the sentence containing the rating expression.  A document-global
    # context search made unrelated prose such as ``The data quality rating is 4/5. It covers
    # ten records.`` look like a place judgment merely because the next sentence began "It".
    for pattern in (EXPLICIT_RATING_PATTERN, STAR_RATING_PATTERN, LETTER_GRADE_PATTERN):
        for match in pattern.finditer(text):
            left = max(text.rfind(mark, 0, match.start()) for mark in ".?!") + 1
            right_candidates = [
                position for mark in ".?!" if (position := text.find(mark, match.end())) >= 0
            ]
            right = min(right_candidates, default=len(text))
            sentence = text[left:right]
            for context in PROXY_RATING_CONTEXT_PATTERN.finditer(sentence):
                context_start = left + context.start()
                context_end = left + context.end()

                # Context embedded in (or overlapping) the rating expression is inherently
                # bound: ``give it 2/10``, ``the neighborhood gets two stars``, ``my rating``.
                if context_start < match.end() and context_end > match.start():
                    return True

                context_text = context.group().casefold()
                is_deictic = context_text in {"it", "this one", "that one"}
                if context_end <= match.start():
                    between = text[context_end : match.start()]
                    if is_deictic:
                        # ``It has a rating of 2/10`` binds the pronoun to the rating;
                        # ``It covers ten records and the rating is 4/5`` does not.
                        connector = re.fullmatch(
                            r"\s*(?:'s|has|had|gets?|got|receives?|received|earns?|earned"
                            r"|deserves?|was|is|would\s+(?:get|receive))?\s*(?:an?\s+)?",
                            between,
                            re.IGNORECASE,
                        )
                    else:
                        connector = re.fullmatch(
                            r"\s*(?:'s|has|had|gets?|got|receives?|received|earns?|earned"
                            r"|deserves?|was|is|with)?\s*(?:an?\s+)?"
                            r"(?:living|livability)?\s*",
                            between,
                            re.IGNORECASE,
                        )
                    if connector:
                        return True
                elif not is_deictic:
                    between = text[match.end() : context_start]
                    if re.fullmatch(
                        r"\s*(?:for|of|as)\s+(?:(?:the|this|that|a|an)\s+)?",
                        between,
                        re.IGNORECASE,
                    ):
                        return True

    named_ratings = []
    for match in NAMED_SUBJECT_RATING_PATTERN.finditer(text):
        label_words = {word.casefold() for word in match.group("label").split()}
        if label_words and label_words <= _NON_PLACE_LABEL_WORDS:
            continue
        binding = match.group("binding")
        if match.group("place_suffix") or binding not in {":", "—", "–"}:
            return True
        named_ratings.append(match)

    # Repeated label/value entries establish a comparison; one bare metadata-style entry does
    # not.  Requiring two also preserves incident-ratio prose whose value is followed by a noun
    # rather than punctuation (and therefore never matches NAMED_SUBJECT_RATING_PATTERN).
    return len(named_ratings) >= 2


def contains_safety_ranking(text: str) -> bool:
    if (
        UNAMBIGUOUS_SAFETY_PATTERN.search(text)
        or LIVABILITY_PREFERENCE_PATTERN.search(text)
        or _contains_proxy_rating(text)
    ):
        return True
    return bool(AMBIGUOUS_TERM_PATTERN.search(text) and PLACE_CONTEXT_PATTERN.search(text))


def claims_user_presence(text: str) -> bool:
    return bool(PRESENCE_CLAIM_PATTERN.search(text) or SPANISH_PRESENCE_CLAIM_PATTERN.search(text))


def ranks_places(text: str) -> bool:
    return bool(
        OUTPUT_RANKING_PROSE_PATTERN.search(text)
        or LIVABILITY_PREFERENCE_PATTERN.search(text)
        or _contains_proxy_rating(text)
    )


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
