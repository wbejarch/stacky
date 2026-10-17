# Implementation Plan: Phase 5 Production

## Overview

This plan prepares the application for real users and for operation. It adds Cognito authentication and the API authorizer, per-account quotas and a kill switch, custom metrics and AgentCore observability, the `AuthStack` and `OpsStack`, edge security and the custom domain, data retention and deletion tooling, a Code Interpreter VPC-mode evaluation, a single-command deployment, and the final verification of the POC success criteria.

## Tasks

- [ ] 1. Build the identity foundation
  - [ ] 1.1 Add the additive `ApiError` codes `unauthorized`, `rate_limited` and `unavailable` to `shared/` and update the schema tests
    - _Requirements: 5.9, 16.1_
  - [ ] 1.2 Implement `api/src/lib/identity.ts` (`getAccount` from authorizer claims, `toAccountActorId`, 401 handling), `deriveRuntimeSessionId(actorId, sessionId)`, a test identity helper for Vitest, and the local-only dev identity switch guarded by `LOCAL_DEV`
    - _Requirements: 2.6, 2.8, 2.9, 3.1, 3.3_
  - [ ] 1.3 Apply the identity to `chat`, `hint`, `run` and `progress`: use the account actor id for storage, memory, agent payloads and logs, ignore `X-Learner-Id`, never forward or log the token; update the agent payload validation to accept `acct-` actor ids
    - _Requirements: 3.2, 3.4, 3.5_
  - [ ] 1.4 Write Vitest and pytest tests: claims extraction, 401 without claims, actor derivation, different runtime sessions for different actors with the same client session id, dev identity ignored without `LOCAL_DEV`, generic error bodies
    - _Requirements: 2.8, 2.9, 3.3, 17.3, 19.1_

- [ ] 2. Add quotas and the kill switch
  - [ ] 2.1 Implement `lib/usage-store.ts` with a DynamoDB conditional `consume`, `Retry-After` computation to the next UTC midnight, and an in-memory implementation for tests and local development
    - _Requirements: 5.1, 5.4, 5.6, 5.7_
  - [ ] 2.2 Enforce the chat, run and hint limits in the handlers with 429 `rate_limited` responses, fail closed with 503 `unavailable` on store errors, and read limits from environment variables
    - _Requirements: 5.1, 5.4, 5.8, 5.10_
  - [ ] 2.3 Implement the kill switch: `TUTOR_ENABLED` check first in `chat`, `hint` and `run`, Spanish maintenance message, content and progress unaffected
    - _Requirements: 6.1, 6.2, 6.3_
  - [ ] 2.4 Implement the daily token quota in the agent (read before the model call, quota text and `done` when exceeded, atomic add after the call) and keep the per-session budget
    - _Requirements: 5.2, 5.3, 5.5_
  - [ ] 2.5 Write tests: allowed, exceeded and concurrent consumption with a fake conditional store, `Retry-After`, fail-closed behavior, order of kill switch and quota checks, agent quota message without a model call
    - _Requirements: 5.4, 5.5, 5.7, 5.10, 6.2, 19.1, 19.2_

- [ ] 3. Add custom metrics
  - [ ] 3.1 Implement the EMF helper in TypeScript and in Python (namespace `TutorAgent`, low-cardinality dimensions, silent failure)
    - _Requirements: 8.2, 8.4_
  - [ ] 3.2 Emit the metrics listed in the design from the handlers and the agent (run outcomes, hints, reveals, guardrail interventions, guard replacements, memory and retrieval failures, quota rejections, usage store failures, tokens)
    - _Requirements: 8.1, 8.3_
  - [ ] 3.3 Write tests that check the EMF line shape and that no user, session or content value appears in any dimension or field
    - _Requirements: 8.2, 19.2_

