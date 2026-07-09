# Intent Classification & RAG Priority System

Logseq Mixer uses an intent classification layer to determine whether a user's query needs context from the knowledge base (RAG retrieval) or should be answered directly without injecting notes.

This prevents the common failure mode where unrelated notes are retrieved and the LLM "synthesizes" them instead of following the user's actual instruction.

---

## How It Works

When a message is sent, three layers of defense ensure the LLM responds to the user's intent rather than irrelevant retrieved context:

```
User Query
    │
    ▼
┌─────────────────────────┐
│  1. Intent Classifier    │  → Should we retrieve context at all?
│     (shouldRetrieveContext)│
└─────────────────────────┘
    │
    ▼ (if yes)
┌─────────────────────────┐
│  2. Relevance Threshold  │  → Are the retrieved results actually relevant?
│     (minRrfScore ≥ 0.025)│
└─────────────────────────┘
    │
    ▼ (if results pass)
┌─────────────────────────┐
│  3. Priority Prompting   │  → LLM knows to ignore context if unrelated
│     (system prompt rules)│
└─────────────────────────┘
    │
    ▼
  Response
```

---

## Layer 1: Intent Classification

**File:** `src/intentClassifier.ts`  
**Function:** `shouldRetrieveContext(query: string): boolean`

The classifier determines whether a query is a **direct instruction** (no RAG needed) or a **knowledge question** (RAG needed).

### Classification Rules (in priority order)

| Priority | Rule | Result |
|----------|------|--------|
| 1 (highest) | Query references user's notes/graph | **Retrieve** (always) |
| 2 | Query is very short (1-2 words) without note references | **Skip** |
| 3 | Query matches a direct instruction pattern | **Skip** |
| 4 (default) | None of the above | **Retrieve** |

### Note Reference Patterns (always trigger retrieval)

These patterns indicate the user wants information FROM their knowledge graph:

| Pattern | Examples |
|---------|----------|
| "my notes/graph/pages/journal" | "What do my notes say about X?" |
| "in logseq / in my / from my" | "What pages in logseq mention React?" |
| "I wrote/noted/mentioned" | "What did I write about the API?" |
| "what/when/where did I" | "When did I mention the deadline?" |
| "find/search ... my/notes/pages" | "Find references to auth in my notes" |
| `[[page links]]` | "What is [[Project Alpha]] about?" |
| `((block refs))` | "Expand on ((abc123-def456))" |

**Key behavior:** Note references override instruction patterns. "Summarize my notes on machine learning" triggers retrieval even though "summarize" is a direct instruction verb.

### Direct Instruction Patterns (skip retrieval)

These patterns indicate a generative task where injecting knowledge base context would be harmful or irrelevant:

| Category | Patterns | Examples |
|----------|----------|----------|
| Creation | create, generate, make, write, build, design, draft, compose, produce | "Create a table with 10 rows" |
| Transformation | summarize, translate, convert, format, reformat, rewrite, paraphrase | "Translate this to French" |
| General explanation | explain/describe/define + what/how/why/concept/difference | "Explain what a neural network is" |
| Output requests | list/show me/give me + table/list/example/code/template/outline | "Show me a code example" |
| Math | calculate, compute, solve, evaluate | "Calculate 15% of 230" |
| Code generation | code, implement, program, debug, fix this, refactor | "Implement binary search" |
| Role-play | act as, pretend, you are, imagine | "Act as a Linux terminal" |
| Greetings/meta | hi, hello, hey, thanks, ok, yes, no | "Hi" |

### Short Query Rule

Queries with 1-2 words (e.g., "hi", "test", "help me") skip retrieval unless they contain a note reference pattern. This prevents noise from BM25 matching single common words against the entire knowledge base.

---

## Layer 2: Relevance Threshold

**File:** `src/hybridSearch.ts`  
**Option:** `minRrfScore` (default: `0.025`)

Even when retrieval is triggered, results must pass a minimum quality threshold after the Reciprocal Rank Fusion (RRF) merge. This filters out "accidental matches" — chunks that matched on common words (like "table", "list", "project") but aren't semantically relevant to the query.

