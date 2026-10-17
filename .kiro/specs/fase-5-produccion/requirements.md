# Requirements Document

## Introduction

This document covers Phase 5 (Production) of `tutor-agent`. Phase 5 turns the working demo into something that can be exposed to real users and operated: Amazon Cognito login with an authorizer in API Gateway, per-user usage quotas, observability for the whole request path including AgentCore, alarms and budgets, a custom `.dev` domain with a certificate, tighter edge security, and the data protection tasks that earlier phases deferred.

Phase scope:
- New `AuthStack` (Cognito user pool, app client, hosted login domain, certificate and domain wiring) and new `OpsStack` (dashboard, alarms, notifications, budget).
- Authentication in the front end and authorization in the API, with the Cognito identity replacing the anonymous learner id on protected endpoints.
- Per-user daily quotas for messages, runs and model tokens, enforced server side.
- AgentCore Observability and end-to-end trace propagation.
- Optional AWS WAF behind a context flag, justified by cost.
- Retention, backups and a data deletion procedure.
- A time-boxed evaluation of the Code Interpreter VPC mode.
- A single-command deployment and a verification of the five POC success criteria.

Out of scope: payments, teacher dashboard, certificates, social login, multi-region deployment, automatic scaling to many users, other languages.

Exit criterion: the application runs at the `.dev` domain, a new user can sign up, log in and complete a module with the tutor; usage is limited per user; the team receives alarms and a budget alert; and the repository carries the `fase-5` tag with the final post draft.

Language convention: code, comments and this spec are in English. Text shown to the student (UI and tutor) is in Spanish.

## Glossary

- **Account actor id**: the server-side identifier derived from the Cognito `sub` claim by hashing, prefixed `acct-`.
- **Protected endpoint**: an API method that requires a valid Cognito token (`chat`, `hint`, `run`, `progress`).
- **Public endpoint**: a method that serves course content without a token (`modules`, `lesson`, `exercise`).
- **Daily quota**: a per-account, per-UTC-day limit stored in DynamoDB.
- **Kill switch**: a deploy-time flag that makes the costly endpoints answer with a maintenance response.
- **EMF**: CloudWatch Embedded Metric Format, structured log lines that become custom metrics.
- **Transaction Search**: the CloudWatch feature that indexes spans, required by AgentCore Observability.

## Requirements

### Requirement 1: Cognito user pool and app client

**User Story:** As a student, I want to create an account and log in, so that my progress and memory belong to me.

#### Acceptance Criteria

1. THE `AuthStack` SHALL create a Cognito user pool where users sign in with their email address, verify it by email code, and recover their password by email.
2. THE user pool SHALL enforce a password policy of at least 10 characters with mixed character classes, and SHALL keep Cognito built-in protection against repeated failed sign-ins.
3. THE self sign-up flag SHALL come from CDK context (`selfSignUpEnabled`, default true); WHEN it is false, THEN only administrators SHALL be able to create users.
4. THE stack SHALL create a public app client without a secret that uses the authorization code grant with PKCE, with the scopes `openid`, `email` and `profile`, and with refresh tokens enabled.
5. THE token validity SHALL be configurable from context with defaults of 60 minutes for ID and access tokens and 30 days for refresh tokens.
6. THE callback and logout URLs SHALL be derived from the configured domain plus `http://localhost:5173/` for development.
7. THE login pages SHALL be served by Cognito (managed login or hosted UI) on a Cognito domain, and the design SHALL record the feature plan required by the chosen login experience.
8. THE user pool SHALL have deletion protection or a retain removal policy outside development, and the stack SHALL expose `CfnOutput` values for the pool id, the client id and the login domain.
9. ALL resources SHALL carry the tags `Project` and `Phase` with `Phase` equal to `5`.
10. THE design SHALL record that no user-pool secrets exist, and that the app client is public by design.

### Requirement 2: API authorization

**User Story:** As the operator, I want only logged-in users to reach the costly endpoints, so that cost and abuse are bounded.

#### Acceptance Criteria