- [ ] 4. Implement `AuthStack`
  - [ ] 4.1 Create the user pool and the public app client with the settings from context (email sign-in and verification, password policy, self sign-up flag, PKCE code grant, scopes, token validity, callback and logout URLs, deletion protection or retain outside development)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.10_
  - [ ] 4.2 Add the Cognito login domain with a prefix derived from the project name and a short hash of the account id; check which feature plan and CDK properties the managed login requires, and record the choice in the design (D31)
    - _Requirements: 1.7_
  - [ ] 4.3 Add the Route 53 hosted zone lookup and the DNS-validated certificate in the region CloudFront requires, handle the case with no domain configured, add outputs and tags
    - _Requirements: 1.9, 11.1, 11.3_
  - [ ] 4.4 Write Jest assertions for user pool and client settings, domain, outputs, tags, and both domain configurations
    - _Requirements: 19.4_

- [ ] 5. Update `ApiStack`
  - [ ] 5.1 Attach the Cognito authorizer to the four protected methods, keep the three content GET methods public and the preflight methods open
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ] 5.2 Add the 401, 403, 429 and 5XX gateway responses with the JSON error shape and CORS headers
    - _Requirements: 2.4_
  - [ ] 5.3 Configure the Lambdas: active tracing, log group retention, quota and kill switch environment variables, table permissions for usage items on `chat`, `hint` and `run`, and removal of the development CORS origin unless the dev flag is set
    - _Requirements: 5.8, 6.1, 7.4, 7.7, 11.9_
  - [ ] 5.4 Make the agent client pass the Lambda trace context (`traceId`, `traceParent`, `traceState`, `baggage`) to `InvokeAgentRuntime`
    - _Requirements: 7.3_
  - [ ] 5.5 Write Jest assertions: authorizer on exactly four methods, public methods, open preflight, gateway responses, tracing, retention, environment variables, scoped permissions, CloudFront forwarding of the `Authorization` header
    - _Requirements: 2.7, 17.6, 19.4_

- [ ] 6. Update `WebStack`
  - [ ] 6.1 Attach the custom domain and certificate to the distribution and create the IPv4 and IPv6 alias records; keep the default CloudFront domain working when no domain is set
    - _Requirements: 11.2, 11.3_
  - [ ] 6.2 Add the response headers policy (CSP, HSTS, content type options, referrer policy, frame denial) to the site and API behaviors
    - _Requirements: 11.5, 11.8_
  - [ ] 6.3 Generate `config.json` from the `AuthStack` outputs with `Source.jsonData`, deploy it with the site, and make sure the `/api/*` behavior forwards the `Authorization` header
    - _Requirements: 2.7, 4.3, 11.7_
  - [ ] 6.4 Implement the optional web ACL behind `enableWaf` (rate-based rule per IP, one managed rule group by context, metrics, alarm hook); confirm how the CloudFront-scope region constraint fits the deployment region and record it
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  - [ ] 6.5 Write Jest assertions: alias and certificate wiring with and without a domain, headers and CSP content, `config.json` asset, WAF present and absent
    - _Requirements: 12.6, 19.4_

- [ ] 7. Add agent observability
  - [ ] 7.1 Add the AWS OpenTelemetry distribution to `pyproject.toml` (pinned), switch the runtime entrypoint to the instrumentation command in `AgentStack`, and keep local runs working without it
    - _Requirements: 7.1_
  - [ ] 7.2 Check whether CloudFormation can enable CloudWatch Transaction Search; implement it if supported, otherwise document the one-time step in the README and record the result in the design
    - _Requirements: 7.2_
  - [ ] 7.3 Set span and log attributes (runtime session id, actor id hash, exercise id, guardrail version, tool names) and make sure no message, code or token is attached
    - _Requirements: 7.5_
  - [ ] 7.4 Write pytest tests for the entrypoint configuration and for attribute sanitization, and a Jest assertion for the runtime entrypoint array
    - _Requirements: 19.2, 19.4_