### How RRF Scoring Works

Each retrieved chunk gets a fused score from two sources:

```
rrfScore = bm25Weight × 1/(k + rank_bm25) + vectorWeight × 1/(k + rank_vector)
```

Where `k = 60` (RRF constant). The maximum possible score for a top-ranked result in both lists is approximately `2 × 1/61 ≈ 0.033`. A result that only appears in one list at rank 1 scores approximately `0.016`.

The default threshold of `0.025` means a result must rank well in **at least one** search method to be included. Results that rank poorly in both BM25 and vector search are discarded.

### Tuning

- **Lower threshold (e.g., 0.015):** More permissive — includes results that are borderline relevant. Better recall, more noise.
- **Higher threshold (e.g., 0.030):** More strict — only includes results that rank highly in both methods. Better precision, may miss some relevant context.

---

## Layer 3: Priority Prompting

**File:** `src/settings.ts` (system prompt) and `src/manager.ts` (message assembly)

### System Prompt Priority Rule

The system prompt includes an explicit priority instruction:

> **PRIORITY RULE:**
> - The user's direct question or instruction ALWAYS takes priority over any retrieved context.
> - If the user asks you to create, generate, write, or produce something, do EXACTLY what they ask regardless of what context is provided.
> - Only use the retrieved context if it is clearly relevant to the user's request.
> - If the context appears unrelated to what the user is asking, IGNORE it entirely and respond based solely on the user's instruction.

### Message Assembly Order

The user message is structured with the query FIRST, followed by context:

```
[User's actual question/instruction]

---
Context from knowledge base (use ONLY if relevant to the request above):
[Retrieved chunks, if any]

---
Current page context:
[Active page blocks, if any]
```

This ensures the LLM sees the user's intent before encountering any context, reducing the chance of "context hijacking" where the model latches onto retrieved content instead of following the instruction.

---

## Examples

### Example 1: Direct Instruction (RAG skipped)

**Query:** "Create a table consisting of a Number column, from 1 to 10, a Square column, and a Power of 3 column."

1. **Intent classifier:** Matches `^create\b` → `shouldRetrieveContext = false`
2. **No retrieval performed** — no embedding call, no BM25 search
3. **LLM receives:** Only the user's instruction (no context injected)
4. **Result:** LLM generates the requested table directly

### Example 2: Knowledge Question (RAG triggered)

**Query:** "What is the migration strategy for phase 2?"

1. **Intent classifier:** No instruction pattern, no note reference → default to `true`
2. **Retrieval:** Hybrid search finds SRS chunks about migration phase 2
3. **Threshold filter:** Top results score > 0.025 → included
4. **LLM receives:** Query first, then relevant migration context
5. **Result:** LLM synthesizes an answer from the user's notes

### Example 3: Instruction Referencing Notes (RAG triggered)

**Query:** "Summarize my notes on machine learning"

1. **Intent classifier:** "Summarize" matches instruction pattern, BUT "my notes" matches note reference → **note reference wins** → `true`
2. **Retrieval:** Finds ML-related chunks from the knowledge base
3. **Result:** LLM summarizes the user's actual ML notes

### Example 4: Weak Retrieval Results (threshold filters)

**Query:** "What are the best practices for React hooks?"

1. **Intent classifier:** No pattern matches → default to `true`
2. **Retrieval:** BM25 matches "React" in some unrelated project notes, vector search finds nothing above 0.5 similarity
3. **Threshold filter:** Merged RRF scores are all below 0.025 → **all results discarded**
4. **LLM receives:** Query with no context
5. **Result:** LLM answers from its training knowledge (no misleading notes injected)

---

## Configuration

The intent classifier has no user-facing settings — it's designed to work transparently. The RRF threshold (`0.025`) is a code-level constant in `hybridSearch.ts` that can be tuned if needed.

The system prompt priority rules are part of the default prompt in plugin settings. Users who customize their prompt should preserve the PRIORITY RULE section to maintain correct behavior.
