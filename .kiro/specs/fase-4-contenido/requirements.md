# Requirements Document

## Introduction

This document covers Phase 4 (Content and guardrails) of `tutor-agent`. Phase 4 delivers the full 8-module Python curriculum, loads the lessons into an Amazon Bedrock Knowledge Base so the tutor can ground its explanations in the course material, and adds Amazon Bedrock Guardrails as a service-side safety layer around the model.

Phase scope:
- Authoring of modules 1, 2, 4, 5, 6, 7 and 8 (module 3 exists from Phase 0), with lessons, exercises and common-mistake notes.
- An extension of the server-side exercise schema and of the test harness so that exercises based on `print` and `input()` (modules 1 and 2) and on files (module 7) can be graded.
- A new `ContentStack` with the knowledge base on S3 Vectors, its data source and ingestion, and the guardrails.
- Agent changes: a lesson search tool and guardrail selection per request.
- Front-end work: navigation across 8 modules. The API contract in `shared/` does not change.

Out of scope (later phases): Cognito login, observability dashboards, production network hardening, hidden tests, languages other than Python, advanced OOP.

Exit criterion: in the browser, the student can open any of the 8 modules, complete exercises with real grading, and talk to a tutor that cites course material and stays on topic; solution-seeking and off-topic attempts are handled by several independent layers. The phase ends with the `fase-4` git tag and the draft of Post 5.

Language convention: code, comments and this spec are in English. Course content, UI and tutor text are in Spanish.

## Glossary

- **Public content**: lessons and common-mistake notes. They may be ingested into the knowledge base and may reach the model context.
- **Server-only content**: `ejercicios.json` files with tests, hints and reference solutions. They never go into the knowledge base or to the browser.
- **Knowledge base (KB)**: the Bedrock Knowledge Base that stores embeddings of the public content.
- **Vector store**: Amazon S3 Vectors (vector bucket and vector index) used by the KB.
- **Strict guardrail**: the guardrail used while the solution gate is closed; it includes an output-side topic that blocks complete solution code.
- **Relaxed guardrail**: the guardrail used after the gate opens; it has no solution topic.
- **Program test**: a test that runs the student code as a program with simulated `input()` lines and compares printed output.
- **Function test**: a test that evaluates a call expression and compares its return value (Phase 0 style).

## Requirements

### Requirement 1: Curriculum content

**User Story:** As a student, I want a complete beginner Python course, so that I can learn from first steps to a small project.

#### Acceptance Criteria

1. THE `content/` directory SHALL contain eight module directories named `modulo-NN-<slug>` for the modules: first steps, operators and strings, conditionals, loops, lists and dictionaries, functions, files and errors, and the integrative mini project.
2. EACH module SHALL contain `leccion.md`, `ejercicios.json` and `errores-comunes.md`.
3. EACH lesson SHALL start with a single `#` heading that is the module title, SHALL be written in Spanish with analogies and small examples, and SHALL NOT exceed 1,200 words.
4. MODULES 1 to 7 SHALL contain at least 3 exercises each and module 8 SHALL contain at least 2 exercises, with exercise ids of the form `mNN-eMM` where `NN` is the module number from the directory name.
5. EACH exercise SHALL have 3 hints, at least 3 tests that include a boundary case, a `starterCode`, a `solution`, a difficulty from 1 to 3, and `prerequisites` that reference existing modules with a lower number.
6. THE exercise count of each module SHALL match its `ejercicios.json`, and `GET /api/modules` SHALL list all eight modules in order.
7. EACH `errores-comunes.md` SHALL describe typical mistakes and how to explain each one in simple words, and SHALL NOT contain a complete reference solution of any exercise.
8. THE curriculum SHALL stay within the product scope: no object-oriented design beyond using built-in types, and no third-party packages.
9. EVERY lesson and exercise SHALL be reviewed against a written checklist (accuracy, level, tone, Spanish quality, boundary cases) recorded in the design before the phase closes.

### Requirement 2: Server-side content schema extension

**User Story:** As a content author, I want to express print-based and file-based tests, so that early modules can be graded.

#### Acceptance Criteria

