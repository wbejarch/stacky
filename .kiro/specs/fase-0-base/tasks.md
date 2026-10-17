# Implementation Plan: Phase 0 Base

## Overview

This plan builds the Phase 0 foundation of `tutor-agent`: the npm workspaces monorepo, the `shared/` contract package, the module 3 content, the TypeScript API with mock responses and chat streaming, the Vite + React front end with three zones, and the CDK stacks (`ApiStack`, `WebStack`). Tasks are ordered so that the contract and content come first, then the API, then the front end, then the infrastructure, then deployment checks and documentation.

## Tasks

- [~] 1. Scaffold the monorepo
  - [x] 1.1 Create the root `package.json` with npm workspaces (`shared`, `web`, `api`, `infra`), `.gitignore`, `.editorconfig` and a base `tsconfig.base.json` with `strict: true`
    - Create the empty directories `scripts/` and `docs/posts/` (with `.gitkeep`) and do not create `agent/`
    - _Requirements: 1.1, 1.2, 1.4, 15.1_
  - [x] 1.2 Add a shared ESLint flat config (TypeScript, React hooks rules) and root scripts `lint`, `typecheck` and `test` that run in every workspace
    - _Requirements: 15.1, 15.2_
  - [x] 1.3 Create a README skeleton with the Phase 0 to 5 roadmap and the command list (filled in at task 17)
    - _Requirements: 1.3_

- [x] 2. Build the `shared/` contract package
  - [x] 2.1 Create the `@tutor-agent/shared` package that exports TypeScript source and implement the zod schemas and inferred types for `Module`, `Lesson`, `Exercise`, `ChatRequest`, `ChatStreamEvent`, `HintRequest`, `HintResponse`, `RunRequest`, `RunResult`, `Progress` and `ApiError`
    - `ExerciseSchema` must not contain `solution`, `hints` or `tests`; `ChatRequestSchema` limits `message` to 2000 characters; `RunRequestSchema` limits `code` to 20,000 characters
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 13.3_
  - [x] 2.2 Implement `ExerciseRecordSchema` (on-disk shape, 3-tuple of hints, tests, solution) and expose it only through the subpath `@tutor-agent/shared/content`
    - _Requirements: 2.3, 10.5, 10.6_
  - [x] 2.3 Write Vitest tests for valid and invalid samples of every schema and for the absence of `solution` in the public `Exercise` schema
    - _Requirements: 2.4, 15.3_
  - [x] 2.4 Implement `exerciseIdsFor(module)` in `shared/src/ids.ts`, export it from the package root, and test it with the module 3 example
    - _Requirements: 2.7_

- [x] 3. Author the module 3 content
  - [x] 3.1 Write `content/modulo-03-condicionales/leccion.md` in Spanish (`if/elif/else`, booleans, analogies, small examples); the first `#` heading is the module title
    - _Requirements: 10.1, 10.2_
  - [x] 3.2 Write `ejercicios.json` with `m03-e01` (classify ages), `m03-e02` (sign of a number) and `m03-e03` (letter grade), each with 3 hints, at least 3 tests including a boundary case, and a reference solution
    - _Requirements: 10.1, 10.3, 10.4_
  - [x] 3.3 Write `errores-comunes.md` with typical mistakes (`=` vs `==`, indentation, missing `:`, unreachable `elif`) and how to explain each in simple words
    - _Requirements: 10.1_
  - [x] 3.4 Add a test in `shared/` that validates `ejercicios.json` with `ExerciseRecordSchema`, checks that ids are unique and follow the `exerciseIdsFor` convention, and that every exercise has 3 hints and at least 3 tests
    - _Requirements: 2.8, 10.4, 10.5_