1. THE `ApiStack` SHALL attach a Cognito user pool authorizer to `POST /api/chat`, `POST /api/hint`, `POST /api/run` and `GET /api/progress`.
2. THE methods `GET /api/modules`, `GET /api/modules/{id}/lesson` and `GET /api/exercises/{id}` SHALL stay public.
3. THE CORS preflight `OPTIONS` methods SHALL NOT require authorization.
4. THE API SHALL define gateway responses for 401, 403 and 429 with the same JSON error shape and the CORS headers used by the Lambdas.
5. THE streaming configuration of `/api/chat` SHALL keep working with the authorizer, and THE design SHALL record the verification result.
6. THE Lambdas SHALL read the account identity only from the authorizer claims provided by API Gateway and SHALL NOT parse or trust the `Authorization` header themselves.
7. THE CloudFront `/api/*` behavior SHALL forward the `Authorization` header to the API.
8. IF a request reaches a protected Lambda without authorizer claims, THEN THE Lambda SHALL answer 401 with an `ApiError`.
9. THE local development server SHALL offer a development identity switch that is rejected unless an explicit local-only variable is set, and a test SHALL prove the deployed handlers ignore that switch.

### Requirement 3: Identity propagation and session binding

**User Story:** As the product owner, I want every stored record tied to the authenticated account, so that one user can never read or hijack another user's state.

#### Acceptance Criteria

1. THE API SHALL derive the account actor id as `acct-` followed by the first 32 hexadecimal characters of the SHA-256 of the Cognito `sub`.
2. THE API SHALL use the account actor id for DynamoDB keys, AgentCore Memory actor ids, agent payloads and logs, and SHALL ignore `X-Learner-Id` on protected endpoints.
3. THE API SHALL derive `runtimeSessionId` from the actor id and the client session id together, so that knowing another user's client session id gives no access to their runtime session.
4. THE API SHALL NOT forward the JWT to the agent or to any other service and SHALL NOT log tokens.
5. THE agent SHALL accept an actor id only from IAM-authenticated invocations, and the runtime SHALL be invocable only by the `chat`, `hint` and `run` Lambda roles.
6. THE design SHALL record open decision 7 of `stacky.md`: IAM from the Lambda role is used toward the agent, and AgentCore Identity with inbound JWT authorization was considered and rejected for this POC, with the reasons.
7. THE design SHALL record that anonymous learner data created in earlier phases is not migrated (decision D27) and what a migration would require.

### Requirement 4: Front-end authentication

**User Story:** As a student, I want a simple login flow, so that I can start learning quickly.

#### Acceptance Criteria

1. THE front end SHALL use the authorization code flow with PKCE against the Cognito login domain through a maintained OpenID Connect client library with a pinned version.
2. THE `client.ts` module SHALL be the only module that reads tokens and attaches `Authorization: Bearer <token>` to protected requests.
3. THE front end SHALL load its auth configuration (login domain, client id, region) from a runtime `config.json` served by the site, and SHALL NOT embed environment-specific values in the build.
4. WHILE the user is not logged in, THE front end SHALL show the lessons, exercises and editor in read-only mode and SHALL show a Spanish prompt to log in in place of the chat, hints, run and progress features.
5. WHEN the user logs in, THEN THE front end SHALL return to the page they were on, SHALL remove the authorization code from the address bar, and SHALL load progress.
6. THE header SHALL show the user's email address and a "Cerrar sesión" action that ends the Cognito session.
7. IF the API answers 401, THEN THE front end SHALL try a silent token renewal once and, if it fails, SHALL ask the user to log in again without losing the editor content.
8. THE front end SHALL keep tokens in `sessionStorage` or memory according to the library configuration and the design SHALL record the choice and the XSS trade-off.
9. THE Phase 3 anonymous learner id code and the "Empezar de cero" action SHALL be removed from the protected flows.
10. THE login and logout controls SHALL be keyboard operable, labeled and meet 4.5:1 contrast.
11. THE front end SHALL show a clear Spanish message when the daily quota is exhausted and when the service is in maintenance.

