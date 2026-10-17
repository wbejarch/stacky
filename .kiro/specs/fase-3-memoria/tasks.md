# Implementation Plan: Phase 3 Memory and Progress

## Overview

This plan adds durable progress and tutor memory. It introduces the anonymous learner identity, the DynamoDB progress and tutor state items, the AgentCore Memory resource with its strategies, the agent code that writes and retrieves memory safely, and the front-end progress panel. The zod schemas in `shared/` do not change.

## Tasks

- [ ] 1. Add learner identity to the API
  - [ ] 1.1 Implement `api/src/lib/learner.ts` with `parseLearnerId` (UUID validation), `toActorId` (SHA-256 derived `learner-` id) and `requireActor`; add `actorIdHash` to the logger context and make sure the raw id is never logged
    - _Requirements: 1.3, 1.4, 1.5, 1.8, 12.6_
  - [ ] 1.2 Read the optional header in `chat`, `hint` and `run`, require it in `progress`, add `X-Learner-Id` to the CORS preflight headers in `ApiStack`, and pass `actorId` to the agent client payloads
    - _Requirements: 1.2, 1.6, 1.7, 13.2_
  - [ ] 1.3 Write Vitest tests for validation, deterministic derivation, absent and malformed header behavior per endpoint, and log content
    - _Requirements: 1.3, 1.4, 1.5, 16.1_

- [ ] 2. Implement the progress store
  - [ ] 2.1 Implement `lib/progress-store.ts` with the `ProgressStore` interface, `MemoryProgressStore` and `DynamoProgressStore` (single `UpdateItem` expression, `Query` with `begins_with`, ttl refresh), selected by `PROGRESS_BACKEND`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 3.7_
  - [ ] 2.2 Update `handlers/run.ts` to record the run after an interpreter result when an actor id exists, tolerate write failures, skip the `mock` run backend, and include `actorId` in the `record_run` payload
    - _Requirements: 2.3, 2.6, 2.7_
  - [ ] 2.3 Rewrite `handlers/progress.ts` to return the real `Progress` (completed ids in content order, `totalExercises` from content, unknown ids ignored, schema validated)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [ ] 2.4 Write Vitest tests with a faked DynamoDB client: increment and first completion, `completedAt` not overwritten, non-passing runs, ordering, filtering, failure tolerance, memory backend; confirm Phase 0 to 2 tests pass without a learner id
    - _Requirements: 2.3, 2.4, 2.6, 3.4, 3.5, 13.3, 16.1_

- [ ] 3. Define the table and the memory in CDK
  - [ ] 3.1 Add the DynamoDB table to `AgentStack` (keys `pk` and `sk`, on-demand, `ttl` attribute, default encryption, `DESTROY` removal policy for the POC) with outputs and tags
    - _Requirements: 2.1, 2.8, 2.9_
  - [ ] 3.2 Add `CfnMemory` with the semantic, user preference and summary strategies and their namespace templates, `eventExpiryDuration` and record expiry from context; confirm the L1 property names for built-in strategies and for the record expiry, the naming pattern, and the deployer permission `UpdateMemoryRecordExpirySpecification`; record any limitation in the design
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 12.1_
  - [ ] 3.3 Grant the runtime role the table and memory permissions (with the namespace condition on retrieval), set `TABLE_NAME` and `MEMORY_ID` on the runtime, add the `MemoryId` and `MemoryArn` outputs and the context keys `memoryEventExpiryDays`, `memoryRecordExpiryDays`, `learnerDataTtlDays`
    - _Requirements: 5.7, 11.3, 11.4, 11.7, 11.8_
  - [ ] 3.4 Update `ApiStack`: `tableName` and `tableArn` props, `TABLE_NAME` and `PROGRESS_BACKEND` on `run` and `progress`, `UpdateItem` on `run`, `Query` on `progress`, no table access on other roles; wire the props in `bin/app.ts`
    - _Requirements: 11.1, 11.2, 11.5, 11.6, 11.8_
  - [ ] 3.5 Write Jest assertions: table keys, billing mode, TTL, strategies and namespaces, expiry values, scoped actions per role, environment variables, tags
    - _Requirements: 16.4_

