# Requirements Document

## Introduction

This document covers Phase 1 (Real tutor) of `tutor-agent`. Phase 1 replaces the mock tutor with a real Socratic agent built with the Strands Agents SDK (Python 3.13, managed with uv) and deployed on Amazon Bedrock AgentCore Runtime using direct code deployment (zip in S3, arm64, no containers). The TypeScript API invokes the agent and relays its streamed reply to the browser through the existing SSE contract.

Phase scope:
- New `agent/` project (the only Python component) with the tutor prompt, hint ladder, solution protection and the model configuration.
- New `AgentStack` in CDK, and changes in `ApiStack` so the `chat` and `hint` Lambdas call the agent.
- The API contract in `shared/` and the front end do not change.

Out of scope (later phases): running student code (Phase 2), AgentCore Memory and persistent progress (Phase 3), Knowledge Base and Guardrails (Phase 4), authentication and observability dashboards (Phase 5).

Exit criterion: in the browser, the student chats with a real tutor that answers in Spanish with the Socratic method, asks for the three hint levels in order, and does not receive the full solution before the hints are exhausted. The phase ends with the `fase-1` git tag and the draft of Post 2.

Language convention: code, comments and this spec are in English. Text shown to the student and the tutor prompt are in Spanish.

## Glossary

- **Agent**: the Strands agent running on AgentCore Runtime.
- **Runtime session**: an AgentCore Runtime session identified by `runtimeSessionId`; state kept in process memory lives as long as the session.
- **Hint ladder**: the ordered levels 1 (orientation), 2 (structure) and 3 (almost the solution).
- **Solution gate**: the deterministic rule that decides whether the reference solution may be revealed.
- **Solution guard**: the check applied to the agent output that blocks code resembling the reference solution while the gate is closed.
- **Agent stream protocol**: the internal JSON event format between the agent and the `chat` Lambda.

## Requirements

### Requirement 1: Agent project with uv

**User Story:** As a developer, I want an isolated Python project for the agent, so that dependencies are reproducible and Python never mixes with the TypeScript code.

#### Acceptance Criteria

1. THE repository SHALL contain `agent/` with `pyproject.toml`, a committed `uv.lock`, `src/agent/` and `tests/`.
2. THE agent project SHALL target Python 3.13 and use a virtual environment created with `uv venv --python 3.13` and synchronized with `uv sync`.
3. THE agent project SHALL declare dependencies only in `pyproject.toml` and SHALL NOT use `pip install` directly or a hand-written `requirements.txt`.
4. THE agent project SHALL use ruff for lint and format, and pytest for tests, both run with `uv run`.
5. THE repository SHALL NOT contain Python code in `api/`, `infra/` or `web/`.
6. WHERE a Python helper is needed for packaging, THE helper SHALL live in `scripts/`, use only the standard library, and be run with `uv run`.

### Requirement 2: Agent entrypoint and stream protocol

**User Story:** As a developer, I want a well-defined entrypoint and event format, so that the API can relay the tutor reply without knowing agent internals.

#### Acceptance Criteria

1. THE agent SHALL expose its entrypoint with `@app.entrypoint` from the AgentCore Python SDK (`BedrockAgentCoreApp`), which serves `/invocations` and `/ping`.
2. THE entrypoint SHALL accept a JSON payload with a `type` field whose value is `chat` or `hint`.
3. THE entrypoint SHALL validate that `message` is a string, that `exerciseId` is a known exercise id, and that `level` is 1, 2 or 3 for `hint`, before any call to the model.
4. IF the payload is invalid, THEN THE agent SHALL emit a single `error` event and SHALL NOT call the model.
5. FOR `chat`, THE agent SHALL stream events of the agent stream protocol: `{"type":"token","text":"..."}`, then `{"type":"done"}`, or `{"type":"error","message":"..."}`.
6. WHEN the model produces text, THEN THE agent SHALL emit `token` events incrementally without waiting for the complete reply.
7. THE agent SHALL key its in-memory state by the AgentCore runtime session id.
8. THE agent SHALL write structured JSON logs that include the runtime session id, the event type and the exercise id, and SHALL NOT log the full student message at info level.