1. THE server-side exercise schema in `shared/` (the server-only subpath) SHALL accept two kinds of tests: function tests with `call` and `expected`, and program tests with `stdin` (list of lines) and `expectedStdout`.
2. A test without a `kind` SHALL be treated as a function test, so the Phase 0 module 3 content stays valid.
3. EITHER kind of test MAY declare `files`, a map from file name to file content that the harness creates before the test.
4. THE schema SHALL reject tests that mix both kinds, empty names, duplicated names inside one exercise, absolute paths or parent directory segments in `files`, and files larger than 4 KB.
5. THE public `Exercise` schema and all other API schemas in `shared/` SHALL NOT change.
6. THE structure document SHALL be updated to describe the extended `ejercicios.json` schema.
7. THE content validation test SHALL check ids, uniqueness, prerequisites, counts and the schema for all eight modules.

### Requirement 3: Harness support for program and file tests

**User Story:** As a student, I want exercises about `print`, `input()` and files to be graded, so that every module has real practice.

#### Acceptance Criteria

1. FOR a program test, THE harness SHALL execute the student code in a fresh namespace with `input()` reading from the test `stdin` lines, SHALL capture standard output, and SHALL compare it with `expectedStdout` after normalizing trailing whitespace and line endings.
2. WHEN a program test asks for more `input()` lines than provided, THEN THE harness SHALL fail that test with a Spanish message that says the program asked for more input than expected.
3. FOR a test with `files`, THE harness SHALL create the files in a fresh temporary directory, SHALL set it as the working directory for that test, and SHALL remove it afterwards.
4. THE Phase 2 limits SHALL apply to each test: 3 seconds, memory limit, output caps and the best-effort network block.
5. THE failure message of a program test SHALL show the expected and the obtained output, truncated to 200 characters each.
6. THE function tests of Phase 2 SHALL behave exactly as before.
7. THE harness tests SHALL cover program tests, missing input, extra output, files, a student program that never reads input, and a student program that prints before failing.
8. THE student code SHALL still never be executed outside the Code Interpreter.

### Requirement 4: Content verification for all modules

**User Story:** As a content author, I want proof that every exercise is solvable and not trivially passing, so that broken exercises never reach students.

#### Acceptance Criteria

1. THE `npm run verify-content` command SHALL cover all eight modules and both test kinds.
2. FOR every exercise, THE command SHALL assert that the reference solution passes all tests and the starter code fails at least one test.
3. THE command SHALL fail with the exercise id and test name for any unexpected exception with the reference solution.
4. THE local harness execution tests SHALL include every reference solution and starter code with a local Python run through `uv run`.
5. THE command SHALL print a per-module summary.

### Requirement 5: Serving the full curriculum

**User Story:** As a student, I want to open any module and its exercises, so that I can follow my own path.

#### Acceptance Criteria

1. THE API SHALL serve modules, lessons and exercises for all eight modules from a generated content index bundled into the Lambdas, and SHALL NOT read content from S3 at request time.
2. THE content index SHALL be generated by a script from the `content/` directory and SHALL be validated by the content validation test in the same run.
3. THE generated index SHALL NOT be committed if it can be produced at build time; WHERE it is committed, a test SHALL fail when it is stale.
4. `GET /api/progress` SHALL report `totalExercises` equal to the total number of exercises across all modules.
5. THE `exerciseIdsFor(module)` helper that `shared/` has provided since Phase 0 SHALL keep deriving the exercise ids from the module id and `exerciseCount` using the `mNN-eMM` convention, the front end SHALL use it, and the content tests SHALL prove that all eight modules follow the convention.
6. THE responses SHALL NOT contain `solution`, `hints`, `tests` or any server-only field, verified by the existing recursive scan extended to all modules.

### Requirement 6: Content bucket and leak prevention

**User Story:** As the product owner, I want proof that reference solutions can never reach the knowledge base, so that the retrieval layer cannot become a leak path.

#### Acceptance Criteria

1. THE `ContentStack` SHALL create a private, encrypted S3 bucket for knowledge base documents and SHALL upload only `leccion.md` and `errores-comunes.md` files, each with a metadata sidecar.
2. THE upload asset SHALL explicitly exclude every `ejercicios.json` file and every other file outside the allowed names.
3. THE data source SHALL use an inclusion prefix limited to the knowledge base documents.
4. THE bucket SHALL block public access, enforce TLS and use encryption at rest.
5. A content lint test SHALL fail when a fenced code block in any public document has a normalized similarity of 0.8 or more to a reference solution, using the same similarity method as the agent solution guard; deliberate exceptions SHALL be listed in an allowlist file with a justification.
6. A content lint test SHALL fail when a public document contains the text of any `solution` field verbatim.
7. THE CDK tests SHALL assert that the deployed asset has no `ejercicios.json` and that the data source inclusion prefix is set.
8. THE design SHALL state that these controls reduce but do not remove the risk, because a lesson example can legitimately resemble a simple solution, and that the solution guard and the guardrails still apply to tutor output.

