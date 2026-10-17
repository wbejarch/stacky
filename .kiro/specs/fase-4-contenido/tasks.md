# Implementation Plan: Phase 4 Content and Guardrails

## Overview

This plan delivers the full 8-module curriculum, extends the server-side schema and the test harness for program and file tests, builds the knowledge base on S3 Vectors and the two guardrails in a new `ContentStack`, adds the lesson search tool and guardrail selection to the agent, and adds module navigation to the front end. Reference solutions never enter the knowledge base.

## Tasks

- [ ] 1. Extend the server-side content schema and the shared helper
  - [ ] 1.1 Extend `ExerciseRecordSchema` in the `shared/` server-only subpath with function tests (optional `kind`), program tests (`stdin`, `expectedStdout`), optional `files`, unique test names and prerequisite rules; keep the public schemas untouched
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [ ] 1.2 Reuse `exerciseIdsFor(module)` from `shared/` (created in Phase 0) and extend the content test so it checks the `mNN-eMM` convention for all eight modules
    - _Requirements: 5.5, 2.7_
  - [ ] 1.3 Update the `ejercicios.json` section of `.kiro/steering/structure.md` with the extended test shapes
    - _Requirements: 2.6_
  - [ ] 1.4 Write Vitest tests: valid and invalid schema cases (mixed kinds, absolute and parent paths, big files, duplicate names, bad prerequisites) and the helper
    - _Requirements: 17.1_

- [ ] 2. Extend the test harness
  - [ ] 2.1 Update the harness template for program tests: `input()` over the test `stdin`, prompt echo into captured stdout, output normalization, "asked for more input" failure, per-test fresh namespace, function tests unchanged
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6_
  - [ ] 2.2 Add `files` support: temporary directory per test, `chdir`, cleanup and restoration of the working directory
    - _Requirements: 3.3_
  - [ ] 2.3 Write harness execution tests with local Python through `uv run`: matching and mismatching output, missing input, extra output, program that never reads input, print before failure, files, cwd restoration, Phase 2 cases still passing
    - _Requirements: 3.7, 3.8, 17.3_

- [ ] 3. Author the curriculum
  - [ ] 3.1 Write modules 01 and 02 (lessons, exercises with program and function tests, common mistakes)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_
  - [ ] 3.2 Write module 04 (loops)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_
  - [ ] 3.3 Write module 05 (lists and dictionaries)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_
  - [ ] 3.4 Write module 06 (functions)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_
  - [ ] 3.5 Write module 07 (files and errors) using `files` in tests
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_
  - [ ] 3.6 Write module 08 (mini project) with at least 2 integrative exercises
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8_
  - [ ] 3.7 Apply the review checklist to all lessons and exercises, fix findings, and record the results in the design; ask the user to review the Spanish and the pedagogy before closing
    - _Requirements: 1.9_

- [ ] 4. Generate the content index and serve all modules
  - [ ] 4.1 Implement `scripts/build-content-index.ts` that validates and writes `api/src/generated/content-index.ts`; gitignore the output; add `prepare:content` and wire it into the `pretypecheck`, `pretest` and `prebuild` scripts
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ] 4.2 Switch `lib/content.ts` and the handlers to the generated index (modules list, lessons, public exercises, `totalExercises` across modules)
    - _Requirements: 1.6, 5.1, 5.4_
  - [ ] 4.3 Write Vitest tests: index completeness and ordering, malformed content fails the build, all 8 modules served, totals, and the recursive scan for server-only fields extended to every module
    - _Requirements: 5.6, 17.3_

- [ ] 5. Verify content and prevent leaks
  - [ ] 5.1 Extend `npm run verify-content` to all modules and both test kinds with a per-module summary and clear failure messages
    - _Requirements: 4.1, 4.2, 4.3, 4.5_
  - [ ] 5.2 Make the local harness tests cover every reference solution and starter code
    - _Requirements: 4.4_
  - [ ] 5.3 Write `agent/tests/test_content_leaks.py`: similarity lint of fenced blocks in public documents against all solutions with the guard's similarity function, verbatim solution text lint, and a justified allowlist file
    - _Requirements: 6.5, 6.6_
  - [ ] 5.4 Write the cross-module content validation test (ids, counts, prerequisites, lesson length, headings, schema)
    - _Requirements: 1.3, 1.4, 1.5, 2.7, 17.2_

- [ ] 6. Build the knowledge base documents
  - [ ] 6.1 Implement `scripts/build-kb-docs.ts` that copies only `leccion.md` and `errores-comunes.md` per module into `build/kb-docs/` using an allowlist of file names and writes the `.metadata.json` sidecars with `moduleId` and `kind`
    - _Requirements: 6.1, 6.2, 7.6_
  - [ ] 6.2 Write a test that the output never contains `ejercicios.json`, that every document has a sidecar, and that sidecar metadata is within the size limits
    - _Requirements: 6.2, 7.5, 7.6_