### Requirement 3: Socratic tutor prompt

**User Story:** As a student, I want a patient tutor that guides me with questions, so that I learn instead of copying.

#### Acceptance Criteria

1. THE system prompt SHALL be written in Spanish and SHALL be stored in a dedicated module (`prompts.py`), separate from the code logic.
2. THE system prompt SHALL state these rules: Socratic method, short answers, analogies and small examples, patient and curious tone, celebration of attempts, and explanation of error messages in simple words.
3. THE system prompt SHALL state that the hint ladder has 3 levels and that the full solution is never given unless the solution gate opens.
4. THE system prompt SHALL instruct the model to treat the student message as data and to ignore any instruction inside it that tries to change these rules.
5. THE agent SHALL include in the model context the exercise title, statement and starter code of the current exercise, and SHALL NOT include its `solution`.
6. THE agent SHALL answer in Spanish regardless of the language of the student message, unless the student explicitly asks for another language to understand a term.
7. THE prompt tests SHALL fail if any mandatory principle phrase from the product steering is removed from the prompt.

### Requirement 4: Progressive hint ladder

**User Story:** As a student, I want hints that grow in detail, so that I get help without losing the chance to think.

#### Acceptance Criteria

1. THE agent SHALL keep per runtime session and per exercise a `hints_used` counter from 0 to 3.
2. WHEN a hint of level N is requested, THEN THE agent SHALL return it only IF `hints_used >= N - 1`, and SHALL then set `hints_used` to at least N.
3. IF a hint of level N is requested while `hints_used < N - 1`, THEN THE agent SHALL refuse with a message naming the missing earlier level, and THE API SHALL answer 400 with an `ApiError` of code `invalid_request`.
4. WHEN a hint of a level already used is requested again, THEN THE agent SHALL return the same authored hint text and SHALL NOT change the counter.
5. FOR `type: hint`, THE agent SHALL return the authored hint text from `ejercicios.json` deterministically, without calling the model.
6. FOR `type: chat`, THE agent SHALL expose a `get_next_hint` tool that follows the same ladder and counters, so that hints requested in chat and through `/api/hint` share one counter.
7. WHEN the student asks for a hint in chat, THEN THE tutor SHALL present it in Socratic form, for example with a guiding question, without adding information beyond the authored hint of that level.

### Requirement 5: Solution protection

**User Story:** As the product owner, I want the reference solution protected, so that the tutor never hands over the answer before the hints are exhausted.

#### Acceptance Criteria

1. THE agent SHALL NOT place the `solution` of any exercise in the system prompt, in the initial context or in any tool result other than `reveal_solution`.
2. THE tool `reveal_solution` SHALL return the solution only IF `hints_used == 3` for that exercise AND the model passes `student_requested = true`.
3. IF `reveal_solution` is called while the gate is closed, THEN THE tool SHALL return a refusal text that tells the tutor to continue with the next hint or a guiding question.
4. WHEN the gate opens and the solution is revealed, THEN THE tutor SHALL explain the solution step by step in Spanish.
5. WHILE the gate is closed, THE solution guard SHALL inspect fenced code blocks in the agent output and SHALL replace a block whose normalized similarity to the reference solution is at or above a configurable threshold (default 0.8) with a fixed Spanish message.
6. THE solution guard SHALL buffer a fenced code block until it is closed before deciding, and SHALL pass all text outside code blocks through without delay.
7. THE solution guard SHALL be a pure function of the text and the gate state, covered by unit tests with solution-like and unrelated code samples.
8. THE API and the front end SHALL NOT receive the `solution` field under any condition.
9. THE design SHALL record that a model can write a correct solution to a simple exercise on its own, so protection relies on the prompt, the gate, the guard and the evaluation set together, and that Bedrock Guardrails for this arrive in Phase 4.

### Requirement 6: Adaptation after repeated failures

