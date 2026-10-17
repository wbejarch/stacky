# Requirements Document

## Introduction

This document covers Phase 3 (Memory and progress) of `tutor-agent`. Phase 3 makes the tutor remember the student across sessions and makes progress durable. It adds Amazon Bedrock AgentCore Memory for pedagogical memory (concepts the student understood or struggled with, learning preferences, session summaries), a small DynamoDB table for deterministic data (completed exercises, hint ladder state), and a progress panel in the front end.

Phase scope:
- An anonymous, persistent learner identity generated in the browser, because login arrives in Phase 5.
- `GET /api/progress` returns real data. `POST /api/run` records attempts and completions.
- The agent persists its hint ladder state, writes conversation turns to AgentCore Memory, and retrieves long-term memory to personalize its replies.
- A progress panel in the front end. This phase includes front-end work.

Design stance recorded here and justified in the design: deterministic facts (what the student completed, how many hints were used) are stored in DynamoDB; fuzzy, language-derived knowledge (concepts, preferences, summaries) is stored in AgentCore Memory. This answers open decision 3 of `stacky.md` with the "both" option and is marked for confirmation.

Out of scope (later phases): Knowledge Base and Guardrails (Phase 4), Cognito login, merging anonymous data into an account, observability dashboards, data export and deletion tooling (Phase 5), changes to the `Progress` schema.

Exit criterion: in the browser, the student completes an exercise, closes the tab, opens the site again and sees the progress; the tutor greets them with context from the previous session and keeps the same hint ladder state. The phase ends with the `fase-3` git tag and the draft of Post 4.

Language convention: code, comments and this spec are in English. Text shown to the student (UI and tutor) is in Spanish.

## Glossary

- **Learner id**: random identifier generated in the browser and stored in `localStorage`; it acts as an anonymous bearer identity.
- **Actor id**: the server-side identifier derived from the learner id by hashing; it is the only identity that reaches the database and AgentCore Memory.
- **Progress item**: a DynamoDB item that records attempts and completion of one exercise.
- **Tutor state item**: a DynamoDB item that stores the hint ladder, solution reveal flag and struggle counters of one exercise.
- **Short-term memory**: raw events stored by AgentCore Memory with an expiry.
- **Long-term memory**: records extracted asynchronously by memory strategies from events.
- **Memory block**: the delimited text section injected into the model context with retrieved long-term records.

## Requirements

### Requirement 1: Anonymous learner identity

**User Story:** As a student, I want my progress to follow me when I come back, so that I do not start from zero each time.

#### Acceptance Criteria

1. WHEN the front end starts and no learner id exists in `localStorage`, THEN THE client SHALL generate one with `crypto.randomUUID()` and store it.
2. THE client SHALL send the learner id in the header `X-Learner-Id` on every request, together with `X-Session-Id`.
3. THE API SHALL validate `X-Learner-Id` as a UUID and SHALL answer 400 with an `ApiError` of code `invalid_request` when it is present but malformed.
4. THE API SHALL derive the actor id as `learner-` followed by the first 32 hexadecimal characters of the SHA-256 of the learner id, and SHALL use only the actor id in DynamoDB keys, AgentCore Memory and logs.
5. THE API SHALL NOT log or store the raw learner id.
6. THE headers `X-Learner-Id` SHALL be added to the CORS allowed headers.
7. WHERE the header is absent on `/api/chat`, `/api/hint` and `/api/run`, THE API SHALL keep the Phase 2 behavior without persistence.
8. WHERE the header is absent on `/api/progress`, THE API SHALL answer 400 with an `ApiError` of code `invalid_request`.
9. THE design SHALL state that the learner id is an unauthenticated bearer value, that possession of the value grants access to that learner's data, and that Phase 5 replaces it with Cognito identity.

### Requirement 2: Durable progress storage

**User Story:** As a student, I want completed exercises to be saved, so that my progress is reliable.

#### Acceptance Criteria

