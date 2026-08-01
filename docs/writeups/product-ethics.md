# The Answer I Won't Give

CompCat describes *reported incident context*. It does not score safety, does not rank places
as "safe" or "unsafe", and does not claim anyone was present when an incident happened. That
sentence is the product invariant. The companion essay,
[Counting Without Keeping Score](statistical-methods.md), closes by observing that the
statistics cannot support those claims — which is the first reason the product refuses to make
them. This is the second reason, and the engineering record of what the refusal cost.

## Why refuse the thing users most want?

The primary scenario is someone choosing where to live: two or three candidate addresses, a
lease or a purchase on the line. They do not arrive wanting a density per square kilometre-day.
They arrive wanting one sentence — *is this a good neighborhood?* — and every product instinct
says give it to them. A single number, a letter grade, a green-yellow-red pin. I won't build
it.

The blocking reason is that the number would not mean anything. Every count in CompCat is a
count of *reports*, and reporting propensity varies by offense type, by neighborhood, by year,
and by circumstances no dataset records — a new business with a report-everything policy, a
camera installation, a language barrier, a population with reasons of its own not to call. Two
areas with identical underlying events can produce very different report volumes. A score would
hide that variation inside an arithmetic operation and hand the reader back a number with a
decimal point on it. The decimal point is the dishonest part: it converts an unknown into an
authority, and whoever reads it will make a real decision on precision the source data never
had.

So the refusal is not a legal disclaimer bolted to the bottom of a page that already scored the
place. It is the product's identity, and it shows up as a lexicon running through every
surface. "Lower reported-incident rate" is permitted. "Safer" is not, and neither is
"crime-preventing". The distinction is not cosmetic: the first is a statement about a count
under stated filters, checkable against the data; the second is a claim about what will happen
to a person.

That lexicon is pinned by tests rather than by good intentions. `tests/test_statistical_comparison_service.py`
asserts that the comparison engine's summary text contains none of *safe*, *unsafe*, *safety*,
*danger*, *dangerous*, *risk*, or *risky* — including on a comparison where one address
"wins". The same discipline shows up in small places: the session-wide Tableau export retains
an `incidents_per_visit` column for legacy compatibility, while the analytical card's CSV, the
public UI, and the assistant's prompts, semantic packet, and tool results exclude visit, dwell,
and derived exposure-rate fields. A number that could be misread as a personal exposure rate is
not handed to the language model or presented as a current analysis result.

## How do you make a language model refuse reliably?

The Analyst is the one surface where a user can type arbitrary text and get prose back, which
makes it the one surface where the invariant can be talked around. The planning prompt does
instruct the model — *do not label places safe, unsafe, dangerous, or risky; do not rank,
score, or rate places or areas; no personal safety or risk scores* — and those instructions,
plus a `POLICY_CAVEATS` list, enter the model's context every turn. That is the soft layer: a
request, and requests are not guarantees, least of all from a small model on a laptop.

The guarantee is deterministic code in `app/assistant/agent.py`. `_contains_safety_ranking`
is built from three cooperating compiled patterns rather than one, because a single pattern
cannot be both broad and precise:

| Pattern | What it holds | Trips on its own? |
|---|---|---|
| `_UNAMBIGUOUS_SAFETY_PATTERN` | Terms that signal a ranking ask alone — *safe*, *dangerous*, *risky*, … — plus the *rank*/*rate*/*score* verb arms followed by a place noun through an optional determiner run, and a Spanish mirror of each (`peligroso`, `clasificar` + place noun, `mal barrio`, …) | Yes |
| `_AMBIGUOUS_TERM_PATTERN` | Colloquial place-character terms that also have benign senses: *sketchy*, *shady*, *avoid*, `seguro`, … | Only alongside ↓ |
| `_PLACE_CONTEXT_PATTERN` | Deictics and place nouns in both languages: *here*, *block*, *downtown*, `barrio`, … | — |