- [x] 4. Implement the API libraries
  - [x] 4.1 Create the `api` workspace (strict `tsconfig`, Vitest, `@types/aws-lambda`, `tsx`) and implement `lib/http.ts` (JSON responses, `ApiError` helper, CORS header helper using `ALLOWED_ORIGINS`), `lib/logger.ts` (JSON logs and `withRequestLogging`) and `lib/validate.ts` (zod parsing with a 64 KB body cap)
    - Logs must include `sessionId`, route, method, status, latency and request id
    - _Requirements: 9.2, 9.3, 9.7, 9.9, 13.1, 13.3, 13.4_
  - [x] 4.2 Implement `lib/content.ts` that imports the module content through esbuild loaders and exposes `listModules`, `getLesson`, `getExerciseRecord` and `toPublicExercise` (field-by-field allowlist)
    - Add a small Vitest plugin and a `*.md` module declaration so tests and type checking handle Markdown imports
    - _Requirements: 4.1, 9.5, 10.6, 10.7_
  - [x] 4.3 Implement `lib/mock-tutor.ts` with the fixed Spanish Socratic reply, the `fragments()` splitter and the configurable token delay
    - _Requirements: 6.6, 6.7_

- [x] 5. Implement the Lambda handlers
  - [x] 5.1 Implement `handlers/content.ts` for `GET /api/modules`, `GET /api/modules/{id}/lesson` and `GET /api/exercises/{id}`, with 404 handling
    - _Requirements: 9.1, 9.4, 9.5, 9.6, 10.7_
  - [x] 5.2 Implement `handlers/hint.ts` for `POST /api/hint` returning `{ level, text }` from the content hints, with 400 and 404 handling
    - _Requirements: 7.4, 7.5, 7.6, 9.1, 9.6_
  - [x] 5.3 Implement `handlers/run.ts` for `POST /api/run` with the simulated rule (starter code fails, any other code passes) and no evaluation of the code
    - _Requirements: 5.5, 5.6, 5.7, 9.1, 9.6_
  - [x] 5.4 Implement `handlers/progress.ts` for `GET /api/progress` with the fixed value
    - _Requirements: 9.1, 9.6, 9.8_
  - [x] 5.5 Implement `handlers/chat.ts` with `awslambda.streamifyResponse` and `HttpResponseStream.from`, SSE framing for `token`, `done` and `error`, 400 handling before the stream opens, and the `__simulate_error__` trigger
    - _Requirements: 6.6, 6.7, 6.8, 6.9, 11.3_
  - [x] 5.6 Write Vitest tests for every handler: contract conformance with the `shared` schemas, 400/404/413 cases, SSE framing, log content, and a recursive check that no response body contains a `solution` key or any solution text
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 15.4_

- [x] 6. Provide a local API server
  - [x] 6.1 Implement `api/src/local/dev-server.ts` (Node `http` adapter to API Gateway proxy events, minimal `awslambda` global for the streaming handler) and the `npm run dev -w api` script on port 3001
    - _Requirements: 1.3, 6.1_

- [x] 7. Scaffold the web application
  - [x] 7.1 Create the Vite + React + TypeScript (strict) app in `web/` with CSS Modules, Vitest + React Testing Library (jsdom), `react-markdown`, `@monaco-editor/react`, and a dev proxy from `/api` to `http://localhost:3001`
    - Add `.env.example` with an empty `VITE_API_URL`
    - _Requirements: 3.3, 8.3, 15.1_
  - [x] 7.2 Add the ESLint rule that forbids `@tutor-agent/shared/content` and direct `fetch` usage outside `src/api/`
    - _Requirements: 8.1, 8.2, 10.6_

- [x] 8. Implement the API client and SSE parser
  - [x] 8.1 Implement `src/api/sse.ts`, a pure parser over `ReadableStream<Uint8Array>` that handles frames split across chunks and multi-line `data:`
    - _Requirements: 6.1, 8.6_
  - [x] 8.2 Implement `src/api/client.ts` with all endpoint functions, `X-Session-Id` from `sessionStorage`, base URL from `VITE_API_URL` with relative fallback, schema validation, a typed `ApiClientError` and `streamChat` with `AbortController`
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [x] 8.3 Write Vitest tests for the parser (split chunks, multi-line data, error event) and the client (URL building, headers, schema failure, cancellation)
    - _Requirements: 8.4, 8.5, 8.6, 15.3_