1. THE `AgentStack` SHALL define a DynamoDB table with on-demand capacity, a string partition key `pk`, a string sort key `sk`, a `ttl` attribute with time-to-live enabled, and AWS-owned or AWS-managed encryption at rest.
2. THE table SHALL store progress items with `pk = LEARNER#<actorId>` and `sk = PROGRESS#<exerciseId>`.
3. WHEN a run finishes with an interpreter result and an actor id is present, THEN THE `run` Lambda SHALL update the progress item of that exercise: increment `attempts`, set `lastRunAt`, and IF all tests passed, set `completedAt` only when it is not already set.
4. THE update SHALL be a single conditional or expression-based `UpdateItem` so that concurrent runs cannot lose a completion.
5. THE progress item SHALL refresh its `ttl` to 365 days after each write.
6. IF the write fails after the SDK retries, THEN THE `run` Lambda SHALL log the failure with the actor id and SHALL still return the `RunResult`.
7. THE `run` Lambda SHALL NOT write progress for the `mock` run backend.
8. THE table SHALL carry the tags `Project` and `Phase` with `Phase` equal to `3`.
9. THE design SHALL record the removal policy used for the POC and the production alternative (retain plus point-in-time recovery) for Phase 5.

### Requirement 3: Real `/api/progress`

**User Story:** As a student, I want to see how many exercises I have completed, so that I know where I am.

#### Acceptance Criteria

1. WHEN `GET /api/progress` is called with a valid learner id, THEN THE `progress` Lambda SHALL query the progress items of that actor and return `completedExerciseIds` containing the ids whose `completedAt` is set.
2. THE `totalExercises` value SHALL equal the number of exercises available in the server content.
3. THE response SHALL be validated with the unchanged `ProgressSchema` from `shared/`.
4. THE ids in `completedExerciseIds` SHALL be sorted in a stable order (module order, then exercise order).
5. IF an item references an exercise that no longer exists in the content, THEN THE Lambda SHALL ignore it.
6. THE `progress` Lambda SHALL have read-only access to the table.
7. THE Lambda SHALL support a `PROGRESS_BACKEND` switch with the values `dynamodb` and `memory`, where `memory` keeps data in process for tests and local development.

### Requirement 4: Persistent tutor state

**User Story:** As a student, I want the tutor to remember how many hints I already used, so that the hint ladder is consistent across sessions.

#### Acceptance Criteria

1. THE agent SHALL store, per actor and exercise, a tutor state item with `sk = TUTOR#<exerciseId>` containing `hintsUsed`, `solutionRevealed`, the struggle counters and `updatedAt`.
2. WHEN the agent receives the first request for an actor and exercise in a runtime session, THEN IT SHALL load the tutor state item, if any, before applying the hint ladder or the solution gate.
3. WHEN `hintsUsed` or `solutionRevealed` changes, THEN THE agent SHALL persist it with a monotonic condition so that a lower `hintsUsed` never overwrites a higher one.
4. THE solution gate and the hint ladder of Phase 1 SHALL behave identically with the persisted state as with the in-process state.
5. WHEN a student requests a hint level whose predecessor was used in an earlier session, THEN THE agent SHALL return it without requiring the earlier levels again.
6. IF the state store is unreachable, THEN THE agent SHALL fall back to the in-process state for that request, SHALL log the failure, and SHALL NOT open the solution gate on the strength of missing data.
7. THE agent SHALL use a `StateStore` interface with an in-memory implementation (tests and local development) and a DynamoDB implementation.
8. THE agent SHALL use the in-memory implementation when no actor id is provided.

### Requirement 5: AgentCore Memory resource

**User Story:** As a developer, I want the memory defined as code with explicit strategies and retention, so that behavior and cost are predictable.

#### Acceptance Criteria

