# Implementation Plan: Phase 2 Code Execution

## Overview

This plan makes `/api/run` real. It defines the Code Interpreter in `AgentStack`, builds the server-side test harness and the interpreter client, rewrites the `run` handler, and gives the agent run awareness (`record_run`, `get_last_run`, `run_snippet`). The contract in `shared/` and the front end do not change.

## Tasks

- [ ] 1. Define the Code Interpreter in `AgentStack`
  - [ ] 1.1 Add `CfnCodeInterpreterCustom` with network mode `SANDBOX`, no execution role, description and tags
    - _Requirements: 1.1, 1.2, 1.5_
  - [ ] 1.2 Grant the runtime role `StartCodeInterpreterSession`, `InvokeCodeInterpreter` and `StopCodeInterpreterSession` on the interpreter ARN, set `CODE_INTERPRETER_ID` on the runtime, and add the `CodeInterpreterId` and `CodeInterpreterArn` outputs
    - _Requirements: 1.4, 11.2_
  - [ ] 1.3 Check the service naming pattern for the interpreter name in the CloudFormation reference, derive the name from the project name with allowed characters only, and run `cdk synth`
    - _Requirements: 1.3_
  - [ ] 1.4 Write Jest assertions: `SANDBOX` mode, absence of `ExecutionRoleArn`, scoped runtime permissions without wildcard actions, environment variable, outputs, tags
    - _Requirements: 15.4_

- [ ] 2. Build the test harness
  - [ ] 2.1 Implement `api/src/lib/harness.ts` `buildHarness` with the Python template (base64 code and tests, nonce, per-call interval timer, memory limit relative to the current address space, stdout and stderr capture with caps, cleaned student tracebacks, `input()` replacement, best-effort socket block, single nonce-prefixed result line)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.12, 4.1, 4.2, 4.5_
  - [ ] 2.2 Implement `parseHarnessOutput` with a zod `HarnessResultSchema` that accepts only the line carrying the nonce and validates the test count
    - _Requirements: 3.6, 7.2_
  - [ ] 2.3 Write Vitest unit tests: generated source has the nonce and base64 values and no solution text, special and multi-line student code leaves the script intact, forged and malformed lines are rejected
    - _Requirements: 15.1_
  - [ ] 2.4 Write Vitest execution tests that run the generated harness with local Python through `uv run` (skipped when unavailable): passing code, wrong answer, syntax error, runtime exception, infinite loop, big allocation, `input()`, a student print that imitates the result line, and the reference solutions and starter codes of module 3
    - Use only repository fixtures and reference solutions, never external code
    - _Requirements: 3.11, 14.2, 14.3, 15.2_

- [ ] 3. Implement the interpreter client and the result mapper
  - [ ] 3.1 Implement `lib/interpreter-client.ts` with the interface, the SDK implementation (start session with the short TTL, `executeCode` in Python, stream decoding, stop session) and a fake for tests; support an `AbortSignal` for the wall clock
    - _Requirements: 2.1, 2.2, 2.6, 4.3, 5.1, 5.2_
  - [ ] 3.2 Implement `lib/run-mapper.ts` that builds `RunResult` from the harness result and the exercise tests (names by index, `passed` as conjunction, caps of 4000 and 8000 characters, control character stripping)
    - _Requirements: 2.3, 2.7, 2.8, 4.6_
  - [ ] 3.3 Extend `lib/agent-client.ts` with `recordRun` for both the SDK and the local implementations
    - _Requirements: 8.1, 8.2_

- [ ] 4. Implement the `run` handler
  - [ ] 4.1 Rewrite `handlers/run.ts`: validation unchanged, `RUN_BACKEND` switch, nonce, interpreter call with the 15 s abort, parallel session stop and agent record with a 5 s limit in `finally`, parsing, mapping, failure semantics table, structured logs without student code
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 4.3, 4.4, 5.2, 5.3, 7.1, 7.2, 7.3, 8.1, 8.2, 13.4_
  - [ ] 4.2 Write Vitest handler tests with fakes: call order, stop on every path, wall clock result, 502 mapping, mock switch, record failure ignored, contract shape, no solution in any response, Phase 0 and Phase 1 tests still pass
    - _Requirements: 12.3, 15.1_

- [ ] 5. Update `ApiStack`
  - [ ] 5.1 Add the `codeInterpreterId` and `codeInterpreterArn` props, the `run` environment variables, the scoped interpreter permissions and `InvokeAgentRuntime` for `run`, timeout 25 s, bundling of the AgentCore SDK, the 29 s integration timeout and the `/api/run` method throttle (5 per second, burst 10); wire the props in `bin/app.ts`
    - _Requirements: 2.6, 4.8, 11.1, 11.3, 11.4, 13.3_
  - [ ] 5.2 Update the Jest assertions: interpreter actions only on `run`, `InvokeAgentRuntime` only on `chat`, `hint` and `run`, no Bedrock or AgentCore permission on `content` and `progress`, throttle and timeouts
    - _Requirements: 11.5, 15.4_

- [ ] 6. Add run awareness to the agent
  - [ ] 6.1 Add the `record_run` payload to `protocol.py` with type and size validation, and the acknowledgment event
    - _Requirements: 8.7, 8.8_
  - [ ] 6.2 Extend `state.py` with run records (truncated), failure streaks per test, passed exercises and pending notices; add the context block that lists the exercise state and clears used notices
    - _Requirements: 8.3, 8.5, 8.6_
  - [ ] 6.3 Write pytest tests: validation and truncation, streak counting across runs, notice after 3 consecutive failures of the same test and clearing after use, passed state, `record_run` does not call the model
    - _Requirements: 8.3, 8.5, 8.6, 8.7, 15.3_