- [ ] 8. Implement `OpsStack`
  - [ ] 8.1 Create the SNS topic with the email subscription from `alarmEmail` and add the stack to `bin/app.ts` after `WebStack`
    - _Requirements: 9.1, 9.6, 15.7_
  - [ ] 8.2 Create the dashboard; confirm the AgentCore runtime metric namespace and dimensions and record them in the design
    - _Requirements: 9.2_
  - [ ] 8.3 Create the alarms with descriptions and context thresholds; confirm the Bedrock token metric dimension for the configured model or inference profile
    - _Requirements: 9.3, 9.4, 9.5_
  - [ ] 8.4 Create the monthly budget with the four notifications, with the tag filter behind `budgetFilterByTag`; document the manual activation of the cost allocation tags
    - _Requirements: 10.1, 10.2, 10.3_
  - [ ] 8.5 Write Jest assertions: topic and subscription, dashboard widgets, each alarm with an SNS action, budget notifications, tags
    - _Requirements: 19.4_

- [ ] 9. Add authentication to the front end
  - [ ] 9.1 Add `oidc-client-ts` (exact version), the `config.json` loader and `AuthProvider` (PKCE, session storage, silent renew, callback handling with URL cleanup, explicit Cognito logout redirect); verify the logout behavior against the Cognito endpoint and record the result
    - _Requirements: 4.1, 4.3, 4.5, 4.6, 4.8_
  - [ ] 9.2 Update `client.ts`: the only place that reads tokens, `Authorization` header on protected calls, one silent renewal after a 401, typed errors for `unauthorized`, `rate_limited` and `unavailable`
    - _Requirements: 4.2, 4.7_
  - [ ] 9.3 Build the UI: header with email and "Cerrar sesión", `AuthGate` read-only mode, login prompt, quota notice with reset time, maintenance notice; keep the editor content when the session expires; keyboard operable, labeled, 4.5:1 contrast
    - _Requirements: 4.4, 4.6, 4.7, 4.10, 4.11_
  - [ ] 9.4 Remove the anonymous learner id and "Empezar de cero" from protected flows and add the dev identity mode available only under `import.meta.env.DEV`
    - _Requirements: 4.9, 2.9_
  - [ ] 9.5 Bundle the Monaco editor locally with its worker and remove the CDN loading
    - _Requirements: 11.6_
  - [ ] 9.6 Write Vitest + React Testing Library tests: config loading, login redirect, callback cleanup, token attachment only in `client.ts`, 401 renewal, read-only mode, logout URL, quota and maintenance notices, dev mode absent from the production build output, editor loads without network
    - _Requirements: 19.3_

- [ ] 10. Protect and delete data
  - [ ] 10.1 Set the table to `RETAIN` with point-in-time recovery behind `retainData`, set explicit log retention for CDK-created log groups, and list retained and non-retained resources in the design
    - _Requirements: 13.1, 13.2, 7.7_
  - [ ] 10.2 Implement `scripts/delete-account-data.ts` (actor id or email, `--confirm`, optional `--delete-user`) that deletes DynamoDB items, memory records and events, and optionally the Cognito user, printing counts
    - _Requirements: 13.3, 13.4_
  - [ ] 10.3 Test the script logic against fakes (dry run output, confirmation required, counts) and add a Jest assertion for the retained table
    - _Requirements: 13.4, 19.4_

- [ ] 11. Create the single-command deployment
  - [ ] 11.1 Implement `scripts/deploy.mjs` and the `npm run deploy` script: content preparation, optional tests, front-end build, agent package for the current platform, KB documents, synth, `cdk deploy --all` with an outputs file, fail-fast behavior and a final summary of the site URL and outputs
    - _Requirements: 15.1, 15.2, 15.3, 15.4_
  - [ ] 11.2 Set the stack order `ContentStack`, `AgentStack`, `AuthStack`, `ApiStack`, `WebStack`, `OpsStack` and pass the props between stacks
    - _Requirements: 15.7_

- [ ] 12. Checkpoint: build and test everything
  - [ ] 12.1 Run `prepare:content`, `typecheck`, `lint` and `test` for every workspace, `uv run ruff check`, `uv run ruff format --check` and `uv run pytest`, build the agent zip and the front end, and run `cdk synth`; fix any failure
    - _Requirements: 16.3, 19.1, 19.2, 19.3, 19.4_