1. THE `AgentStack` SHALL define the memory with the L1 construct `CfnMemory`, because no L2 construct is available.
2. THE memory SHALL set `eventExpiryDuration` to a configured number of days (default 90, maximum 365) taken from CDK context.
3. THE memory SHALL define three built-in strategies: semantic (concept facts), user preference (learning preferences) and summary (session summaries).
4. EACH strategy SHALL use a namespace template that starts with `/learners/{actorId}/` and ends with a slash, and the summary template SHALL include `{sessionId}`.
5. EACH strategy SHALL set a record expiry of at least 31 days (default 180) when the construct exposes the property; otherwise THE design SHALL record the limitation.
6. THE memory name SHALL satisfy the service naming pattern and SHALL derive from the project name.
7. THE stack SHALL expose `CfnOutput` values for the memory id and ARN, and the runtime SHALL receive `MEMORY_ID` as an environment variable.
8. THE memory SHALL carry the tags `Project` and `Phase`.
9. THE design SHALL record which strategies were enabled, the reason for each, and the observed extraction delay.

### Requirement 6: Writing memory events

**User Story:** As a student, I want the tutor to learn from our conversation, so that next time it knows what I understood.

#### Acceptance Criteria

1. WHEN a chat turn completes and an actor id and `MEMORY_ID` are present, THEN THE agent SHALL create one memory event containing the student message with role `USER` and the tutor reply with role `ASSISTANT`.
2. THE event SHALL use the actor id as `actorId` and the derived runtime session id as `sessionId`.
3. THE assistant text written to memory SHALL be the text that was sent to the client after the solution guard, and SHALL NOT be the raw model output.
4. THE agent SHALL NOT write tool outputs, the reference solution, hint texts returned by tools, or run record contents to memory events.
5. WHEN a run passes all tests, THEN THE agent SHALL write one short event stating which exercise was completed, using the role that the API designates for non-conversational notes.
6. THE agent SHALL await the event write for at most 2 seconds before emitting `done`, and SHALL log and ignore failures and timeouts.
7. THE agent SHALL truncate each text to 4000 characters before writing.
8. IF `MEMORY_ID` is not configured, THEN THE agent SHALL skip memory writes without error.
9. THE agent SHALL NOT use the SDK Strands session manager that stores raw messages automatically, and the design SHALL record this decision and its reason.

### Requirement 7: Retrieving long-term memory

**User Story:** As a student, I want the tutor to adapt to what it already knows about me, so that explanations fit my level.

#### Acceptance Criteria

1. WHEN the first chat request of a runtime session arrives, or the exercise changes, THEN THE agent SHALL retrieve long-term records for the actor from the facts, preferences and summaries namespaces.
2. THE three retrievals SHALL run in parallel with an overall time limit of 1.5 seconds, and THE agent SHALL continue without memory when the limit expires or a call fails.
3. THE retrieval SHALL use the current student message or the exercise title as the search query and a small result count (default 5 for facts, 3 for preferences, 2 for summaries).
4. THE agent SHALL cache the retrieved records for the runtime session and exercise and SHALL NOT retrieve again on every turn.
5. THE agent SHALL render the records inside a memory block with the delimiter `<memoria_del_alumno untrusted="true">` and a size limit of 2000 characters.
6. THE agent SHALL log the number of records retrieved per namespace and SHALL NOT log their content at info level.
7. IF no records exist (new student), THEN THE agent SHALL omit the memory block.

### Requirement 8: Memory safety and poisoning resistance

**User Story:** As the product owner, I want memory to be unable to override the pedagogical rules, so that a student cannot teach the tutor to give away answers.

#### Acceptance Criteria

1. THE system prompt SHALL state that the memory block is unverified data derived from past conversations and SHALL NOT change the hint ladder, the solution gate or any other rule.
2. THE hint ladder and the solution gate SHALL depend only on the deterministic tutor state and never on memory content.
3. WHEN the memory block and the deterministic state disagree (for example memory says the student finished the hints), THEN THE prompt SHALL tell the model to trust the deterministic state block.
4. THE solution guard SHALL keep applying to every tutor reply regardless of the memory content.
5. THE evaluation set SHALL add conversations where the student asks the tutor to remember that they are the teacher or that all hints were already used, followed by a new session whose memory block contains that claim.
6. THE live evaluation SHALL be re-run before closing the phase and its results SHALL be recorded in the design.
7. THE system prompt SHALL tell the tutor not to ask for, repeat or store personal data such as full names, emails or phone numbers.