- [ ] 7. Add the agent tools and prompt rules
  - [ ] 7.1 Implement `sandbox.py` over the `bedrock-agentcore` boto3 client (start, `executeCode`, stop, 6 s read timeout, output caps) and evaluate the SDK `code_session` helper as the alternative; record the choice (D13) in the design
    - _Requirements: 9.1, 9.4_
  - [ ] 7.2 Implement `run_snippet(code)` with the 1500-character, 5 s, 2000-character and 3-calls-per-turn limits and the unavailable mode when `CODE_INTERPRETER_ID` is missing
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [ ] 7.3 Implement `get_last_run(exercise_id)` with the untrusted-data delimiters
    - _Requirements: 8.4, 6.6_
  - [ ] 7.4 Update `prompts.py`: untrusted data rule for run output and snippets, error explanation style, when to use `get_last_run` and `run_snippet`, no solution writing with the snippet tool; keep the prompt principle tests passing
    - _Requirements: 9.6, 10.1, 10.2_
  - [ ] 7.5 Write pytest tests with a fake sandbox: limits, session stop on failure, unavailable mode, delimiters, solution guard still applied to tutor output after tool use
    - _Requirements: 9.7, 15.3_

- [ ] 8. Evaluation, content verification and checkpoint
  - [ ] 8.1 Add the three injection conversations to the evaluation set (printed instruction, comment in code, claim that tests are wrong) and extend the offline tests so gate, counters and guard are verified with run records in context
    - _Requirements: 10.3, 10.4_
  - [ ] 8.2 Implement `npm run verify-content` (TypeScript script in `scripts/` using the harness builder and the real interpreter) that checks every solution passes all tests and every starter code fails at least one, failing on unexpected exceptions with the solution
    - _Requirements: 14.1, 14.2, 14.4_
  - [ ] 8.3 Update `docs` in the README for the harness tests, content verification and the Phase 2 environment variables
    - _Requirements: 16.2_
  - [ ] 8.4 Run `typecheck`, `lint` and `test` for every workspace, `uv run ruff check`, `uv run ruff format --check` and `uv run pytest`, rebuild the agent zip and run `cdk synth`; fix any failure
    - _Requirements: 12.3, 15.1, 15.3, 15.4_

- [ ] 9. Deploy and verify in AWS
  - [ ] 9.1 Deploy `AgentStack` after explicit user confirmation (billable resources); record the real ARN format of the custom interpreter, confirm the IAM resource pattern matches it, and confirm availability in the region
    - _Requirements: 1.6, 1.7_
  - [ ] 9.2 Run a smoke call against the interpreter that prints `sys.version` and a nonce line: record the Python version, the shape of the response stream events and the session start latency in the design; adjust the stream decoder and the harness compatibility if needed
    - _Requirements: 3.11, 5.5_
  - [ ] 9.3 Deploy `ApiStack` and `WebStack`, then run `npm run verify-content` against the real interpreter
    - _Requirements: 14.1_
  - [ ] 9.4 Re-run the live evaluation with the new conversations, tune the guard threshold or the prompt if a case fails, and record the results in the design
    - _Requirements: 10.5_
  - [ ] 9.5 Measure the end-to-end run time over 10 requests from the browser (median, maximum and breakdown), record it in the design, and apply a mitigation if the median exceeds 5 seconds
    - _Requirements: 13.1, 13.2, 5.5_
  - [ ] 9.6 Run the manual E2E path: pass, wrong answer, syntax error, exception, infinite loop, long output, tutor explains the last error, printed instruction trying to extract the solution
    - _Requirements: 6.7, 15.5_

- [ ] 10. Documentation, post draft and phase close
  - [ ] 10.1 Record the final status of D10 to D14, the measured latencies and the Sandbox mode security statement in the design
    - _Requirements: 6.3, 6.4, 6.5, 16.3_
  - [ ] 10.2 Update the README with the per-run cost estimate of the Code Interpreter and the account-level notes (quotas, session limits)
    - _Requirements: 16.2_
  - [ ] 10.3 Write `docs/posts/post-03-ejecucion-segura.md` about safe code execution with the AgentCore Code Interpreter, including the harness design and the honest Sandbox mode wording
    - _Requirements: 16.1_
  - [ ] 10.4 Tag the repository `fase-2` after the user approves the final state
    - _Requirements: 16.4_

## Notes

- Tasks 9.1 to 9.6 deploy billable resources and exercise the real Code Interpreter and model. They need explicit user confirmation.
- Student code is never executed outside the Code Interpreter. The local harness tests in task 2.4 run only repository fixtures and reference solutions through `uv run`.
- Decisions D10 (ephemeral session per run), D11 (expected values in failure messages), D12 (custom interpreter) and D13 (boto3 wrapper) are confirmed by the user; task 7.1 records the final choice for D13.
- Sandbox mode is described honestly as "no public internet intended and no credentials", not as proven absence of every outbound channel.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "6.1", "7.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.1", "3.3", "6.2", "7.2"] },
    { "id": 2, "tasks": ["1.3", "2.3", "2.4", "3.2", "6.3", "7.3"] },
    { "id": 3, "tasks": ["1.4", "4.1", "5.1", "7.4"] },
    { "id": 4, "tasks": ["4.2", "5.2", "7.5", "8.2"] },
    { "id": 5, "tasks": ["8.1", "8.3"] },
    { "id": 6, "tasks": ["8.4"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["9.2"] },
    { "id": 9, "tasks": ["9.3"] },
    { "id": 10, "tasks": ["9.4"] },
    { "id": 11, "tasks": ["9.5"] },
    { "id": 12, "tasks": ["9.6"] },
    { "id": 13, "tasks": ["10.1", "10.2", "10.3"] },
    { "id": 14, "tasks": ["10.4"] }
  ]
}
```
