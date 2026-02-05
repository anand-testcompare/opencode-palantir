---
description: Test Palantir documentation tools
---

# Palantir Plugin Tool Test

You are testing the Palantir Foundry documentation tools. Follow these rules strictly:

## Rules

1. Use ONLY the `list_all_docs` and `get_doc_page` tools. Do NOT use web search, file reading, or any other tools.
2. NEVER guess a URL. Always start with `list_all_docs` to discover available pages.
3. When looking for information, first list all docs, then identify candidate pages by title, then read them one at a time.
4. If information spans multiple pages, read ALL relevant pages before synthesizing.

## Test Sequence

### Step 1: Verify list_all_docs

Call `list_all_docs`. Confirm it returns a list with 3,000+ pages. Report the exact count.

### Step 2: Find and read a specific topic

Using ONLY the list from Step 1, find pages related to "Ontology". Identify 3+ candidate pages by their titles. Read each one using `get_doc_page` with the exact URL from the list. Summarize what you learned about Ontology from across these pages.

### Step 3: Cross-page information retrieval

Using ONLY the list from Step 1, find pages related to "Pipeline Builder" or "Transforms". Read at least 2 pages. Explain how Pipelines relate to the Ontology based ONLY on what the documentation says.

### Step 4: Edge cases

- Try `get_doc_page` with a URL that does NOT exist (e.g., `/nonexistent/page/`). Confirm it returns a "not found" message.
- Find a page with a long URL path (3+ segments). Read it successfully.

### Step 5: Report

Summarize:

- Total pages available
- Pages successfully read
- Any failures or unexpected results
- Whether cross-page information retrieval worked correctly
