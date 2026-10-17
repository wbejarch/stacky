# Implementation Plan: Phase 1 Real Tutor

## Overview

This plan replaces the mock tutor with a Strands agent (Python 3.13, uv) deployed on AgentCore Runtime with direct code deployment. It builds the agent project, the hint ladder and solution protection, the packaging script and `AgentStack`, and the changes in the `chat` and `hint` Lambdas that call the agent and relay its stream. The contract in `shared/` and the front end do not change.

## Tasks

- [ ] 1. Create the agent project
  - [ ] 1.1 Create `agent/` with `uv init`, Python 3.13 (`uv venv --python 3.13`), `pyproject.toml` with pinned `strands-agents`, `bedrock-agentcore`, `boto3` and dev dependencies `pytest`, `pytest-asyncio`, `ruff`; run `uv sync` and commit `uv.lock`
    - Configure ruff (lint + format) and pytest (`live` marker excluded by default)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ] 1.2 Implement `config.py` reading `MODEL_ID`, `MAX_OUTPUT_TOKENS`, `SESSION_TOKEN_BUDGET`, `CONTENT_DIR`, `GUARD_THRESHOLD`, failing at startup if `MODEL_ID` is missing; list the Bedrock models and inference profiles available in the chosen region, pick one Claude model, justify cost and latency in the design (D4) and set it in `infra/cdk.json`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [ ] 1.3 Implement `logging.py` (JSON logs with runtime session id, event type and exercise id; no full student message at info level)
    - _Requirements: 2.8_

- [ ] 2. Load content and hold session state
  - [ ] 2.1 Implement `content.py` to load `ejercicios.json`, `leccion.md` and `errores-comunes.md` from `CONTENT_DIR`, and a public view (title, statement, starter code) that excludes `solution` and `hints`
    - _Requirements: 3.5, 5.1_
  - [ ] 2.2 Implement `state.py` with `SessionState` (hints used per exercise, solution revealed, struggle counters, tokens used) and a registry keyed by runtime session id
    - _Requirements: 2.7, 4.1, 6.1, 7.4_

- [ ] 3. Define the protocol and payload validation
  - [ ] 3.1 Implement `protocol.py` with payload parsing for `chat` and `hint` (string check on `message`, known `exerciseId`, `level` in 1 to 3) and event constructors (`token`, `done`, `error`, `hint`, `refused`)
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 13.4_
  - [ ] 3.2 Write pytest tests for valid payloads and every invalid case, including a non-string `message` and an unknown exercise
    - _Requirements: 2.3, 2.4, 17.1_

- [ ] 4. Implement the tools
  - [ ] 4.1 Implement `tools.py` with `build_tools(state, content)` returning `get_next_hint`, `reveal_solution` and `record_struggle` as Strands tools bound to the session
    - `reveal_solution` is the only code path that reads `solution`
    - _Requirements: 4.6, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3_
  - [ ] 4.2 Implement the deterministic hint response used by `type: hint` (ladder check, same counters, refusal naming the missing level)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ] 4.3 Write pytest tests for the ladder transitions, repeated levels, refusals, the solution gate, the struggle threshold and reset, and a test that fails if any module other than the reveal path references the solution field
    - _Requirements: 4.2, 4.3, 4.4, 5.2, 5.3, 6.2, 6.3, 17.1_

- [ ] 5. Implement the solution guard
  - [ ] 5.1 Implement `guard.py` with `SolutionGuard.feed` and `flush`, fenced block buffering, code normalization and similarity scoring with the configurable threshold
    - _Requirements: 5.5, 5.6, 5.7_
  - [ ] 5.2 Write pytest tests with split fences across chunks, a solution-like block, an unrelated block, gate open pass-through and an unterminated block at flush
    - _Requirements: 5.5, 5.6, 5.7, 17.1_

- [ ] 6. Assemble the tutor
  - [ ] 6.1 Write `prompts.py` with the Spanish system prompt, the fixed messages (budget exhausted, guard replacement) and the instructions for tool use, adaptation and injection hygiene
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 6.4_
  - [ ] 6.2 Write `tests/test_prompts.py` that fails when a mandatory principle phrase from `product.md` is missing
    - _Requirements: 3.7, 17.1_
  - [ ] 6.3 Implement `app.py` with `BedrockAgentCoreApp`, `@app.entrypoint` (async generator), the per-session Strands agent with a sliding window conversation manager, exercise context injection without the solution, the token budget check and usage accounting, the guard on the text stream and the structured error handling
    - _Requirements: 2.1, 2.5, 2.6, 3.5, 7.3, 7.4, 7.5, 7.7_
  - [ ] 6.4 Write pytest tests for the entrypoint with a stub model: streaming order, `done` at the end, invalid payload without model call, budget exhaustion without model call, hint mode without model call
    - _Requirements: 2.4, 2.5, 7.5, 17.1_