### Requirement 5: Usage quotas

**User Story:** As the operator, I want per-user daily limits, so that one account cannot create unbounded cost.

#### Acceptance Criteria

1. THE API SHALL enforce, per account actor id and UTC day, configurable limits for chat messages (default 150), code runs (default 300) and hint requests (default 100).
2. THE agent SHALL enforce, per account actor id and UTC day, a configurable limit of model tokens (default 150,000), reading and updating a usage item in DynamoDB with an atomic increment.
3. THE per-session token budget from Phase 1 SHALL remain as an additional limit.
4. WHEN a limit is exceeded, THEN THE API SHALL answer 429 with an `ApiError` of code `rate_limited`, a Spanish message that states which limit was reached, and a `Retry-After` header with the seconds until the next UTC day.
5. WHEN the token quota is exceeded inside the agent, THEN THE chat SHALL emit the Spanish quota message as tutor text followed by `done`, without calling the model.
6. THE usage items SHALL expire through the `ttl` attribute after 3 days.
7. THE limit checks SHALL use conditional updates so that concurrent requests cannot exceed a limit by more than the number of in-flight requests.
8. THE quota values SHALL come from CDK context and be passed as environment variables.
9. THE `ApiError` schema in `shared/` SHALL gain the additive codes `unauthorized`, `rate_limited` and `unavailable`, and the front end SHALL handle them; no other schema SHALL change.
10. A failure of the usage store SHALL fail closed for protected costly endpoints with a 503 `unavailable` response, and SHALL be logged and alarmed.

### Requirement 6: Kill switch

**User Story:** As the operator, I want a fast way to stop costly traffic during an incident or a cost spike.

#### Acceptance Criteria

1. THE CDK context flag `tutorEnabled` (default true) SHALL set an environment variable on the `chat`, `hint` and `run` Lambdas.
2. WHILE `tutorEnabled` is false, THE `chat`, `hint` and `run` handlers SHALL answer 503 with an `ApiError` of code `unavailable` and a Spanish maintenance message, without calling the agent or the interpreter.
3. THE public content endpoints and `progress` SHALL keep working while the switch is off.
4. THE README SHALL document how to use the switch and how long a redeploy takes.

### Requirement 7: AgentCore Observability and tracing

**User Story:** As the operator, I want to see what happened inside a conversation, so that I can debug quality and latency problems.

#### Acceptance Criteria

1. THE agent SHALL be instrumented with the AWS OpenTelemetry distribution declared in `pyproject.toml`, and THE runtime entrypoint SHALL start through the instrumentation command.
2. THE design SHALL record whether CloudWatch Transaction Search can be enabled through CDK; IF it cannot, THEN the README SHALL document the one-time manual step.
3. THE `chat`, `hint` and `run` Lambdas SHALL propagate the trace context to `InvokeAgentRuntime` through the trace headers the API supports.
4. THE Lambdas SHALL have active tracing enabled.
5. THE agent spans and logs SHALL carry the runtime session id and the account actor id hash, and SHALL NOT carry student messages, code or tokens.
6. THE design SHALL record a worked example trace from the browser request to the model call, with the measured time per stage.
7. THE log groups created by CDK SHALL have an explicit retention period, and THE design SHALL record the retention of the log group that the AgentCore Runtime manages.

### Requirement 8: Metrics

**User Story:** As the operator, I want product and safety metrics, so that I can see how the tutor behaves, not only if it is up.

#### Acceptance Criteria

1. THE Lambdas and the agent SHALL emit custom metrics through EMF in one namespace for: run outcomes (passed, failed, timeout, error), hint levels served, solution reveals, guardrail interventions by policy type, solution guard replacements, memory failures, retrieval failures, quota rejections by type and tokens used.
2. THE metric dimensions SHALL NOT include user ids, session ids or any content, to keep cardinality and privacy under control.
3. THE agent SHALL emit tokens used per reply as a metric and as a field in the structured log line.
4. THE metric emission SHALL NOT delay the response and SHALL fail silently.

### Requirement 9: Dashboard, alarms and notifications