- [ ] 13. Deploy and verify in AWS
  - [ ] 13.1 Deploy all stacks after explicit user confirmation (billable resources, public exposure and email subscriptions) and confirm the alarm email subscription
    - _Requirements: 9.1, 15.1_
  - [ ] 13.2 Verify that `/api/chat` still streams through CloudFront and API Gateway with the Cognito authorizer, and record the result in the design
    - _Requirements: 2.5_
  - [ ] 13.3 Verify sign-up with email verification, login on the `.dev` domain and on localhost, token renewal, logout, and the read-only mode when logged out
    - _Requirements: 1.1, 4.4, 4.5, 4.6, 4.7_
  - [ ] 13.4 Measure time to first token over 20 requests with authentication, memory, retrieval and guardrails enabled; record the result and mitigate if above 3 seconds
    - _Requirements: 18.1_
  - [ ] 13.5 Capture a worked trace from browser to model call with times per stage, and record the retention of the AgentCore runtime log group
    - _Requirements: 7.6, 7.7_
  - [ ] 13.6 Test the kill switch and record how long the redeploy takes; test quota exhaustion with temporarily low limits
    - _Requirements: 5.4, 6.1, 6.4_
  - [ ] 13.7 Trigger a test alarm and confirm the email arrives; activate the cost allocation tags and the budget tag filter if desired
    - _Requirements: 9.4, 10.3_
  - [ ] 13.8 Run the account data deletion script against a test account and confirm all stores are cleaned
    - _Requirements: 13.3, 13.4_

- [ ] 14. Evaluate the Code Interpreter VPC mode
  - [ ] 14.1 Build the isolated VPC and the VPC-mode interpreter as a temporary stack, run the harness through it, and measure session start latency and the network cost
    - _Requirements: 14.1, 14.2_
  - [ ] 14.2 Attempt outbound HTTP, DNS and S3 access from test snippets in both modes and record the results side by side
    - _Requirements: 14.2_
  - [ ] 14.3 Decide adopt or accept the residual risk with the evidence; if adopted add the `interpreterNetworkMode` flag and update the Phase 2 assertions; remove the temporary resources otherwise
    - _Requirements: 14.3, 14.4, 14.5_

- [ ] 15. Security review and load test
  - [ ] 15.1 Review every synthesized IAM policy for wildcard data actions and unscoped resources and record the result with any justified exception
    - _Requirements: 17.1_
  - [ ] 15.2 Run `npm audit` and the `uv` dependency audit, fix or document every high or critical finding, and scan the repository for secrets
    - _Requirements: 17.2, 17.4_
  - [ ] 15.3 Write the scripted load test (10 simulated students for 10 minutes with pre-created test accounts) and run it on a non-production deployment only after explicit user confirmation, since it consumes model tokens
    - _Requirements: 18.2, 18.3_
  - [ ] 15.4 Record errors, latencies, throttling, quota behavior and cost; adjust quotas, throttles and alarm thresholds from the results
    - _Requirements: 18.4, 9.5_
  - [ ] 15.5 Record the observed monthly cost per service, the cost per active student, and the cost of the optional components (WAF, VPC mode, log retention)
    - _Requirements: 10.4, 10.5, 12.5_
  - [ ] 15.6 Complete the remaining risks list with owner and mitigation
    - _Requirements: 17.5_

- [ ] 16. Verify a clean deployment and the POC criteria
  - [ ] 16.1 Follow only the README on a clean checkout and machine to run `npm run deploy`, and fix every gap found in the README or the scripts
    - _Requirements: 15.5, 15.6_
  - [ ] 16.2 Run the full manual E2E path: sign up, login, a complete module with the tutor, logout, expired session, quota exhaustion, maintenance mode, alarm email, data deletion
    - _Requirements: 19.5_
  - [ ] 16.3 Fill the POC success criteria checklist in the design with evidence for each criterion
    - _Requirements: 20.3_