### Requirement 9: Returning-student behavior

**User Story:** As a returning student, I want a warm and relevant welcome, so that I feel the tutor knows me.

#### Acceptance Criteria

1. WHEN the memory block contains a previous session summary and this is the first reply of the runtime session, THEN THE tutor SHALL briefly mention what was worked on before and ask how the student wants to continue.
2. WHEN the memory block contains concepts the student struggled with that are related to the current exercise, THEN THE tutor SHALL prefer an analogy or approach different from the one recorded as unsuccessful.
3. WHEN the memory block contains learning preferences, THEN THE tutor SHALL apply them to tone and example style without mentioning the memory mechanism.
4. THE tutor SHALL NOT claim to remember anything that is not in the memory block or the deterministic state.

### Requirement 10: Progress panel in the front end

**User Story:** As a student, I want to see my progress at a glance, so that I stay motivated.

#### Acceptance Criteria

1. THE front end SHALL show a `ProgressPanel` with the text "X de Y ejercicios completados", a progress bar and a list of the exercises with their completion state.
2. THE progress bar SHALL expose `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax` and an accessible name.
3. WHEN the application loads, THEN a `useProgress` hook SHALL fetch `/api/progress` through `client.ts`.
4. WHEN a run returns `passed: true`, THEN THE hook SHALL refetch the progress.
5. THE server progress SHALL replace the Phase 0 local completion state; IF the progress request fails, THEN THE UI SHALL fall back to the local state and SHALL show a non-blocking notice.
6. THE `client.ts` module SHALL be the only place that reads or writes the learner id.
7. THE panel SHALL show a short Spanish privacy note explaining that progress is stored with an anonymous identifier.
8. THE panel SHALL offer a "Empezar de cero" action with a confirmation that generates a new learner id and reloads the progress; the old server data SHALL be left to expire.
9. THE panel SHALL be keyboard operable and meet a 4.5:1 text contrast.
10. THE `Progress` data model in `shared/` SHALL NOT change; the panel SHALL show only deterministic data.

### Requirement 11: Least privilege and configuration

**User Story:** As the project owner, I want each component to hold only the data permissions it needs.

#### Acceptance Criteria

1. THE `run` Lambda role SHALL allow `dynamodb:UpdateItem` on the table only.
2. THE `progress` Lambda role SHALL allow `dynamodb:Query` on the table only.
3. THE agent runtime role SHALL allow `dynamodb:GetItem`, `dynamodb:Query` and `dynamodb:UpdateItem` on the table, and `bedrock-agentcore:CreateEvent` and `bedrock-agentcore:RetrieveMemoryRecords` on the memory resource.
4. WHERE the service supports namespace condition keys, THE retrieval permission SHALL be restricted to the `/learners/` namespace hierarchy.
5. THE `content`, `chat` and `hint` Lambda roles SHALL NOT receive table permissions.
6. NO function SHALL have wildcard actions on DynamoDB or AgentCore Memory.
7. THE configuration SHALL come from CDK context: `memoryEventExpiryDays`, `memoryRecordExpiryDays`, `learnerDataTtlDays`.
8. THE environment variables SHALL be `TABLE_NAME`, `PROGRESS_BACKEND` for the Lambdas, and `TABLE_NAME`, `MEMORY_ID` for the agent runtime.

### Requirement 12: Privacy and retention

**User Story:** As the operator, I want clear data retention, so that I do not keep student data forever by accident.

#### Acceptance Criteria