**User Story:** As the operator, I want alarms that reach me, so that I learn about problems before users do.

#### Acceptance Criteria

1. THE `OpsStack` SHALL create an SNS topic with an email subscription taken from the context value `alarmEmail`.
2. THE `OpsStack` SHALL create a CloudWatch dashboard with widgets for: API requests, 4XX and 5XX, latency, chat time to first byte, Lambda errors and duration per function, AgentCore Runtime invocations, errors, throttles and latency, Bedrock token counts, DynamoDB throttles, and the custom metrics of requirement 8.
3. THE `OpsStack` SHALL create alarms for: API 5XX rate, `chat` Lambda errors, `run` Lambda p95 duration near its timeout, AgentCore Runtime errors or throttles, Bedrock daily token count above a configured threshold, DynamoDB throttled requests, guardrail interventions spike, usage store failures, and quota rejections spike.
4. EACH alarm SHALL notify the SNS topic and SHALL have a description that names the likely cause and the first check.
5. THE alarm thresholds SHALL come from CDK context with defaults chosen for a small POC.
6. THE `OpsStack` SHALL depend on the other stacks only through names and ARNs.
7. THE steering document `tech.md` SHALL be updated to list `OpsStack` among the stacks (decision D34).

### Requirement 10: Budgets and cost allocation

**User Story:** As the project owner, I want to know and cap what the project costs, so that the POC cannot surprise me.

#### Acceptance Criteria

1. THE `OpsStack` SHALL create an AWS Budgets monthly cost budget, filtered by the `Project` tag when cost allocation tags are active, with notifications at 50%, 80% and 100% of actual cost and 100% of forecast, sent to the same email.
2. THE budget amount SHALL come from CDK context.
3. THE README SHALL document the one-time activation of the `Project` and `Phase` cost allocation tags in the billing console.
4. THE design SHALL record the real monthly cost observed after the load test, per service, and the resulting cost per active student, replacing the estimates of earlier phases.
5. THE design SHALL record the cost of the optional components (WAF, VPC mode network resources, extra log retention) so that they can be enabled with informed consent.

### Requirement 11: Domain, certificate and edge security

**User Story:** As a user, I want to reach the site on a clean, secure address.

#### Acceptance Criteria

1. THE `AuthStack` SHALL look up the Route 53 hosted zone given by the context values `domainName` and `hostedZoneName` and SHALL create a DNS-validated ACM certificate in the region CloudFront requires.
2. THE `WebStack` SHALL attach the domain name and certificate to the CloudFront distribution and SHALL create the DNS alias records for IPv4 and IPv6.
3. IF no domain is configured, THEN THE stacks SHALL still synthesize and deploy using the default CloudFront domain, and the login SHALL work only for the localhost callback; the design SHALL record this limitation.
4. THE domain registration itself SHALL be a documented manual step outside CDK.
5. THE site SHALL send a Content Security Policy that allows only its own origin, the Cognito login domain for connections, and the worker sources the editor needs, together with HSTS, `X-Content-Type-Options`, a frame denial and a strict referrer policy.
6. THE Monaco editor SHALL be bundled with the application and SHALL NOT load code from a third-party CDN.
7. THE `config.json` file SHALL be generated at deploy time from stack outputs and SHALL contain no secrets.
8. THE design SHALL record that `.dev` domains are served over HTTPS only because the top-level domain is on browser HSTS preload lists.
9. THE CORS configuration SHALL be reduced to the production origin plus the localhost origin only when the development flag is set.

### Requirement 12: Optional WAF

**User Story:** As the operator, I want WAF available but not forced, so that the cost is a conscious choice.

#### Acceptance Criteria

1. THE `WebStack` SHALL create a CloudFront-scope web ACL only when the context flag `enableWaf` is true (default false).
2. THE web ACL SHALL contain a rate-based rule per client IP with a configurable limit and, optionally, one AWS managed rule group chosen in the design.
3. THE web ACL SHALL log blocked requests counts as metrics and SHALL be covered by an alarm.
4. THE CloudFront-scope web ACL SHALL be created in the region the service requires, and the design SHALL record how this fits the chosen deployment region.
5. THE README SHALL document the monthly cost of the web ACL, its rules and its request charges, and the reasons for the default.
6. THE CDK tests SHALL cover both flag values.