### Requirement 7: Knowledge base on S3 Vectors

**User Story:** As a developer, I want a low-cost managed vector store, so that retrieval works without running a search cluster.

#### Acceptance Criteria

1. THE `ContentStack` SHALL create an S3 vector bucket and a vector index using the L1 constructs of the S3 Vectors module, with a dimension that matches the embedding model, floating-point vectors and the cosine distance metric.
2. THE `ContentStack` SHALL create the knowledge base with the L1 construct `CfnKnowledgeBase`, vector type, storage type S3 Vectors and a configured embedding model.
3. THE embedding model SHALL be configurable from CDK context and SHALL support Spanish text; the design SHALL record the chosen model, its dimension and its availability in the region.
4. THE data source SHALL use fixed-size chunking with a configured maximum token count and overlap, because hierarchical chunking can exceed the metadata size limits of S3 Vectors.
5. THE index SHALL declare the non-filterable metadata keys required by Bedrock Knowledge Bases, and the custom metadata per document SHALL stay within the documented limits (1 KB and 35 keys).
6. EACH document SHALL carry the metadata `moduleId` and `kind` (`leccion` or `errores`) through a sidecar file.
7. THE knowledge base service role SHALL have only the permissions it needs: read the content bucket, invoke the embedding model, and use the vector bucket and index.
8. THE stack SHALL expose `CfnOutput` values for the knowledge base id and ARN, the data source id, and the vector bucket name.
9. THE design SHALL record the limitations found: semantic search only, no hybrid search, metadata size limits, and the data deletion policy of the data source.

### Requirement 8: Ingestion

**User Story:** As a content author, I want lesson changes to reach the knowledge base automatically, so that I do not run manual steps after every deploy.

#### Acceptance Criteria

1. WHEN the content asset hash changes, THEN THE deployment SHALL start an ingestion job for the data source through a custom resource.
2. THE repository SHALL provide a script that starts an ingestion job manually and waits for its completion, printing the job statistics.
3. THE verification task SHALL confirm that the job completed with no failed documents and that the number of indexed documents equals the number of uploaded public documents.
4. THE custom resource SHALL have only the permission to start and read ingestion jobs for this data source.
5. THE design SHALL record that the custom resource does not wait for job completion and how completion is checked.

### Requirement 9: Lesson search tool

**User Story:** As a student, I want the tutor to explain with the course's own material, so that explanations match what I read.

#### Acceptance Criteria

1. THE agent SHALL expose a tool `search_lessons(query, module_id?)` that calls the Bedrock Agent Runtime `Retrieve` API on the knowledge base and returns up to 3 chunks with their module id and kind.
2. WHERE `module_id` is provided or the current exercise is known, THE tool SHALL filter by that module and its prerequisite modules; otherwise it SHALL search all modules.
3. THE tool SHALL truncate each chunk to 800 characters and the whole result to 2000 characters.
4. THE tool result SHALL be wrapped in a delimiter that labels it as course material, and the system prompt SHALL tell the tutor to prefer it for explanations, to name the module or section the student can review, and not to invent course content that is not in the result.
5. THE agent SHALL time-box the call to 3 seconds and, on failure or an empty result, SHALL return a short note and keep working without it.
6. IF `KNOWLEDGE_BASE_ID` is not configured, THEN THE tool SHALL be disabled and SHALL return a short unavailable message.
7. THE agent SHALL no longer inject the full `errores-comunes.md` text into the prompt; common-mistake notes SHALL be reachable through the search tool.
8. THE agent package SHALL NOT include lessons or common-mistake files, only the server-only exercise records.
9. THE tool results SHALL pass through the solution guard like any other tutor output when the tutor quotes them.

### Requirement 10: Guardrails resources

**User Story:** As the product owner, I want a managed safety layer, so that abusive, off-topic and solution-leaking outputs are blocked independently of the prompt.

#### Acceptance Criteria