- [ ] 17. Documentation, final post draft and phase close
  - [ ] 17.1 Complete the README: architecture overview, final roadmap status, operations runbook (deploy, kill switch, alarms, data deletion, destroy and what is retained), privacy statement and the final cost table
    - _Requirements: 13.6, 20.2_
  - [ ] 17.2 Update `tech.md` and `structure.md` with the final stack list including `OpsStack`, the identity rules and the content layout changes
    - _Requirements: 9.7, 20.5_
  - [ ] 17.3 Record the status of every open decision of `stacky.md` and of D27 to D35 in this design
    - _Requirements: 20.4_
  - [ ] 17.4 Write `docs/posts/post-06-produccion.md` about production, observability and real costs, with the measured numbers and the remaining risks
    - _Requirements: 20.1_
  - [ ] 17.5 Tag the repository `fase-5` after the user approves the final state
    - _Requirements: 20.6_

## Notes

- Tasks 13.1 to 13.8, 14.1 to 14.3, 15.3 to 15.5 and 16.1 to 16.3 deploy billable resources, expose the system publicly, send emails or consume model tokens. They need explicit user confirmation, and the load test must not run against production without it.
- Decisions D27 (no migration of anonymous data), D28 (operator deletion script), D29 (additive `ApiError` codes), D30 (WAF off by default), D31 (Cognito managed login on a prefix domain), D32 (runtime `config.json`), D34 (`OpsStack`) and D35 (session storage with a strict CSP) are confirmed by the user; D33 (sandbox network mode) stays open until the evaluation in task 14.
- Task 17.2 updates the steering documents so that `OpsStack` and the final structure are reflected.
- Domain registration, `cdk bootstrap`, Bedrock model access, Transaction Search (if not managed by CDK) and cost allocation tag activation are manual one-time steps documented in the README.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "4.1", "7.1", "8.1", "9.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "4.2", "7.2", "8.2", "9.2"] },
    { "id": 2, "tasks": ["1.3", "2.4", "4.3", "5.1", "8.3", "9.3", "10.1"] },
    { "id": 3, "tasks": ["1.4", "2.2", "4.4", "5.2", "7.3", "8.4", "9.4", "10.2"] },
    { "id": 4, "tasks": ["2.3", "5.3", "7.4", "8.5", "9.5", "10.3"] },
    { "id": 5, "tasks": ["2.5", "3.2", "5.4", "6.1", "9.6"] },
    { "id": 6, "tasks": ["3.3", "5.5", "6.2", "11.2"] },
    { "id": 7, "tasks": ["6.3"] },
    { "id": 8, "tasks": ["6.4"] },
    { "id": 9, "tasks": ["6.5"] },
    { "id": 10, "tasks": ["11.1"] },
    { "id": 11, "tasks": ["12.1"] },
    { "id": 12, "tasks": ["13.1"] },
    { "id": 13, "tasks": ["13.2"] },
    { "id": 14, "tasks": ["13.3"] },
    { "id": 15, "tasks": ["13.4"] },
    { "id": 16, "tasks": ["13.5"] },
    { "id": 17, "tasks": ["13.6"] },
    { "id": 18, "tasks": ["13.7"] },
    { "id": 19, "tasks": ["13.8"] },
    { "id": 20, "tasks": ["14.1"] },
    { "id": 21, "tasks": ["14.2"] },
    { "id": 22, "tasks": ["14.3"] },
    { "id": 23, "tasks": ["15.1"] },
    { "id": 24, "tasks": ["15.2"] },
    { "id": 25, "tasks": ["15.3"] },
    { "id": 26, "tasks": ["15.4"] },
    { "id": 27, "tasks": ["15.5"] },
    { "id": 28, "tasks": ["15.6"] },
    { "id": 29, "tasks": ["16.1"] },
    { "id": 30, "tasks": ["16.2"] },
    { "id": 31, "tasks": ["16.3"] },
    { "id": 32, "tasks": ["17.1", "17.2", "17.3", "17.4"] },
    { "id": 33, "tasks": ["17.5"] }
  ]
}
```