- [x] 9. Implement state and hooks
  - [x] 9.1 Implement `useExercise` (modules, lesson, exercises through `exerciseIdsFor`, selection, local completed ids, initial load error and retry)
    - _Requirements: 2.8, 3.4, 3.5, 3.6, 4.4, 4.5, 5.8_
  - [x] 9.2 Implement `useRunCode` (running flag, result, error)
    - _Requirements: 5.2, 5.3, 5.4_
  - [x] 9.3 Implement `useChat` (messages, streaming flag, send, cancel, error and retry, hint insertion) and hint progress per exercise
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.2, 7.3_
  - [x] 9.4 Implement `TutorProvider` that composes the hooks through Context
    - _Requirements: 3.1_

- [x] 10. Implement the UI components
  - [x] 10.1 Implement `Header`, `LessonPanel` (Markdown without raw HTML, exercise tabs, statement, difficulty) and the three-zone layout with the below-900-px single-column rule
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4_
  - [x] 10.2 Implement `EditorPanel` with Monaco (Python), the "Ejecutar" button with disabled and progress state, the three hint buttons with ordered enabling, and the keyboard-exit hint text
    - _Requirements: 5.1, 5.2, 5.3, 7.1, 7.2, 7.3, 14.3_
  - [x] 10.3 Implement `ResultsPanel` (per-test status and message, `stdout`, `stderr`, celebration message)
    - _Requirements: 5.4, 5.8_
  - [x] 10.4 Implement `TutorChat` (transcript in `aria-live="polite"`, input, send, cancel, error message with retry)
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 14.2_
  - [x] 10.5 Apply styles with CSS Modules: visible focus outline, 4.5:1 contrast, semantic regions (`main`, `section` with `aria-label`), loading and error states
    - _Requirements: 3.5, 3.6, 14.1, 14.4, 14.5_
  - [x] 10.6 Write React Testing Library tests for hint button ordering, run button disabled while running, results rendering, chat token appending, cancel and error states
    - _Requirements: 15.3_

- [x] 11. Checkpoint: local end-to-end
  - [x] 11.1 Run `typecheck`, `lint` and `test` in `shared`, `api` and `web`, then run the API dev server and the Vite dev server and walk through the manual E2E path (open module, chat, three hints, run, complete, cancel, `__simulate_error__`)
    - Fix any failure before continuing
    - _Requirements: 6.7, 15.1, 15.2, 15.6_

- [x] 12. Implement `ApiStack`
  - [x] 12.1 Create the `infra` workspace (CDK app, `cdk.json` context, local `esbuild` devDependency, Jest + ts-jest) and `bin/app.ts` that applies the `Project` and `Phase` tags and creates the stacks
    - _Requirements: 12.1, 12.7, 12.9, 12.11_
  - [x] 12.2 Implement the five `NodejsFunction` constructs (Node.js 22.x, arm64, ESM bundling with `.md` text loader, root lockfile, per-function role with basic execution only) and the log groups
    - _Requirements: 9.9, 12.3, 12.4_
  - [x] 12.3 Implement the regional `RestApi` with stage `prod`, throttling, JSON access logs, resources and methods under `/api`, request validator with minimal models, and restricted CORS preflight
    - _Requirements: 12.2, 13.1_
  - [x] 12.4 Configure `POST /api/chat` with the `CfnMethod` overrides (`ResponseTransferMode: STREAM`, `.../response-streaming-invocations` URI, explicit integration timeout) while keeping the other methods buffered
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 11.6, 11.7_
  - [x] 12.5 Add `CfnOutput` values for the API URL, API id and function ARNs
    - _Requirements: 12.8_

- [x] 13. Implement `WebStack`
  - [x] 13.1 Create the private encrypted S3 bucket and the CloudFront distribution with OAC, HTTPS redirect and security headers, with no custom error responses
    - _Requirements: 12.5, 12.10, 12.12_
  - [x] 13.2 Add the `/api/*` behavior to the REST API origin (origin path `/prod`, caching disabled, all viewer headers except `Host`, no compression, 60 s read timeout)
    - _Requirements: 12.6_
  - [x] 13.3 Add `BucketDeployment` for `web/dist` (path from context) with invalidation, and `CfnOutput` values for the site URL, distribution id and bucket name
    - _Requirements: 12.5, 12.8_