- [ ] 4. Persist the tutor state in the agent
  - [ ] 4.1 Add optional `actorId` validation to `protocol.py` and implement `store.py` with the `StateStore` protocol and `InMemoryStateStore`
    - _Requirements: 4.7, 4.8_
  - [ ] 4.2 Implement `DynamoStateStore` (consistent `GetItem`, monotonic conditional `UpdateItem` for hints, idempotent reveal flag, JSON struggles, ttl refresh, calls in worker threads)
    - _Requirements: 4.1, 4.3_
  - [ ] 4.3 Integrate the store into `state.py`, `tools.py` and `app.py`: load on first request per actor and exercise, persist on change, fall back to closed-gate defaults on failure, keep the Phase 1 and 2 behavior when there is no actor
    - _Requirements: 4.2, 4.4, 4.5, 4.6, 4.8_
  - [ ] 4.4 Write pytest tests with a fake store: load and persist, monotonic updates, cross-session ladder continuation, failure fallback keeps the gate closed, in-memory path without an actor
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 16.2_

- [ ] 5. Add AgentCore Memory to the agent
  - [ ] 5.1 Implement `memory.py` `write_turn` and `write_note` over the `bedrock-agentcore` client (`CreateEvent`, 4000-character truncation, 2 s limit, fail-soft) and a `NullMemory`; confirm the allowed event roles for the completion note
    - _Requirements: 6.1, 6.2, 6.5, 6.6, 6.7, 6.8_
  - [ ] 5.2 Implement `retrieve` with three parallel `RetrieveMemoryRecords` calls, a shared 1.5 s limit, per-namespace top-k, session and exercise cache, and block rendering with the `untrusted` delimiter and the 2000-character cap; confirm whether the `namespace` parameter matches as a prefix and use `namespacePath` otherwise
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [ ] 5.3 Integrate memory into `app.py`: retrieval in parallel with the state load before the model call, memory block and deterministic state block in the context, write of the guarded reply before `done`, note on `record_run` pass; never write tool output, hints, run records or the solution
    - _Requirements: 6.3, 6.4, 6.9, 14.2, 14.3_
  - [ ] 5.4 Update `prompts.py` with the memory rules (unverified data, no rule changes, deterministic state wins, returning-student greeting, preferences applied silently, no claims beyond the block, no personal data) and keep the prompt principle tests passing
    - _Requirements: 8.1, 8.3, 8.7, 9.1, 9.2, 9.3, 9.4_
  - [ ] 5.5 Write pytest tests with a fake memory: event contains the guarded text only, truncation, write timeout, retrieval time limit and parallelism, caching, block rendering and truncation, empty result omits the block, disabled mode, gate and ladder independent of memory content
    - _Requirements: 6.3, 6.4, 6.6, 7.2, 7.4, 8.2, 8.4, 16.2_

- [ ] 6. Build the front-end progress panel
  - [ ] 6.1 Update `client.ts` with `getLearnerId`, `resetLearner` and the `X-Learner-Id` header on every request; keep storage access inside this module
    - _Requirements: 1.1, 1.2, 10.6_
  - [ ] 6.2 Implement `useProgress` (fetch on load, refetch after a passing run, local fallback with notice on failure, reset) and compose it in `TutorProvider`, replacing the local completion as the source of truth
    - _Requirements: 10.3, 10.4, 10.5_
  - [ ] 6.3 Implement `ProgressPanel` (counter text, `role="progressbar"` with ARIA values and name, exercise list with text and icon states) and mark completed exercises in the lesson tabs
    - _Requirements: 10.1, 10.2, 10.9, 10.10_
  - [ ] 6.4 Add the privacy note and the "Empezar de cero" action with the inline confirmation, keyboard operable, with visible focus and 4.5:1 contrast
    - _Requirements: 10.7, 10.8, 10.9_
  - [ ] 6.5 Write Vitest + React Testing Library tests: learner id creation and reuse, header on every request, fetch and refetch, ARIA attributes, reset flow, fallback notice
    - _Requirements: 16.3_