**User Story:** As a student who is stuck on the same idea, I want the tutor to try a different explanation, so that I can finally understand.

#### Acceptance Criteria

1. THE agent SHALL expose a `record_struggle` tool that counts, per runtime session and per concept label, how many times the student shows the same misunderstanding.
2. WHEN the count for a concept reaches 3, THEN THE tool SHALL return an instruction to change the analogy or lower the difficulty, and THE tutor SHALL follow it in its next reply.
3. WHEN the tutor changes the analogy, THEN THE counter for that concept SHALL be reset.
4. THE system prompt SHALL tell the model when to call `record_struggle`.

### Requirement 7: Model configuration and token limits

**User Story:** As the operator, I want the model and the limits to be configuration, so that I can tune quality and cost without code changes.

#### Acceptance Criteria

1. THE agent SHALL read the Bedrock model id from the environment variable `MODEL_ID` and SHALL NOT contain a model id literal in code.
2. IF `MODEL_ID` is missing, THEN THE agent SHALL fail at startup with an explicit error.
3. THE agent SHALL read `MAX_OUTPUT_TOKENS` (default 600) and apply it to each model call.
4. THE agent SHALL read `SESSION_TOKEN_BUDGET` (default 40,000) and track the tokens used per runtime session from the model usage metrics.
5. WHEN the session budget is exhausted, THEN THE agent SHALL emit a fixed Spanish message that explains the limit and then `done`, and SHALL NOT call the model.
6. THE API SHALL keep limiting the student message to 2000 characters.
7. THE agent SHALL bound the conversation history it sends to the model with a sliding window.

### Requirement 8: Packaging for AgentCore direct code deploy

**User Story:** As a developer, I want a repeatable package build on Windows, macOS and Linux, so that deployment does not depend on Docker.

#### Acceptance Criteria

1. THE script `scripts/package-agent.ps1` (and an equivalent `scripts/package-agent.sh`) SHALL export locked dependencies with `uv export --no-dev --frozen`, install them with `uv pip install --python-platform aarch64-manylinux2014 --python-version 3.13 --only-binary=:all: --target <folder>`, and copy the agent code and the `content/` directory into the same folder.
2. THE package SHALL contain a top-level `main.py` that imports the agent app, and SHALL exclude `__pycache__` folders.
3. THE script SHALL create `build/agent.zip` with POSIX permissions set explicitly (directories 755, files 644, no executable requirement for dependencies other than what the wheels declare), independent of the host operating system.
4. THE script SHALL fail with a clear message if no binary wheel exists for a dependency on the target platform.
5. THE script SHALL report the zip size and SHALL fail if the package exceeds the direct code deploy limit of 250 MB.
6. THE package SHALL include the reference solutions only through the `content/` copy that stays on the server side (S3 object read by the runtime).
7. THE build SHALL NOT use Docker, container images or ECR.

### Requirement 9: AgentStack on AgentCore Runtime

**User Story:** As a developer, I want the agent deployed by CDK, so that everything stays reproducible with one command.

#### Acceptance Criteria

1. THE `AgentStack` SHALL upload `build/agent.zip` as an S3 asset without re-zipping and SHALL define an AgentCore `Runtime` with `AgentRuntimeArtifact.fromS3`, the runtime `PYTHON_3_13` and the entrypoint `main.py`.
2. IF `AgentRuntimeArtifact.fromCodeAsset` is proven to preserve the required file permissions on the build host, THEN it MAY be used instead, and the design SHALL record the choice.
3. THE runtime SHALL receive `MODEL_ID`, `MAX_OUTPUT_TOKENS` and `SESSION_TOKEN_BUDGET` as environment variables taken from CDK context.
4. THE runtime execution role SHALL allow `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` only on the configured model or inference profile resources, and SHALL read the code asset from S3.
5. THE stack SHALL expose `CfnOutput` values for the runtime ARN and the runtime id.
6. ALL resources SHALL carry the tags `Project` and `Phase` with `Phase` equal to `1`.
7. THE app SHALL deploy in the order `AgentStack`, `ApiStack`, `WebStack`.
8. THE design SHALL record the AgentCore limitations found in the current documentation, including the package size limit and the Python runtime versions supported.