- [ ] 7. Implement `ContentStack`
  - [ ] 7.1 Create the private encrypted KB documents bucket and publish `build/kb-docs` with pruning
    - _Requirements: 6.1, 6.4_
  - [ ] 7.2 Create the S3 vector bucket and vector index with the L1 constructs (dimension and cosine metric from context, float vectors); confirm the non-filterable metadata keys that Bedrock requires and record them in the design
    - _Requirements: 7.1, 7.5_
  - [ ] 7.3 Create the knowledge base (`VECTOR`, S3 Vectors storage), its service role with scoped permissions, and the data source with the inclusion prefix and fixed-size chunking; check embedding model availability and dimension in the region, confirm the L1 property names, and record the choice (D22)
    - _Requirements: 6.3, 7.2, 7.3, 7.4, 7.7, 7.9_
  - [ ] 7.4 Add the ingestion custom resource keyed to the content hash with a role limited to ingestion job actions, and implement `scripts/ingest-kb.ts` that starts a job and waits for completion
    - _Requirements: 8.1, 8.2, 8.4, 8.5_
  - [ ] 7.5 Create the strict and relaxed guardrails and their versions with the policies in the design; check the tier, Spanish support and any cross-region profile requirement, and record the choice (D24)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_
  - [ ] 7.6 Add outputs, context keys and tags; update `bin/app.ts` for the order `ContentStack`, `AgentStack`, `ApiStack`, `WebStack`; pass the knowledge base and guardrail identifiers to `AgentStack`
    - _Requirements: 7.8, 10.9, 10.10, 15.5, 15.6_
  - [ ] 7.7 Write Jest assertions: KB type and storage, index settings, data source prefix and chunking, absence of `ejercicios.json` in the deployed asset, guardrail policies including the output-only solution topic in the strict guardrail only, custom resource permissions, stack order, tags
    - _Requirements: 6.7, 17.5_

- [ ] 8. Update the agent
  - [ ] 8.1 Implement `kb.py` and the `search_lessons` tool (module filter from the current exercise and prerequisites, top 3, truncation, 3 s limit, 2 calls per turn, disabled mode)
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 16.4_
  - [ ] 8.2 Update `prompts.py` for course-material grounding, remove the full common-mistakes injection, load only exercise records in `content.py`, and change the packaging script to copy only `ejercicios.json` files
    - _Requirements: 9.4, 9.7, 9.8_
  - [ ] 8.3 Update `AgentStack` with the `bedrock:Retrieve` and `bedrock:ApplyGuardrail` permissions on the specific ARNs and the new environment variables
    - _Requirements: 15.1, 15.2, 15.3, 15.7_
  - [ ] 8.4 Implement `model.py` guardrail selection by gate state with synchronous stream processing, trace logging by policy type, intervention handling and fallback without guardrail; verify the Strands parameter names, how the latest user message is tagged for the prompt attack filter, and any extra permission the model call needs; record findings and limitations in the design
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_
  - [ ] 8.5 Add the evaluation-only layer switches (`EVAL_MODE` plus `EVAL_DISABLE_LAYERS`) and a CDK assertion that neither is defined on the runtime
    - _Requirements: 12.5_
  - [ ] 8.6 Write pytest tests with fakes: search filters, truncation, time limit, call cap, disabled mode, guardrail selection, intervention logging without content, memory receives delivered text, solution guard after retrieval, independence of layers
    - _Requirements: 9.9, 11.4, 12.5, 17.4_

- [ ] 9. Update the front end
  - [ ] 9.1 Implement `ModuleSelector` (labeled native select, keyboard operable) and extend `useExercise` to load the lesson and exercises with `exerciseIdsFor` and select the first not-completed exercise
    - _Requirements: 14.1, 14.2, 14.5_
  - [ ] 9.2 Keep one chat transcript per exercise in memory and cancel any active stream when the exercise or module changes
    - _Requirements: 14.6_
  - [ ] 9.3 Extend `ProgressPanel` with per-module counts in text and persist the last module and exercise in `sessionStorage`
    - _Requirements: 14.3, 14.4, 14.7_
  - [ ] 9.4 Write Vitest + React Testing Library tests: selector and keyboard use, selection restore, per-module progress, per-exercise transcripts, stream cancel on change
    - _Requirements: 17.6_

- [ ] 10. Prepare the evaluation sets
  - [ ] 10.1 Write the evaluation sets in `agent/tests/eval/`: at least 30 legitimate beginner questions in Spanish (including programming uses of "kill", "attack" and "loop infinito"), plus off-topic, abusive, prompt-injection, personal-data and solution-seeking messages
    - _Requirements: 13.1, 13.3_
  - [ ] 10.2 Write the retrieval set of at least 20 questions with the expected module
    - _Requirements: 13.4_
  - [ ] 10.3 Implement the live runners (excluded from the default run) that report blocked legitimate questions, handling by guardrail, tutor or none, retrieval top-3 hit rate, and replies stopped per protection layer using the layer switches
    - _Requirements: 12.2, 13.3, 13.6_