1. THE `ContentStack` SHALL create two guardrails with `CfnGuardrail` and a version for each with `CfnGuardrailVersion`: a strict one and a relaxed one.
2. BOTH guardrails SHALL include content filters for hate, insults, sexual content, violence and misconduct on input and output, and a prompt attack filter on input.
3. BOTH guardrails SHALL include a denied topic for requests and answers unrelated to learning programming (for example politics, medical, legal or financial advice, and unrelated personal topics), with a Spanish blocked message that redirects the student to Python.
4. BOTH guardrails SHALL include a managed profanity word filter and sensitive-information filters for email addresses, phone numbers, physical addresses and cloud credentials.
5. THE strict guardrail SHALL additionally include a denied topic that covers a complete, ready-to-submit solution for a course exercise, enabled on the output side only, so that student requests for a solution reach the tutor and receive a Socratic answer.
6. THE relaxed guardrail SHALL NOT include the solution topic.
7. THE blocked messages SHALL be in Spanish and short, and the output-side solution message SHALL invite the student to continue with the next hint.
8. THE design SHALL record the guardrail tier chosen, its language support for Spanish, and any cross-region profile it requires.
9. THE guardrail versions and ids SHALL be exposed as outputs and passed to the agent runtime as environment variables.
10. ALL resources SHALL carry the tags `Project` and `Phase` with `Phase` equal to `4`.

### Requirement 11: Guardrails in the agent

**User Story:** As a student, I want normal questions to flow without friction while unsafe ones are handled gracefully.

#### Acceptance Criteria

1. THE agent SHALL attach the guardrail to the Bedrock model calls through the model configuration, selecting the strict version while the solution gate for the current exercise is closed and the relaxed version when it is open.
2. THE guardrail stream processing mode SHALL be synchronous, because asynchronous mode can deliver content before it is scanned, and the design SHALL record the latency cost.
3. WHEN a guardrail intervenes, THEN THE agent SHALL deliver the configured blocked message as tutor text, SHALL log the intervention type and the guardrail version without content, and SHALL keep the conversation usable.
4. THE text written to AgentCore Memory SHALL be the text actually delivered to the client, including blocked messages.
5. THE agent SHALL keep the guardrail trace enabled and SHALL log counts of interventions per policy type.
6. IF the guardrail configuration is missing, THEN THE agent SHALL log a warning and run without it, and the solution guard SHALL remain active.
7. THE prompt-attack detection requirement on tagged input SHALL be verified, and the design SHALL record how the student message is marked for the guardrail and any limitation found.
8. THE agent runtime role SHALL be allowed to use the two guardrails and no others.

### Requirement 12: Layered solution protection

**User Story:** As the product owner, I want several independent layers against early solutions, so that no single failure leaks the answer.

#### Acceptance Criteria

1. THE protection layers SHALL be: the solution kept out of the model context, the deterministic gate, the prompt, the strict guardrail output topic, and the heuristic solution guard on code blocks.
2. THE evaluation set SHALL measure, for the Phase 1 to Phase 3 solution-seeking conversations, how many replies are stopped by each layer.
3. THE design SHALL record the results and any conversation where a solution-like block reached the client.
4. IF a conversation reaches the client with a complete solution before the gate opens, THEN THE phase SHALL NOT close until the cause is fixed or the residual risk is documented and accepted by the user.
5. THE layers SHALL be independent: disabling any one of them in a test SHALL not disable the others.

### Requirement 13: Guardrail and retrieval evaluation

**User Story:** As the product owner, I want measured behavior, so that I know the guardrails help without annoying students.

#### Acceptance Criteria

1. THE repository SHALL contain an evaluation set of at least 30 legitimate beginner questions in Spanish (including words such as "kill", "attack" or "loop infinito" used in a programming sense) and the live evaluation SHALL report how many were blocked.
2. THE target for blocked legitimate questions SHALL be zero, and each blocked case SHALL be recorded with the policy that fired and the mitigation.
3. THE set SHALL include off-topic, abusive, prompt-injection, personal-data and solution-seeking messages, and the live evaluation SHALL report how many were handled by a guardrail, by the tutor, or not handled.
4. THE retrieval evaluation SHALL contain at least 20 questions with the expected module, and SHALL report the share where the expected module is in the top 3 results.
5. THE results SHALL be recorded in the design, and the tuning performed (denied topic definitions, filter strengths, chunking) SHALL be described.
6. THE live evaluations SHALL be run manually with the developer's credentials and SHALL be excluded from the default test run.

### Requirement 14: Front-end navigation across modules

**User Story:** As a student, I want to choose a module and an exercise easily, so that I can move through the course.

#### Acceptance Criteria