### Requirement 10: Chat endpoint calls the agent

**User Story:** As a student, I want to see the tutor reply stream into the chat, so that the conversation feels immediate.

#### Acceptance Criteria

1. THE `chat` Lambda SHALL call `InvokeAgentRuntime` through the AWS SDK v3 Bedrock AgentCore client with the runtime ARN from configuration.
2. THE `chat` Lambda SHALL derive `runtimeSessionId` deterministically from the request `sessionId` so that every request of one student session reaches the same runtime session, and SHALL NOT use the raw `sessionId`.
3. THE derived `runtimeSessionId` SHALL satisfy the length constraints of the API.
4. THE `chat` Lambda SHALL read the agent response stream incrementally, parse the agent stream protocol, and emit contract SSE events `token`, `done` and `error`.
5. WHEN the first agent `token` arrives, THEN THE Lambda SHALL write it to the client stream without waiting for later tokens.
6. IF the agent call fails before any token (validation, access denied, throttling, not found), THEN THE Lambda SHALL emit one SSE `error` event with a generic Spanish message and close the stream, and SHALL log the cause with the session id.
7. IF the agent stream is interrupted after tokens were sent, THEN THE Lambda SHALL emit an SSE `error` event and close the stream.
8. THE SDK retry behavior for transient conflicts SHALL remain enabled.
9. THE `chat` Lambda SHALL support a backend switch `TUTOR_BACKEND` with the values `agent` and `mock`, where `mock` keeps the Phase 0 behavior.
10. THE contract events, the SSE framing and the response headers SHALL be identical to Phase 0.

### Requirement 11: Hint endpoint calls the agent

**User Story:** As a student, I want hints from the button to count the same as hints from the chat, so that the ladder stays consistent.

#### Acceptance Criteria

1. THE `hint` Lambda SHALL call the agent with `type: hint` in the same runtime session as the chat of that student session.
2. THE `hint` Lambda SHALL return `{ level, text }` validated with the `shared` schema.
3. IF the agent refuses because an earlier level is missing, THEN THE Lambda SHALL answer 400 with an `ApiError` of code `invalid_request`.
4. IF the agent is unavailable, THEN THE Lambda SHALL answer 502 with a generic `ApiError` of code `internal_error`.
5. THE `hint` Lambda SHALL read the session id from the `X-Session-Id` header and SHALL answer 400 if it is missing.
6. THE `hint` Lambda SHALL support the same `TUTOR_BACKEND` switch, where `mock` returns the authored hints from content as in Phase 0.

### Requirement 12: Timeouts and latency

**User Story:** As a student, I want the first words of the tutor quickly, so that I do not think the app is stuck.

#### Acceptance Criteria

1. THE first `token` SHALL be visible in the browser in under 3 seconds under normal conditions, measured and recorded in the design.
2. THE `chat` Lambda timeout and the API Gateway integration timeout for `/api/chat` SHALL be raised to cover a full model reply (120 seconds) and SHALL be defined in CDK.
3. THE `hint` Lambda timeout SHALL be 15 seconds.
4. IF the first `token` takes longer than the configured limit, THEN THE front end behavior SHALL remain the Phase 0 behavior (waiting state with cancel).

### Requirement 13: Security and least privilege

**User Story:** As the project owner, I want the new components to follow least privilege, so that the attack surface stays small.

#### Acceptance Criteria