- [ ] 7. Evaluate the tutor
  - [ ] 7.1 Write the fixed conversation set (direct request, insistence, claim of being the teacher, pasted instruction to ignore rules, request in English, level 3 requested first) and the offline tests with a scripted stub model that verify gate, counters and guard
    - _Requirements: 15.1, 15.2_
  - [ ] 7.2 Add the `live` evaluation that runs the same conversations against the real model locally, checks that no solution-like fenced block appears before the gate opens, and writes `agent/tests/eval/last-run.md`
    - Run it manually with the developer's AWS credentials, tune `GUARD_THRESHOLD` and the prompt if a case fails, and record the final results in the design
    - _Requirements: 15.3, 15.4, 15.5_

- [ ] 8. Package and define `AgentStack`
  - [ ] 8.1 Confirm that AgentCore Runtime and the selected model are available in the chosen region (decision 5 and D5) and record the answer in the design
    - _Requirements: 9.8, 18.3_
  - [ ] 8.2 Write `scripts/package-agent.ps1`, `scripts/package-agent.sh` and `scripts/make_zip.py` implementing `uv export`, `uv pip install` for `aarch64-manylinux2014`, copy of agent code and `content/`, the `main.py` shim, bytecode cleanup, explicit POSIX modes, the size report and the 250 MB failure
    - Build once and inspect the zip (modes, size, absence of `__pycache__`) and record the size in the design
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [ ] 8.3 Implement `infra/lib/agent-stack.ts` with the S3 `Asset` for the zip, `AgentRuntimeArtifact.fromS3` (`PYTHON_3_13`, entrypoint `main.py`), the `Runtime` with environment variables from context, and scoped Bedrock model permissions; check whether the `Runtime` construct grants S3 read on the artifact and add an explicit grant if not
    - Use a CDK L1 override only if the L2 lacks a needed property, and note it in the design
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [ ] 8.4 Add outputs, tags, the `cdk.json` context keys (`modelId`, `maxOutputTokens`, `sessionTokenBudget`, `agentZipPath`) and wire the stack order `AgentStack`, `ApiStack`, `WebStack` in `bin/app.ts`
    - _Requirements: 9.5, 9.6, 9.7_
  - [ ] 8.5 Write Jest assertions for `AgentStack` using a fixture zip: runtime artifact and entrypoint, Python 3.13, environment variables, no wildcard model resources, tags
    - _Requirements: 17.4_

- [ ] 9. Integrate the API with the agent
  - [ ] 9.1 Add `@aws-sdk/client-bedrock-agentcore` (pinned), `lib/agent-protocol.ts` (zod schema mirroring the agent events) and `lib/session.ts` with `deriveRuntimeSessionId`
    - _Requirements: 10.2, 10.3_
  - [ ] 9.2 Implement `lib/agent-client.ts` with `AgentCoreClient` (`InvokeAgentRuntimeCommand`, incremental stream decoding, `data:` line parsing) and `LocalAgentClient` (HTTP to `AGENT_LOCAL_URL`); verify the actual stream framing from the SDK response and adjust the parser
    - _Requirements: 10.1, 10.4, 10.8, 16.2_
  - [ ] 9.3 Update `ApiStack`: `agentRuntimeArn` prop, `TUTOR_BACKEND` and `AGENT_RUNTIME_ARN` env vars, `InvokeAgentRuntime` permission only on `chat` and `hint` (verify the resource format for the runtime and its endpoints), timeouts of 120 s and 15 s, 120,000 ms integration timeout on `/api/chat`, and bundling of the new SDK
    - _Requirements: 10.1, 12.2, 12.3, 13.1, 13.2_
  - [ ] 9.4 Update `handlers/chat.ts`: backend switch, event mapping to SSE frames, immediate write of the first token, error mapping table, logging of both session ids
    - _Requirements: 10.4, 10.5, 10.6, 10.7, 10.9, 10.10_
  - [ ] 9.5 Update `handlers/hint.ts`: required `X-Session-Id`, agent call in deterministic mode, schema validation, refusal to 400, unavailable agent to 502, mock backend path
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  - [ ] 9.6 Write Vitest tests with a faked SDK (stream relay, ordering, error mapping, session id derivation and length, backend switch, hint refusal) and confirm that the Phase 0 contract tests pass with `TUTOR_BACKEND=mock`
    - _Requirements: 14.3, 14.4, 17.3_
  - [ ] 9.7 Update the Jest assertions for `ApiStack`: `InvokeAgentRuntime` only on `chat` and `hint`, no `bedrock:*` on any function, new timeouts
    - _Requirements: 13.2, 17.4_