- [x] 14. Write the CDK tests
  - [x] 14.1 Write Jest assertions for `ApiStack`: runtime `nodejs22.x`, `arm64`, five functions, `ResponseTransferMode: STREAM` only on `/api/chat`, URI suffix, stage throttling, regional endpoint, tags, and absence of any `bedrock` or `bedrock-agentcore` action in IAM policies
    - _Requirements: 11.1, 11.2, 11.7, 12.3, 12.4, 12.7, 15.5_
  - [x] 14.2 Write Jest assertions for `WebStack`: public access blocked, encryption, HTTPS redirect, `/api/*` behavior with caching disabled, no custom error responses, outputs present
    - _Requirements: 12.6, 12.8, 12.10, 15.5_

- [x] 15. Checkpoint: full build
  - [x] 15.1 Run `typecheck`, `lint`, all tests, `npm run build -w web` and `cdk synth`; fix any failure
    - _Requirements: 12.11, 15.1, 15.2_

- [x] 16. Deploy and verify in AWS
  - [x] 16.1 Confirm the region choice and bootstrap the account if needed, then run `cdk deploy ApiStack WebStack`
    - Ask for explicit confirmation before deploying, since this creates billable resources
    - _Requirements: 12.1, 12.11_
  - [x] 16.2 Verify that API Gateway streams `/api/chat` in the chosen region: first `token` arrives in under 1 second and tokens arrive incrementally; if not, apply the Function URL fallback and record it in the design
    - _Requirements: 6.7, 11.1, 11.9_
  - [x] 16.3 Verify that CloudFront passes the SSE stream through the `/api/*` behavior without buffering, from the CloudFront URL in the browser
    - _Requirements: 6.2, 12.6_
  - [x] 16.4 Run the manual E2E path against the deployed site
    - _Requirements: 15.6_

- [~] 17. Documentation, post draft and phase close
  - [x] 17.1 Complete the README (roadmap, commands, local run, deploy, Phase 0 cost estimate for CloudFront, S3, API Gateway and Lambda)
    - _Requirements: 1.3, 16.3_
  - [x] 17.2 Update `tech.md` with the confirmed styling decision (D2) and the `chat` / `hint` split (D1), and record the status of open decisions 2, 4, 4b and 5 in this design
    - _Requirements: 16.4_
  - [x] 17.3 Write `docs/posts/post-01-spec-driven.md` about planning an agent project with Kiro, including the demo URL, front-end description and decisions made
    - _Requirements: 16.1, 16.2_
  - [x] 17.4 Tag the repository `fase-0` after the user approves the final state
    - _Requirements: 1.5_

## Notes

- Tasks 16.1 to 16.4 deploy billable AWS resources and need an explicit user confirmation before they run. They also include manual browser checks that cannot be automated.
- Open decisions D1 (five Lambdas), D2 (CSS Modules) and D5 (`us-east-1`) are confirmed by the user; task 17.2 records them in the steering documents.
- Each task references the requirements it satisfies for traceability.
- Checkpoint tasks 11.1 and 15.1 run the whole build and test suite and fix failures before work continues.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "3.2", "3.3", "4.1"] },
    { "id": 3, "tasks": ["2.3", "3.4", "4.2", "4.3", "7.1", "12.1"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5", "7.2", "8.1", "13.1"] },
    { "id": 5, "tasks": ["5.6", "6.1", "8.2", "12.2", "13.2"] },
    { "id": 6, "tasks": ["8.3", "9.1", "9.2", "9.3", "12.3", "13.3"] },
    { "id": 7, "tasks": ["9.4", "12.4"] },
    { "id": 8, "tasks": ["10.1", "10.2", "10.3", "10.4", "12.5"] },
    { "id": 9, "tasks": ["10.5", "14.1", "14.2"] },
    { "id": 10, "tasks": ["10.6"] },
    { "id": 11, "tasks": ["11.1"] },
    { "id": 12, "tasks": ["15.1"] },
    { "id": 13, "tasks": ["16.1"] },
    { "id": 14, "tasks": ["16.2"] },
    { "id": 15, "tasks": ["16.3"] },
    { "id": 16, "tasks": ["16.4"] },
    { "id": 17, "tasks": ["17.1", "17.2", "17.3"] },
    { "id": 18, "tasks": ["17.4"] }
  ]
}
```
