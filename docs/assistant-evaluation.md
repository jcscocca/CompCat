# Assistant behavioral evaluation

CompCat evaluates Tabby through the real `POST /assistant/chat` SSE path. This exercises the
configured provider, planning prompt, deterministic guards, tools, database queries, summaries,
stream guard, and narration together. It is a behavioral regression suite, not an exact-text
snapshot: model wording can change while the required properties remain correct.

The versioned corpus is [`evals/assistant/v1.json`](../evals/assistant/v1.json). It covers safety
and presence refusals, tool routing, filter arguments, result-aware follow-ups, data-layer
language, multi-turn scope, clarification, and a Spanish request. Every turn always checks for a
complete SSE stream, no error event, and a non-empty response. Cases add properties such as an
expected tool, a subset of tool arguments, required concepts, and prohibited claims.

## Local-first workflow

Start the full personal app and prewarm the local model, then inspect the planned run:

```powershell
python scripts/evaluate_assistant.py --target local --dry-run
```

Run the complete corpus. The default seven-minute per-turn timeout accommodates the ThinkPad's
hybrid CPU/GPU inference path:

```powershell
python scripts/evaluate_assistant.py --target local
```

Override the app origin when it is not listening on `http://127.0.0.1:8000`:

```powershell
python scripts/evaluate_assistant.py --target local --base-url http://10.0.0.76:8000
```

The runner creates one anonymous app session and reuses it across isolated cases. It never calls
the model endpoint directly and does not read model API keys. Reports go to the gitignored
`assistant-eval-results/` directory and include prompts, rendered responses, tool choices,
event sequences, per-property results, and latency. They do not contain cookies or credentials.
Reports are UTF-8 JSON on every platform and are atomically checkpointed after each completed
case, so a long local run retains its earlier evidence if a later case or terminal is interrupted.

Useful filters:

```powershell
python scripts/evaluate_assistant.py --target local --case guard_safety_ranking
python scripts/evaluate_assistant.py --target local --tag guard
```

## Groq acceptance check

After a meaningful prompt, routing, guard, or narration change, run only the smaller acceptance
subset against a CompCat app configured to use Groq:

```powershell
$env:COMPCAT_EVAL_GROQ_URL = "http://127.0.0.1:8001"
python scripts/evaluate_assistant.py --target groq --tag acceptance
```

`--target groq` deliberately has no default URL. It requires `--base-url` or
`COMPCAT_EVAL_GROQ_URL`, prints a quota warning, and prevents an accidental run against the public
site. The URL names the CompCat app, not Groq's model endpoint; that app must already have its
provider variables configured. Using `https://compcat.app` is possible but consumes the public
request pool and should be limited to a final smoke check.

## Compare a baseline

Pass any prior JSON report to retain pass-state and aggregate latency changes in the new report:

```powershell
python scripts/evaluate_assistant.py --target local `
  --baseline assistant-eval-results/local-20260731T190000Z.json
```

The runner exits `0` when all selected cases pass, `1` for behavioral failures, and `2` for an
invalid corpus, target, connection, or session. A failed property is evidence to inspect, not an
automatic reason to rewrite the prompt: first distinguish provider variance, missing source
data, and a genuine regression.

## Division of responsibility

- Unit and integration tests remain the fastest gate for deterministic policy and tool behavior.
- The full local corpus is the primary deep-quality loop and consumes no hosted-model quota.
- The Groq acceptance subset catches serving, quantization, structured-output, and tool-routing
  differences that local llama.cpp cannot reproduce exactly.
- A short public smoke check confirms the deployed revision, proxy, cookies, and production
  limits; it is not the place for exhaustive prompt iteration.