- [ ] 10. Local development
  - [ ] 10.1 Add `TUTOR_BACKEND` and `AGENT_LOCAL_URL` support to `api/src/local/dev-server.ts` and document the local agent commands (`uv run`, port 8080, `curl` example) in the README
    - _Requirements: 16.1, 16.2, 16.3_

- [ ] 11. Checkpoint: build and test everything
  - [ ] 11.1 Run `uv run ruff check`, `uv run ruff format --check`, `uv run pytest`, then `typecheck`, `lint` and `test` for `shared`, `api`, `web` and `infra`, build the agent zip and run `cdk synth`; fix any failure
    - _Requirements: 14.1, 14.2, 17.1, 17.2_

- [ ] 12. Deploy and verify in AWS
  - [ ] 12.1 Deploy `AgentStack`, `ApiStack` and `WebStack` after explicit user confirmation, since this creates billable resources and calls a paid model
    - _Requirements: 9.7_
  - [ ] 12.2 Smoke-test the runtime with a direct `InvokeAgentRuntime` call and the deployed `/api/chat` and `/api/hint` with `curl`
    - _Requirements: 10.1, 10.4, 11.1_
  - [ ] 12.3 Measure the time to first token over 10 requests from the browser (target under 3 seconds) and record the median in the design
    - _Requirements: 12.1_
  - [ ] 12.4 Run the manual E2E path: direct solution request, three hints in order, level 3 first (blocked), insistence, explanation after level 3, cancel, and the budget message with a temporarily low budget
    - _Requirements: 17.5_

- [ ] 13. Documentation, post draft and phase close
  - [ ] 13.1 Update the README with build, package, deploy and local-run commands and the per-student cost estimate (model tokens and AgentCore Runtime)
    - _Requirements: 18.2_
  - [ ] 13.2 Update `structure.md` and `tech.md` only if the agent layout or packaging rules changed, and record decisions D3 to D9 and the results of the live evaluation in this design
    - _Requirements: 15.5, 18.3_
  - [ ] 13.3 Write `docs/posts/post-02-primer-agente-tutor.md` about the first tutor agent with Strands, Bedrock and AgentCore Runtime, including the four protection layers and the measured latency
    - _Requirements: 18.1_
  - [ ] 13.4 Tag the repository `fase-1` after the user approves the final state
    - _Requirements: 18.4_

## Notes

- Tasks 7.2 and 12.1 to 12.4 call the real Bedrock model and AWS services, which costs money. They need explicit user confirmation and the developer's AWS credentials.
- Task 1.2 chooses the model id (decision D4) and stores it in `infra/cdk.json`; no model id is written in code.
- Decisions D3 (`fromS3` with a file asset), D6 (hints through the agent) and D7 (IAM toward the agent) are confirmed by the user.
- Task 11.1 is a checkpoint that runs all linters and tests before any deployment.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "3.1", "8.1", "9.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "5.1", "6.1", "8.2", "9.2"] },
    { "id": 3, "tasks": ["4.1", "5.2", "6.2", "8.3"] },
    { "id": 4, "tasks": ["4.2", "8.4", "9.4", "9.5"] },
    { "id": 5, "tasks": ["4.3", "6.3", "8.5", "9.3", "9.6", "10.1"] },
    { "id": 6, "tasks": ["6.4", "7.1", "9.7"] },
    { "id": 7, "tasks": ["7.2"] },
    { "id": 8, "tasks": ["11.1"] },
    { "id": 9, "tasks": ["12.1"] },
    { "id": 10, "tasks": ["12.2"] },
    { "id": 11, "tasks": ["12.3"] },
    { "id": 12, "tasks": ["12.4"] },
    { "id": 13, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 14, "tasks": ["13.4"] }
  ]
}
```