The split exists because the colloquial terms are also proper nouns and ordinary adjectives.
Gating them on co-occurring place context lets a question about an address on Shady Grove Ave
through while still catching "is this block sketchy". Word-boundary anchors do the same job at
the character level: *safely*, *Safeway*, and *incident rate* do not match, and neither does
the allowed count framing "which area has the most crime". Event and offense
descriptors — *violent*, *threatening*, *menacing* — are deliberately excluded from the whole
guard. They describe incidents, which is exactly what the product reports; they do not rank
places.

The guard runs on both sides of the model. On input, it checks the current request and treats an
ambiguous continuation of an immediately refused safety or presence request as part of that
same request. Only a clearly new supported incident, place, or filter request resets the scope.
That fail-closed rule catches "yes, do that", "give me the ordering", and "run it again"
without letting an old refusal contaminate a later explicit data question. The turn
short-circuits before the LLM is contacted at all: a pre-written redirect streams, telling the
user they can ask for reported-incident counts or statistically tested geographic comparisons
instead. On output, the same predicate re-runs against the model's own answer, so a paraphrase
that slips past the input side and provokes banned-lexicon output is still caught on the way
out.

`_PRESENCE_CLAIM_PATTERN` enforces the invariant's third prong — never assert the user was at
an incident — and runs on both sides too: it matches a first- or second-person subject tied to
a victimization word, or to a presence/witness word followed by an incident noun, catching the
model asserting it *and* the user asking for it ("was I present at any of these incidents?"
short-circuits before the LLM, exactly like a safety-ranking ask). It is narrow on purpose, so
"a place you visit" and "incidents reported near you" pass untouched.

Exactly one pattern is genuinely output-only. `_OUTPUT_RANKING_PROSE_PATTERN` catches the
harder case: ranking and livability prose carrying no banned word at all — *a bad area to
live*, *the worst of the three*, *a high-crime area*. Those words are far too common in
legitimate questions to gate input on, so this one runs against the model's answer only,
anchored to place nouns and living context so "the most reported thefts" and "the worst month
for theft" pass.

Then the Analyst gained streamed narration — the reply written token by token in front of the
reader instead of arriving finished — and a guard that inspects only a completed answer became
worthless, because by then the user has already read it. The fix is
`app/assistant/stream_guard.py`. `guarded_stream` re-runs the full output-guard predicate over
the *entire accumulated text* after every delta, and releases text only `HOLDBACK_WORDS = 16`
whole words behind the write head. The invariant survives because of a timing argument: the
word that completes any match is always the newest word, and the newest word is always still
inside the withheld tail when the check runs. A complete violating phrase can therefore never
render. At worst an innocuous *prefix* of a long-span match briefly appears before a `replace`
event swaps the whole draft for the redirect.

That costs something visible: a reply of sixteen words or fewer releases nothing until the
stream ends and then arrives in one burst, and a longer reply pauses before its first tokens.
I kept it. Pause-then-burst is a UX blemish; a rendered safety ranking is a broken product.

The larger accepted trade-off is over-refusal. Spanish `seguro` means both "safe" and "sure",
and a regex cannot tell "estoy seguro de la fecha" from "¿es seguro aquí?" once a place word is
in the same sentence. I tried stripping the epistemic sense and reverted it — the strip was
less reliable than the over-refusal it was meant to fix. So the guard fails safe: an epistemic
*seguro* near a place word gets an unnecessary redirect, while bare epistemic filler with no
place word still reaches the model. An unnecessary refusal is an annoyance the user can rephrase
around. A missed one is the product doing the thing it says it never does.

The scope limit is recorded rather than hidden. The deterministic guard covers English and
Spanish only; other languages, non-Latin scripts especially, fall back to the prompt layer and
the holdback guard. Closing that needs language-agnostic classification, and it sits in
`docs/ROADMAP.md` under "Open — invariant risk" beside the over-refusal decision. The durable
structural fix is on the record and also unbuilt: stop the model authoring user-facing prose at
all, make it strictly classify, and serve every answer from the deterministic summary path —
which removes free-text answers entirely, so it is a product decision, not a patch. Full
mechanism: [the assistant reference](../architecture/assistant.md).