- [ ] 7. Evaluate the tutor with memory
  - [ ] 7.1 Add the poisoning conversations (claim of being the teacher, claim that hints were used, a new session whose memory block contains the claim) to the evaluation set and extend the offline tests to verify gate, ladder and guard with a hostile memory block
    - _Requirements: 8.2, 8.3, 8.4, 8.5_
  - [ ] 7.2 Document local runs with and without cloud resources in the README (in-memory defaults, real table and memory with developer credentials, no Docker)
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [ ] 8. Checkpoint: build and test everything
  - [ ] 8.1 Run `typecheck`, `lint` and `test` for every workspace, `uv run ruff check`, `uv run ruff format --check` and `uv run pytest`, rebuild the agent zip and run `cdk synth`; fix any failure
    - _Requirements: 13.1, 13.3, 13.4, 16.1, 16.2, 16.3, 16.4_

- [ ] 9. Deploy and verify in AWS
  - [ ] 9.1 Deploy `AgentStack` after explicit user confirmation (billable resources); confirm memory availability in the region, that the memory reaches `ACTIVE`, that the retrieval permission with the namespace condition works, and record any difference from the design
    - _Requirements: 5.7, 11.4_
  - [ ] 9.2 Deploy `ApiStack` and `WebStack`
    - _Requirements: 2.1, 3.1_
  - [ ] 9.3 Verify persistence end to end: complete an exercise, reload and see the progress; use two hints, close the tab, reopen and continue the ladder; start over creates a clean state
    - _Requirements: 3.1, 4.5, 10.8, 16.5_
  - [ ] 9.4 Measure the long-term extraction delay and inspect the extracted records for quality (concepts, preferences, summaries); record the findings, and if records are noisy test `appendToPrompt` overrides for the semantic strategy; record the final strategy set (D20)
    - _Requirements: 5.9, 9.2_
  - [ ] 9.5 Run the live evaluation with the poisoning conversations, tune the prompt or guard if a case fails, and record the results in the design
    - _Requirements: 8.6_
  - [ ] 9.6 Measure time to first token with retrieval enabled over 10 requests and the `/api/progress` median; record both in the design and apply a mitigation if a target is missed
    - _Requirements: 14.1, 14.4_
  - [ ] 9.7 Run the manual E2E path: persistence, ladder continuation, start over, greeting from the previous summary in a new session, a poisoning attempt
    - _Requirements: 9.1, 16.5_

- [ ] 10. Documentation, post draft and phase close
  - [ ] 10.1 Record the final status of open decision 3 and D15 to D20, the retention table and the measured numbers in the design
    - _Requirements: 12.3, 12.5, 17.3_
  - [ ] 10.2 Update the README with the new environment variables, the table schema and the per-student cost estimate of memory and storage
    - _Requirements: 17.2_
  - [ ] 10.3 Write `docs/posts/post-04-agente-que-recuerda.md` about an agent that remembers, explaining the DynamoDB and AgentCore Memory split and the poisoning mitigations
    - _Requirements: 17.1_
  - [ ] 10.4 Tag the repository `fase-3` after the user approves the final state
    - _Requirements: 17.4_

## Notes

- Tasks 9.1 to 9.7 deploy billable resources and use the real model and memory service. They need explicit user confirmation.
- Decisions D15 (DynamoDB plus Memory), D16 (panel shows deterministic data only), D17 (table in `AgentStack`), D18 (manual event writes), D19 (anonymous identity) and D20 (strategy set) are confirmed by the user.
- The deployer principal needs `bedrock-agentcore:UpdateMemoryRecordExpirySpecification` when record expiry is configured (task 3.2 checks this).
- Student data locations and retention are listed in the design and must be kept up to date.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1", "5.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "3.2", "4.2", "5.2", "6.2"] },
    { "id": 2, "tasks": ["1.3", "2.2", "3.3", "4.3", "6.3"] },
    { "id": 3, "tasks": ["2.3", "3.4", "4.4", "5.3", "6.4"] },
    { "id": 4, "tasks": ["2.4", "3.5", "5.4", "6.5"] },
    { "id": 5, "tasks": ["5.5", "7.1", "7.2"] },
    { "id": 6, "tasks": ["8.1"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["9.2"] },
    { "id": 9, "tasks": ["9.3"] },
    { "id": 10, "tasks": ["9.4"] },
    { "id": 11, "tasks": ["9.5"] },
    { "id": 12, "tasks": ["9.6"] },
    { "id": 13, "tasks": ["9.7"] },
    { "id": 14, "tasks": ["10.1", "10.2", "10.3"] },
    { "id": 15, "tasks": ["10.4"] }
  ]
}
```