1. THE front end SHALL show a module selector that lists the eight modules from `GET /api/modules` and is operable with the keyboard.
2. WHEN a module is selected, THEN THE front end SHALL load its lesson and the exercises derived with `exerciseIdsFor`, and SHALL select the first exercise that is not completed, or the first exercise if all are completed.
3. THE `ProgressPanel` SHALL show the overall count and a per-module count, with text and not only color to show state.
4. THE front end SHALL remember the last selected module and exercise in `sessionStorage` and restore them on reload.
5. THE front end SHALL keep rendering lessons without raw HTML, and SHALL NOT contain any server-only content field.
6. THE editor and results panel SHALL handle program tests: the results panel shows the test name, status and message exactly as for function tests.
7. THE contract and the Phase 3 progress behavior SHALL stay unchanged.

### Requirement 15: Least privilege and ordering

**User Story:** As the project owner, I want each component to hold only the permissions it needs.

#### Acceptance Criteria

1. THE agent runtime role SHALL allow `bedrock:Retrieve` on the knowledge base ARN only and `bedrock:ApplyGuardrail` on the two guardrail ARNs only.
2. THE agent runtime role SHALL keep the model invocation permissions of Phase 1 and SHALL include guardrail usage permissions required by the model call.
3. NO Lambda role SHALL receive knowledge base or guardrail permissions.
4. THE custom resource role SHALL be limited to ingestion job actions on the data source.
5. THE deployment order SHALL be `ContentStack`, `AgentStack`, `ApiStack`, `WebStack`, and `AgentStack` SHALL receive the knowledge base id and the guardrail identifiers as props.
6. THE configuration keys `embeddingModelId`, `embeddingDimension`, `chunkMaxTokens`, `chunkOverlapPercent` and `guardrailTier` SHALL come from CDK context.
7. THE environment variables for the runtime SHALL be `KNOWLEDGE_BASE_ID`, `GUARDRAIL_STRICT_ID`, `GUARDRAIL_STRICT_VERSION`, `GUARDRAIL_RELAXED_ID` and `GUARDRAIL_RELAXED_VERSION`.

### Requirement 16: Performance

**User Story:** As a student, I want fast answers even with retrieval and guardrails enabled.

#### Acceptance Criteria

1. THE time to first token SHALL remain under 3 seconds in normal conditions with synchronous guardrails and retrieval enabled, measured over 10 requests and recorded in the design.
2. THE knowledge base retrieval latency SHALL be measured (cold and warm) and recorded.
3. IF the target is missed, THEN THE design SHALL record the breakdown and the chosen mitigation, such as a narrower guardrail configuration or fewer retrieval calls.
4. THE lesson search SHALL run only when the model decides to call the tool, and THE agent SHALL limit it to 2 calls per chat turn.

### Requirement 17: Quality and tests

**User Story:** As a developer, I want automated checks for content, tools and infrastructure, so that regressions are caught early.

#### Acceptance Criteria

1. THE `shared/` tests SHALL cover the extended schema (valid and invalid cases) and the `exerciseIdsFor` helper.
2. THE content tests SHALL validate all modules and run the leak lints.
3. THE `api/` tests SHALL cover the generated index, the extended harness (with local Python through `uv run`), the all-modules scan for server-only fields, and the totals in `/api/progress`.
4. THE agent tests SHALL cover: the lesson search tool with a fake client (filters, truncation, time limit, disabled mode, call cap), guardrail selection by gate state, intervention handling and logging, the solution guard after retrieval, and the removal of the full common-mistakes injection.
5. THE `infra/` tests SHALL assert: the knowledge base type and storage, the vector index settings, the data source prefix and chunking, the absence of `ejercicios.json` in the content asset, the guardrail policies, the output-only solution topic in the strict guardrail only, the scoped permissions, the stack order and the tags.
6. THE `web/` tests SHALL cover the module selector, restoration of the selection, per-module progress and keyboard operation.
7. THE manual E2E test SHALL cover: open each module, complete an exercise of each kind (function, program, file), ask the tutor about a topic from a lesson, ask an off-topic question, ask for the solution directly, and change module while a reply is streaming.

### Requirement 18: Documentation and post

**User Story:** As the author of the series, I want the Phase 4 documentation and the Post 5 draft, so that I can publish at phase close.

#### Acceptance Criteria

1. THE file `docs/posts/post-05-rag-y-guardrails.md` SHALL contain a draft about RAG and guardrails for a trustworthy tutor, including the leak-prevention design and the measured evaluation results.
2. THE README SHALL document how to author content, run the lints and verification, ingest the knowledge base, and the per-student cost estimate of retrieval and guardrails.
3. THE design SHALL record the status of decisions D21 to D26 and the review checklist results.
4. WHEN the phase is closed, THEN the repository SHALL carry the git tag `fase-4`.