### Requirement 13: Data protection, retention and deletion

**User Story:** As a user, I want my data handled responsibly, and as the operator I want to be able to delete it.

#### Acceptance Criteria

1. THE DynamoDB table SHALL use the `RETAIN` removal policy and point-in-time recovery outside development, controlled by a context flag.
2. THE removal policies of the web and KB document buckets MAY stay `DESTROY`, and the design SHALL list which resources are retained and which are not.
3. THE repository SHALL provide a script `scripts/delete-account-data.ts` that, given an account actor id or a Cognito email, deletes the DynamoDB items of that actor, the AgentCore Memory records and events under that actor's namespaces, and optionally the Cognito user.
4. THE script SHALL require an explicit confirmation flag and SHALL print what it deleted.
5. THE design SHALL update the retention table of Phase 3 with the final values, including the usage items and the log groups.
6. THE README SHALL document the privacy statement shown to users and the deletion procedure, including that deletion is performed by the operator on request in this phase and that self-service deletion is a future improvement (decision D28).
7. THE application SHALL NOT collect any personal data beyond the email address held by Cognito.

### Requirement 14: Code Interpreter hardening evaluation

**User Story:** As the product owner, I want to know whether the sandbox can be tightened, so that the residual risk stated in Phase 2 is reduced if the cost is acceptable.

#### Acceptance Criteria

1. THE team SHALL run a time-boxed evaluation of a second code interpreter in VPC network mode, placed in isolated subnets with a security group without outbound rules and without NAT.
2. THE evaluation SHALL test that the harness still runs, SHALL measure the session start latency and the cost of the network resources, and SHALL attempt outbound HTTP, DNS and S3 access from a test snippet and record the results.
3. THE design SHALL record the decision (adopt, or accept the Phase 2 residual risk) with the evidence.
4. IF adopted, THEN THE `AgentStack` SHALL switch the interpreter network mode through a context flag, and THE Phase 2 tests SHALL be updated accordingly.
5. THE evaluation resources SHALL be removed after the test unless adopted.

### Requirement 15: Single-command deployment

**User Story:** As the author of the series, I want one command that deploys everything, so that readers can reproduce the project.

#### Acceptance Criteria

1. THE repository SHALL provide `npm run deploy` that prepares content, builds the front end, builds the agent package, builds the KB documents, synthesizes, and runs `cdk deploy --all` with the context from `cdk.json` and optional overrides.
2. THE command SHALL work on Windows PowerShell and on Linux or macOS shells.
3. THE command SHALL stop before deploying when any build, test or `cdk synth` step fails.
4. THE command SHALL print the site URL and the main stack outputs at the end.
5. THE README SHALL document prerequisites (AWS credentials, bootstrap, Node.js, uv, model access), the context values, the one-time manual steps, the destroy procedure, and what is retained after destroy.
6. THE deployment SHALL be verified from a clean checkout on a clean machine by following the README only, and the gaps found SHALL be fixed.
7. THE stack order SHALL be `ContentStack`, `AgentStack`, `AuthStack`, `ApiStack`, `WebStack`, `OpsStack`.

### Requirement 16: Contract and compatibility

**User Story:** As a front-end developer, I want the contract change to be minimal and explicit.

#### Acceptance Criteria

1. THE only change in `shared/` SHALL be the additive `ApiError` codes `unauthorized`, `rate_limited` and `unavailable`.
2. THE endpoints, request bodies, response bodies and SSE events SHALL remain as in Phase 4.
3. THE Phase 0 to Phase 4 tests SHALL keep passing using a test identity helper, and THE `RUN_BACKEND`, `TUTOR_BACKEND` and `PROGRESS_BACKEND` switches SHALL keep working for local development.
4. THE design SHALL list every behavior that changed for clients: authentication on four endpoints, the 401, 429 and 503 responses, and the removal of `X-Learner-Id`.