## Why delete a shipped feature?

CompCat used to compare commute routes. Corridor geometry, an OpenTripPlanner integration, a
routing provider abstraction, saved corridor views, a divergent-corridor statistical verdict —
all of it merged to main, working, and tested. In July 2026 I deleted it.

The reason recorded in the removal spec is plain: the commute premise had not yielded results
proportional to the investment, and the product's real scenarios are choosing where to live
(primary) and understanding your own area over time (secondary). Places, analysis, comparison,
and exports already served those; routes did not. The spec also notes what made deletion safe
rather than reckless — every route PR was merged, so removal deleted recoverable history.

The deletion was not partial. The entire `app/routing/` package, two routers, two services, an
export module, four models, and a migration that dropped four tables and a foreign-key column —
and that also deleted the stored comparison rows sourced from route requests, because a
comparison belonging to a dead feature is not an asset. On the frontend, the Routes tab, its
two modules (`useRoutes.ts`, `routeGeometry.ts`), and every wiring point that referenced them.
Ten test files deleted, four edited. The OpenTripPlanner compose service and its setup scripts,
a route-methodology doc and its diagram. Three PRs, each gated on the full test suite, with the
frontend excised first so there was never a window where the UI called a backend that no longer
existed. The acceptance criterion was a repo-wide grep in which "route" survived only in HTTP
vocabulary and in one other place.

That other place is where the invariant enters the record. The removal spec lists as an
explicit non-goal: the safety-guard lexicon **keeps** its route wording — "what's the safest
route" must still be refused, and that copy stays correct. The feature was deleted; the
refusal that covered it was not. Users can still ask the question, and the answer is still no.

One observation of my own, beyond what the spec records: an address-first surface is the easier
one to keep honest. A corridor comparison is intrinsically a comparison between the areas you
pass through, and the closer a surface gets to ordering areas against each other, the more work
it takes to stop the output reading as a ranking. Either way the transferable lesson is the one
the invariant needs: deleting working code because the framing was wrong is the same muscle as
refusing a feature users want.

## Why split arrests out of "reported incidents"?

When I added SPD arrest data as a second source, I unioned it into the `reported` layer.
`LAYERS[LAYER_REPORTED] = (SOURCE_SPD_CRIME, SOURCE_SPD_ARRESTS)` — one line, more data, a more
complete picture. It was wrong in two ways.

The first is arithmetic. A crime report and the arrest that results from it are two records of
one event, and on the public data they may share a `report_number`. Unioned, both were counted
— and the double-count is not uniform, since it concentrates wherever clearance rates are
higher.

The second is conceptual, and worse. An arrest is enforcement activity, logged where the arrest
was made, which may differ from where the offense occurred; most reported crimes never produce
one; many arrests — drug, DUI, warrant — have no victim report behind them at all. An arrest's
geography therefore reflects patrol allocation and enforcement patterns as much as incidents.
Counting arrests as reported incidents launders enforcement geography into apparent crime
geography: it silently biases exactly the comparisons the product exists to keep honest.

The union would have been defensible if arrests and crimes could be reliably linked, and on
SPD's internal data they match far better. CompCat ships against the *public* data, which is
redacted enough that an arrest cannot be joined back to its crime to dedupe or attribute
location. A design that is only sound on data the product doesn't have is not sound.

So arrests were de-merged into a third, disjoint, clearly labeled layer: Reported / Arrests /
Calls, with `reported` now meaning SPD crime reports only. The plumbing was nearly free — the
source-aware layer architecture was built for this, so adding a key to the `LAYERS` dict
propagated to validation, freshness, every query path, and category handling, with no migration
because `layer` is just a string column. Almost all the real work was copy, which is the point:
the value of the change is that a reader can never mistake one measurement for the other. The
canonical caveat travels with the layer into the assistant's policy caveats and planning
prompt, and the deterministic tool summaries lead with "From the reports:", "From the arrest
records:", or "From the call logs:" and switch the count noun to match, so an arrests turn is
never phrased as reported incidents.