- [ ] 11. Checkpoint: build and test everything
  - [ ] 11.1 Run `prepare:content`, `typecheck`, `lint` and `test` for every workspace, `uv run ruff check`, `uv run ruff format --check` and `uv run pytest`, rebuild the agent zip and run `cdk synth`; fix any failure
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

- [ ] 12. Deploy and verify in AWS
  - [ ] 12.1 Deploy `ContentStack` after explicit user confirmation (billable resources); confirm the region supports S3 Vectors, Knowledge Bases, the embedding model and the guardrail tier, and record the answers in the design
    - _Requirements: 7.3, 10.8_
  - [ ] 12.2 Run `scripts/ingest-kb.ts` and confirm the job completes with no failed documents and the indexed count equals the uploaded public documents
    - _Requirements: 8.3_
  - [ ] 12.3 Deploy `AgentStack`, `ApiStack` and `WebStack`, and run `npm run verify-content` against the real interpreter for all modules
    - _Requirements: 4.1, 4.2, 15.5_
  - [ ] 12.4 Run the retrieval evaluation, tune chunking or the embedding model if the top-3 rate is below 80%, and record results and tuning
    - _Requirements: 13.4, 13.5_
  - [ ] 12.5 Run the guardrail evaluation, tune denied topic definitions and filter strengths until no legitimate question is blocked, and record each blocked case with the policy and the fix; apply the documented fallback only if tuning fails
    - _Requirements: 13.1, 13.2, 13.3, 13.5_
  - [ ] 12.6 Run the layered solution-seeking evaluation with each layer switched off in turn, record how many replies each layer stops, and stop the phase if a complete solution reaches the client before the gate opens
    - _Requirements: 12.2, 12.3, 12.4_
  - [ ] 12.7 Measure time to first token over 10 requests with synchronous guardrails and retrieval enabled, and the knowledge base latency cold and warm; record the breakdown and apply a mitigation if the 3 s target is missed
    - _Requirements: 16.1, 16.2, 16.3_
  - [ ] 12.8 Run the manual E2E path: open each module, complete a function, a program and a file exercise, ask about a lesson topic, ask an off-topic question, ask for the solution directly, switch module during streaming
    - _Requirements: 17.7_

- [ ] 13. Documentation, post draft and phase close
  - [ ] 13.1 Record the final status of D21 to D26, the review checklist results, the evaluation results and the measured latencies in the design
    - _Requirements: 1.9, 12.3, 13.5, 18.3_
  - [ ] 13.2 Update the README with content authoring steps, lints, verification, ingestion and the per-student cost estimate of retrieval and guardrails
    - _Requirements: 18.2_
  - [ ] 13.3 Write `docs/posts/post-05-rag-y-guardrails.md` about RAG and guardrails for a trustworthy tutor, including the leak-prevention design and the measured results
    - _Requirements: 18.1_
  - [ ] 13.4 Tag the repository `fase-4` after the user approves the final state
    - _Requirements: 18.4_

## Notes

- Tasks 3.1 to 3.7 are content authoring. The Spanish text and the pedagogy need a human review before the phase closes (task 3.7).
- Tasks 10.3 and 12.1 to 12.8 deploy billable resources and run live model evaluations. They need explicit user confirmation.
- Decisions D21 (generated content index), D22 (Titan Text Embeddings V2 with fixed-size chunks), D23 (ingestion trigger), D24 (strict and relaxed guardrails with synchronous streaming), D25 (additive schema fields) and D26 (search as a tool) are confirmed by the user.
- The phase must not close if a complete solution reaches the client before the gate opens during the layered evaluation (task 12.6).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "6.1", "8.1", "9.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "4.1", "7.1", "8.2", "9.2"] },
    { "id": 2, "tasks": ["1.4", "2.3", "3.7", "4.2", "5.1", "5.3", "6.2", "7.2", "8.4", "9.3"] },
    { "id": 3, "tasks": ["4.3", "5.2", "5.4", "7.3", "8.5", "9.4"] },
    { "id": 4, "tasks": ["7.4", "8.6", "10.1"] },
    { "id": 5, "tasks": ["7.5", "10.2"] },
    { "id": 6, "tasks": ["7.6", "10.3"] },
    { "id": 7, "tasks": ["7.7", "8.3"] },
    { "id": 8, "tasks": ["11.1"] },
    { "id": 9, "tasks": ["12.1"] },
    { "id": 10, "tasks": ["12.2"] },
    { "id": 11, "tasks": ["12.3"] },
    { "id": 12, "tasks": ["12.4"] },
    { "id": 13, "tasks": ["12.5"] },
    { "id": 14, "tasks": ["12.6"] },
    { "id": 15, "tasks": ["12.7"] },
    { "id": 16, "tasks": ["12.8"] },
    { "id": 17, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 18, "tasks": ["13.4"] }
  ]
}
```