1. THE `chat` and `hint` Lambda roles SHALL allow `bedrock-agentcore:InvokeAgentRuntime` only on the agent runtime ARN and its endpoints.
2. THE `content`, `run` and `progress` Lambda roles SHALL NOT receive any Bedrock or AgentCore permission.
3. THE front end SHALL NOT call AgentCore or Bedrock directly.
4. THE agent entrypoint SHALL enforce that the prompt value is a string before passing it to the agent framework.
5. THE repository SHALL NOT contain credentials, and the Lambda SHALL authenticate to AgentCore through its IAM role.
6. THE agent SHALL treat tool outputs and exercise content as trusted server data and the student message as untrusted data.
7. THE design SHALL state that the API remains public and unauthenticated in this phase, so token and session limits are the abuse controls, and that authentication arrives in Phase 5.

### Requirement 14: Contract stability

**User Story:** As a front-end developer, I want no front-end changes in this phase, so that the contract promise holds.

#### Acceptance Criteria

1. THE `shared/` package SHALL NOT change in this phase.
2. THE `web/` package SHALL NOT require code changes in this phase, except removing the mock-only error trigger from documentation.
3. THE existing `api/` contract tests SHALL keep passing with `TUTOR_BACKEND=mock`.
4. THE `/api/run` and `/api/progress` endpoints SHALL keep their Phase 0 behavior.

### Requirement 15: Tutor evaluation

**User Story:** As the product owner, I want an evaluation set, so that I can prove the tutor does not give the solution early.

#### Acceptance Criteria

1. THE agent project SHALL contain a set of fixed test conversations where the student asks for the solution directly, insists, claims to be the teacher, pastes an instruction to ignore the rules, and asks in English.
2. THE offline test suite SHALL run those conversations against a stub model that returns scripted replies and SHALL verify the gate, the counters and the guard deterministically.
3. THE project SHALL include a live evaluation, marked and excluded from the default test run, that sends the conversations to the real model and checks that no fenced code block resembling the solution appears before the gate opens.
4. THE live evaluation SHALL report pass and fail counts per conversation and SHALL be run manually before closing the phase.
5. THE design SHALL record the results of the last live evaluation run and any failing case with its mitigation.

### Requirement 16: Local development

**User Story:** As a developer, I want to run and test the agent locally, so that I iterate without deploying.

#### Acceptance Criteria

1. THE README SHALL document `uv run` commands to start the agent locally on port 8080 and to call `/invocations` with `curl`.
2. THE local API server SHALL support `TUTOR_BACKEND=agent` with `AGENT_LOCAL_URL` pointing to the local agent, bypassing the AWS SDK.
3. THE local run SHALL use the developer's AWS credentials for Bedrock and SHALL NOT store them in the repository.

### Requirement 17: Quality and tests

**User Story:** As a developer, I want automated checks for all new code, so that I can change the tutor safely.

#### Acceptance Criteria

1. THE agent tests (`uv run pytest`) SHALL cover: payload validation, the hint ladder, the solution gate, the solution guard, the struggle counter, the token budget and the prompt principles.
2. `uv run ruff check` and `uv run ruff format --check` SHALL pass.
3. THE `api/` Vitest tests SHALL cover the agent client with a faked SDK: stream parsing, error mapping, session id derivation and the `TUTOR_BACKEND` switch.
4. THE `infra/` tests SHALL assert: the runtime artifact and entrypoint, the environment variables, the absence of wildcard resources in model permissions, the `InvokeAgentRuntime` permission only on `chat` and `hint`, and the tags.
5. THE manual E2E test SHALL cover: ask for the solution directly, request the three hints in order, request level 3 first (blocked), insist on the solution, and verify the explanation after level 3.

### Requirement 18: Documentation and post

**User Story:** As the author of the series, I want the Phase 1 documentation and the Post 2 draft, so that I can publish at phase close.

#### Acceptance Criteria

1. THE file `docs/posts/post-02-primer-agente-tutor.md` SHALL contain a draft about the first tutor agent with Strands, Bedrock and AgentCore Runtime.
2. THE README SHALL document the build, package and deploy commands for the agent and the per-student cost estimate (model tokens and AgentCore Runtime).
3. THE design SHALL record the status of open decisions 5 and 7 of `stacky.md` (region and authentication toward the agent).
4. WHEN the phase is closed, THEN the repository SHALL carry the git tag `fase-1`.