The 911 layer gets the same treatment for the same reason: calls are *requests for service, not
confirmed incidents* — one event can generate several calls, and many are proactive officer
activity. And where the public data is redacted rather than merely coarse, the map says so
instead of quietly dropping rows: arrests carrying an unknown-location sentinel are excluded
structurally from the incident-points layer, counted, and disclosed as an
`unmappable_citywide_count`.

## What does privacy-first mean concretely?

This is a product where the query itself is the sensitive data: nobody needs a user's saved
places to learn something about them, because watching which addresses they look up, in which
order, is enough. So the deployed app makes **zero third-party requests**, and the interesting
part is what had to be rebuilt to get there.

The map is the big one. A map that loads tiles from a CDN tells that CDN, viewport by viewport,
exactly which blocks a user is investigating and how long they lingered — so I self-hosted a
Seattle vector-tile extract and pointed MapLibre at that, rather than let a tile server watch
the sessions. Self-hosting the web fonts came next, for the same reason and at less cost; it
dropped the app's last external call. Address search I put behind `GET /dashboard/geocode`, a
session-required server-side proxy that caches results with a TTL and holds a process-local
rate gate between upstream calls, so the browser never contacts the geocoder directly and the
upstream sees one polite server rather than every user.

Exports and deliberate sharing have different precision contracts. Every exported coordinate is
rounded to three decimals, and sensitive place classes are excluded by default. A share link,
however, keeps the analysis coordinates exact: shifting a center can change the incidents inside
a small radius, and the link already needs to disclose its location label to reproduce the view.
The UI therefore says plainly that anyone with the link can read its exact coordinates and
labels. The link contains only those locations plus the radius, date range, category, and layer —
no session or saved-place ids — and recomputes on open without creating server-side view state.

Whole classes of place don't get exported at all. In the default `tableau_safe` mode, clusters
classified home-like, work-like, health-like, religious-like, or explicitly suppressed are
dropped from the CSV entirely — and surviving rows report `sensitivity_class` as either
"normal" or "suppressed", never the specific class, so the export can't leak the classification
by omission.

Personal location upload has the highest stakes of anything here, so I made it ship disabled
rather than merely warned about: `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS` defaults to false, and
with it off the upload endpoints return 404, the input mode isn't advertised, and no upload UI
renders anywhere. A default nobody has to notice is worth more than a caution nobody reads.
Enabled, the pipeline keeps only what it needs: raw points and per-visit stop rows are deleted
after clustering unless retention is explicitly turned on, there is a consent gate, and a
delete control erases every uploaded artifact for the user.

What is missing is stated too: no production authentication, no encryption at rest, no per-user
tenant isolation — the README's "what it does not do" list says so plainly. CompCat goes public
as a showcase rather than an operated service, and a privacy posture that quietly omits its own
gaps is marketing.

## What refusing buys

Every refusal here cost something concrete. The score is the feature users most want. The guard
over-refuses in Spanish and pauses the stream by sixteen words. The routes removal deleted a
working feature. The arrests de-merge made the headline number smaller. Self-hosting tiles and
fonts is real infrastructure spent to avoid a request that would have been free.

What it buys is that the product's claims can be taken at the size they are stated. When
CompCat says an address came in at least 20% below its comparator under these filters, at this
radius, over this window, with an interval excluding 1 and enough incidents on both sides to
run the test — that is the whole claim, and a reader can check it. There is no hidden scoring
model upstream of it, no ranking the wording is tiptoeing around, no inference about the reader
personally. A product built to refuse overclaiming — imperfectly, as the guard's own recorded
gaps show — is still a better thing to have built than a grade.

How the numbers behind those claims are kept honest is the other half of the story:
[Counting Without Keeping Score](statistical-methods.md).