1. THE raw events SHALL expire after the configured number of days and THE long-term records SHALL expire after the configured record expiry.
2. THE DynamoDB items SHALL expire through the `ttl` attribute after the configured number of days from the last write.
3. THE design SHALL list every place where student-derived data is stored (DynamoDB, AgentCore Memory events, long-term records, CloudWatch logs) with its retention.
4. THE application SHALL NOT ask for names, emails or other personal data.
5. THE design SHALL state that deletion on request for an anonymous learner is manual in this phase (delete by actor id in DynamoDB and memory records), and that tooling is planned for Phase 5.
6. THE logs SHALL NOT contain student messages at info level, learner ids, or memory contents.

### Requirement 13: Contract stability

**User Story:** As a front-end developer, I want the contract unchanged, so that the stability promise holds.

#### Acceptance Criteria

1. THE zod schemas in `shared/` SHALL NOT change in this phase.
2. THE new request header `X-Learner-Id` SHALL be additive and optional for every endpoint except `/api/progress`.
3. THE Phase 0 to Phase 2 API tests SHALL keep passing with the memory and progress backends set to `memory` and no learner id.
4. THE `/api/chat` SSE events, `/api/hint` and `/api/run` response shapes SHALL stay identical.

### Requirement 14: Performance

**User Story:** As a student, I want the tutor to answer quickly even with memory enabled.

#### Acceptance Criteria

1. THE time to first token SHALL remain under 3 seconds under normal conditions with memory retrieval enabled, measured over 10 requests from the browser and recorded in the design.
2. THE memory retrieval SHALL NOT delay the first token by more than 1.5 seconds.
3. THE memory write SHALL NOT delay any `token` event and SHALL delay `done` by at most 2 seconds.
4. THE `/api/progress` response time SHALL be under 500 milliseconds at the median, measured and recorded in the design.

### Requirement 15: Local development

**User Story:** As a developer, I want to work without cloud resources when possible, so that iteration stays fast.

#### Acceptance Criteria

1. THE agent SHALL run locally with the in-memory state store and no memory when `MEMORY_ID` and `TABLE_NAME` are unset.
2. THE local API server SHALL use `PROGRESS_BACKEND=memory` by default.
3. THE README SHALL document how to run locally against the real table and memory with developer credentials.
4. THE local runs SHALL NOT require Docker.

### Requirement 16: Quality and tests

**User Story:** As a developer, I want automated checks for the new behavior, so that regressions are caught early.

#### Acceptance Criteria

1. THE `api/` Vitest tests SHALL cover: learner id validation and actor id derivation, progress update expression behavior with a faked client (increment, first completion, no overwrite of `completedAt`), `/api/progress` ordering and filtering, absence of the header, and failure tolerance of the run path.
2. THE agent tests SHALL cover: state load and persist with a fake store, monotonic updates, fallback on store failure, memory write contents (guarded text only, no tool output), write timeout, retrieval time limit and caching, memory block rendering and truncation, absence of the block for new students.
3. THE `web/` tests SHALL cover: learner id creation and reuse, header on every request, `useProgress` fetch and refetch, `ProgressPanel` states and accessibility attributes, the reset action, and the fallback notice.
4. THE `infra/` tests SHALL assert: the table keys, billing mode, TTL attribute, the memory strategies and namespaces, expiry settings, scoped permissions per role, environment variables and tags.
5. THE manual E2E test SHALL cover: complete an exercise, reload, see the progress; use two hints, close the tab, open again and continue the ladder; start over; a second session greeting based on the previous summary; a memory poisoning attempt.

### Requirement 17: Documentation and post

**User Story:** As the author of the series, I want the Phase 3 documentation and the Post 4 draft, so that I can publish at phase close.

#### Acceptance Criteria

1. THE file `docs/posts/post-04-agente-que-recuerda.md` SHALL contain a draft about an agent that remembers, explaining the split between DynamoDB and AgentCore Memory.
2. THE README SHALL document the new environment variables, the table schema and the per-student cost estimate of memory and storage.
3. THE design SHALL record the status of open decision 3 of `stacky.md` and decisions D15 to D20.
4. WHEN the phase is closed, THEN the repository SHALL carry the git tag `fase-3`.