### Requirement 17: Security review

**User Story:** As the project owner, I want a final security pass, so that the exposed system has no obvious gaps.

#### Acceptance Criteria

1. THE team SHALL review every IAM policy in the CDK output and record that no policy has a wildcard action on data services and that every resource ARN is scoped, listing any justified exception.
2. THE team SHALL run dependency audits for the npm workspaces and for the agent (`uv`), and SHALL fix or document every high or critical finding.
3. THE API SHALL return generic error messages and no stack traces on every path, verified by tests.
4. THE repository SHALL be scanned for secrets, and the result SHALL be recorded.
5. THE design SHALL list the remaining known risks with owner and mitigation: Sandbox mode residual egress, public content endpoints, open self sign-up, model behavior, heuristic solution protection, bearer tokens in browser storage.
6. THE CDK tests SHALL assert: authorizers on exactly the four protected methods, no public write method, bucket public access blocks, TLS-only policies, and encryption at rest.

### Requirement 18: Performance and load

**User Story:** As the operator, I want evidence of how the system behaves under light load, so that the cost and limits I set are realistic.

#### Acceptance Criteria

1. THE time to first token SHALL remain under 3 seconds in normal conditions with authentication, memory, retrieval and guardrails enabled, measured over 20 requests.
2. THE team SHALL run a scripted light load test (for example 10 concurrent simulated students for 10 minutes) against a non-production deployment, with pre-created test accounts, and SHALL record error rates, latencies, throttling, quota behavior and the resulting cost.
3. THE load test SHALL NOT run against production without the user's explicit confirmation, because it consumes model tokens.
4. THE results SHALL be recorded in the design and used to confirm or adjust the quotas, throttles and alarm thresholds.

### Requirement 19: Quality and tests

**User Story:** As a developer, I want automated checks for the new surface, so that production changes stay safe.

#### Acceptance Criteria

1. THE `api/` tests SHALL cover: claims extraction, 401 without claims, actor derivation, runtime session derivation including the actor, quota consumption with conditional updates (allowed, exceeded, concurrent), `Retry-After` computation, kill switch, usage store failure behavior, and the local identity switch being ignored in deployed mode.
2. THE agent tests SHALL cover: token quota check and increment, quota message without a model call, metrics emission shape without content, and instrumentation entrypoint presence.
3. THE `web/` tests SHALL cover: login redirect and callback handling, token attachment only through `client.ts`, 401 renewal flow, read-only mode when logged out, logout, quota and maintenance messages.
4. THE `infra/` tests SHALL cover: user pool and client settings, authorizer placement, public methods, gateway responses, CloudFront alias and certificate wiring with and without a domain, CSP and security headers, WAF flag both ways, dashboard and alarms with SNS actions, budget notifications, log retention, retained table with point-in-time recovery, stack order and tags.
5. THE manual E2E test SHALL cover: sign up with email verification, log in, complete a module exercise with the tutor, logout, expired session, quota exhaustion, maintenance mode, alarm delivery by email, account data deletion with the script, and a fresh `npm run deploy`.

### Requirement 20: Documentation, final post and POC closure

**User Story:** As the author of the series, I want the final documentation and the Post 6 draft, so that the series can be completed.

#### Acceptance Criteria

1. THE file `docs/posts/post-06-produccion.md` SHALL contain a draft about production, observability and real costs, including the measured numbers and the remaining risks.
2. THE README SHALL contain the architecture overview, the final roadmap status, the operations runbook (deploy, kill switch, alarms, data deletion, destroy) and the final cost table.
3. THE design SHALL contain a checklist that verifies each success criterion of the POC with evidence: a full module with the tutor, no early solution, isolated execution, memory across sessions, and deployment with CDK.
4. THE design SHALL record the status of every open decision of `stacky.md` and of decisions D27 to D34.
5. THE steering documents SHALL be updated to match the final structure and stacks.
6. WHEN the phase is closed, THEN the repository SHALL carry the git tag `fase-5`.
