# tutor-agent

> Working name. Final name TBD (candidates: CodIA, Pythia, Hintly).

A web application where a student learns beginner Python with a tutor agent. The student reads the lesson, writes code in an editor, runs tests and chats with a Socratic tutor that gives progressive hints instead of the answer. The project is also the base for a series of posts on AWS Builder Center (DevTools category). UI and tutor text are in Spanish; code and documentation are in English.

> Status: Phase 0 (base) is implemented and deployed. The tutor, the test runner and the progress endpoint return mock data; see [Known limitations](#known-limitations).

## Roadmap

One spec per phase in `.kiro/specs/`, one git tag per phase, one post draft per phase in `docs/posts/`. A phase is done when it can be tested in the browser.

| Phase | Name | Scope | Git tag | Status |
|---|---|---|---|---|
| 0 | Base | Vite + React front end, TypeScript API with mock responses, minimal CDK (S3 + CloudFront, API Gateway + Lambdas) | `fase-0` | Implemented, pending tag |
| 1 | Real tutor | Strands agent (Python) on Amazon Bedrock AgentCore Runtime | `fase-1` | Planned |
| 2 | Code execution | AgentCore Code Interpreter as the isolated sandbox | `fase-2` | Planned |
| 3 | Memory and progress | AgentCore Memory, progress across sessions | `fase-3` | Planned |
| 4 | Content and guardrails | Knowledge Base for content, guardrails | `fase-4` | Planned |
| 5 | Production | Cognito login, observability, costs and `.dev` domain | `fase-5` | Planned |

The API contract (`shared/`) is stable across phases: the front end does not change when the backend moves from mock to the real agent.

## Repository structure

```
tutor-agent/
├── .kiro/          # steering and specs (one spec per phase)
├── shared/         # API contract: zod schemas and TypeScript types (web + api)
├── web/            # Vite + React + TypeScript front end
├── api/            # API Lambdas (TypeScript, Node.js 22)
├── infra/          # AWS CDK in TypeScript (ApiStack, WebStack)
├── content/        # lessons and exercises (Spanish, student-facing)
├── scripts/        # utilities (agent packaging from Phase 1)
├── docs/posts/     # post drafts
├── stacky.md          # POC source document
└── README.md
```

`agent/` (Python 3.13 + uv) is created in Phase 1 and does not exist yet.

The repository is an npm workspaces monorepo with four workspaces: `@tutor-agent/shared`, `@tutor-agent/web`, `@tutor-agent/api` and `@tutor-agent/infra`.

## Prerequisites

- Node.js 22 or later and npm (`engines.node` is `>=22.0.0`).
- For deployment only: an AWS account, AWS credentials configured for the CLI, and permission to create IAM roles, Lambda, API Gateway, S3 and CloudFront resources.

No Docker is needed. Lambda code is bundled with a local `esbuild` (a devDependency of `infra/`).

## Commands

Run these from the repository root unless noted.

| Purpose | Command |
|---|---|
| Install all workspaces | `npm install` |
| Lint (all workspaces) | `npm run lint` |
| Type check (all workspaces) | `npm run typecheck` |
| Tests (all workspaces, including CDK tests) | `npm test` |
| Run the API locally (port 3001) | `npm run dev -w api` |
| Run the front end locally (port 5173) | `npm run dev -w web` |
| Build the front end (type check + Vite build into `web/dist`) | `npm run build -w web` |
| Preview the production build | `npm run preview -w web` |
| Synthesize CloudFormation | `npm run synth -w infra` |
| Run any CDK CLI command | `npm run cdk -w infra -- <command>` |

You can also run the CDK commands from `infra/` with `npx cdk <command>`; `infra/cdk.json` points the app at `bin/app.ts` through `ts-node`.

`cdk synth` and the CDK tests must pass before `cdk deploy`.

## Local run

The front end and the API run as two processes. Open two terminals at the repository root.

1. Install dependencies once:

   ```
   npm install
   ```

2. Terminal 1, start the API dev server on port 3001:

   ```
   npm run dev -w api
   ```

   It is a small Node `http` adapter that runs the real Lambda handlers (including the streaming `chat` handler) behind API Gateway-style events. It is for local development only and is never bundled or deployed. Optional environment variables: `PORT` (default `3001`) and `ALLOWED_ORIGINS` (default `http://localhost:5173`).

3. Terminal 2, start Vite on port 5173:

   ```
   npm run dev -w web
   ```

4. Open `http://localhost:5173`.

Vite proxies `/api` to `http://localhost:3001`, so the browser calls the API on the same origin, like CloudFront does when deployed. Leave `VITE_API_URL` empty (see `web/.env.example`) to use relative `/api` paths. Set it only to call an API at a different base URL, for example `VITE_API_URL=http://localhost:3001` in `web/.env.local`; in that case the origin of the page must be listed in `ALLOWED_ORIGINS` because the request becomes cross-origin.

Manual check of the whole path: open module 3, send a chat message (tokens stream in), use the three hints in order, run the code (the starter code fails, any other code passes), complete an exercise, cancel a streaming reply, and send `__simulate_error__` to see the error state with retry.

## Deploy

Phase 0 deploys two CDK stacks to `us-east-1` (default from `infra/cdk.json`):

- `ApiStack`: regional REST API (stage `prod`) and five Lambda functions (`content`, `chat`, `hint`, `run`, `progress`; Node.js 22.x, arm64). `POST /api/chat` uses API Gateway response streaming.
- `WebStack`: private S3 bucket and a CloudFront distribution (Origin Access Control). The default behavior serves `web/dist`; the `/api/*` behavior forwards to the REST API, so the site and the API share one origin and no CORS is needed.

`WebStack` depends on `ApiStack` and is deployed after it.

Deploying creates billable resources. See the [cost estimate](#phase-0-cost-estimate).

1. Configure AWS credentials for the CLI (profile or environment variables) and confirm the account:

   ```
   aws sts get-caller-identity
   ```

2. Bootstrap the account and region once (skip if already done). Run from `infra/`:

   ```
   npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
   ```

3. Verify everything locally:

   ```
   npm run typecheck
   npm run lint
   npm test
   npm run build -w web
   npm run synth -w infra
   ```

   `build -w web` must run before deploying: `WebStack` uploads the folder set by the `webDistPath` context value (default `../web/dist`, relative to `infra/`).

4. Deploy both stacks. Run from `infra/`:

   ```
   npx cdk deploy ApiStack WebStack
   ```

   CDK asks for confirmation before creating IAM resources. The equivalent from the repository root is `npm run cdk -w infra -- deploy ApiStack WebStack`.

5. Read the stack outputs. `ApiStack` prints `ApiUrl`, `ApiId` and the function ARNs; `WebStack` prints `SiteUrl`, `DistributionId` and `BucketName`. Open `SiteUrl` in the browser. CDK writes outputs to the terminal; `infra/cdk-outputs.json` can be produced with `--outputs-file cdk-outputs.json`.

To redeploy after a front-end change, run `npm run build -w web` and `npx cdk deploy WebStack` (the `BucketDeployment` uploads the files and invalidates CloudFront).

Configuration lives in `infra/cdk.json` under `context`: `projectName`, `phase`, `region`, `allowedOrigins` (CORS origins for direct, cross-origin calls; the deployed site is same-origin) and `webDistPath`. Override a value with `-c key=value`. All resources get the tags `Project` and `Phase`.

To remove everything: `npx cdk destroy WebStack ApiStack` from `infra/`. The site bucket and the log groups use the `DESTROY` removal policy, which is acceptable for a POC and is revisited in Phase 5.

## Phase 0 cost estimate

This is an estimate for a small demo, not a quote. Prices are US East (N. Virginia) list prices as of this writing, taken from the AWS pricing pages for [API Gateway](https://aws.amazon.com/api-gateway/pricing/), [Lambda](https://aws.amazon.com/lambda/pricing/), [CloudFront](https://aws.amazon.com/cloudfront/pricing/), [S3](https://aws.amazon.com/s3/pricing/) and [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/). Check them before relying on the numbers, and use the AWS Pricing Calculator for your own traffic.

### Unit prices used

| Service | Item | Price |
|---|---|---|
| API Gateway REST | API calls (first 333 M per month) | $3.50 per million |
| API Gateway REST | Data transfer out | about $0.09 per GB |
| API Gateway REST | Response streaming | No extra charge beyond calls and data transfer. A streamed response is billed per 10 MB increment, rounded up, with a minimum of 1 billable call. |
| Lambda (arm64) | Requests | $0.20 per million (first 1 M per month free) |
| Lambda (arm64) | Duration | $0.0000133334 per GB-second (first 400,000 GB-s per month free, shared across x86 and arm64) |
| Lambda | Response streaming | $0.008 per GB streamed; the first 6 MB per request are free |
| CloudFront | Data transfer out to the internet | about $0.085 per GB (US and Canada, first 10 TB); 1 TB per month free |
| CloudFront | HTTPS requests | about $0.01 per 10,000; 10 M requests per month free |
| S3 Standard | Storage | about $0.023 per GB-month |
| CloudWatch Logs | Ingestion / storage | about $0.50 per GB ingested, $0.03 per GB-month stored |

The CloudFront free tier is part of the always-free tier. The 1 M free REST API calls per month are a 12-month free tier for eligible accounts; accounts created after July 15, 2025 receive Free Tier credits instead. The estimate below does not count on that allowance.

### Assumptions

- 1,000 student sessions per month.
- About 60 API calls per session (lesson, exercise, runs, hints and chat messages), so 60,000 API calls per month. Of those, about 15,000 are `chat` calls.
- Chat replies are a few hundred bytes (a fixed Spanish reply streamed in fragments), far below the 6 MB free streaming allowance per request and below the first 10 MB billing increment, so each streamed call counts as one call.
- Lambda memory is 256 MB. Average duration is about 50 ms for buffered handlers and about 2 s for `chat` (40 ms token delay between fragments).
- Each session downloads the static site once, about 1 MB. Monaco Editor is loaded from a public CDN and is not part of that traffic or of the S3 bucket.
- Logs: about 120,000 JSON log lines per month across Lambda and API Gateway access logs, roughly 0.1 GB. Retention is one month.
- `BucketDeployment` and the CDK bootstrap bucket add negligible cost.

### Estimated monthly cost

| Service | Calculation | Estimate |
|---|---|---|
| API Gateway REST | 0.06 M calls x $3.50 + under 0.1 GB out | about $0.21 |
| Lambda | 60,000 requests, about 8,000 GB-s in total | $0.00 (inside the free tier); about $0.10 without it |
| CloudFront | about 1 GB out and 120,000 requests | $0.00 (inside the free tier); about $0.20 without it |
| S3 | a few MB stored, a few thousand requests | under $0.01 |
| CloudWatch Logs | 0.1 GB ingested, small storage | about $0.05 |
| Total | | about $0.3 to $0.6 per month |

An idle deployment costs close to nothing: there are no fixed hourly charges in this architecture (no NAT gateway, no WAF, no provisioned concurrency, no API cache, no custom domain). The costs that scale with use are API Gateway calls (the largest line) and, at high traffic, CloudFront data transfer. At 100 times this traffic (100,000 sessions, 6 M calls per month) the dominant item is API Gateway at about $21, with Lambda, CloudFront and logs adding a few dollars, so the order of magnitude is tens of dollars per month.

Later phases add Bedrock model usage, AgentCore Runtime, Code Interpreter and Memory, which will dominate the bill. They are not included here; the cost controls (token limits per message and per session, budget and alarm) arrive in Phase 5.

## Known limitations

These are accepted for Phase 0 and are addressed in later phases.

- **Public, unauthenticated API.** Anyone with the CloudFront URL can call every endpoint. Protections are limited to stage throttling (50 requests per second, burst 100), request validation, a 64 KB body cap and restricted CORS for direct calls. Cognito login arrives in Phase 5. Do not put the demo URL in a place where unexpected traffic could generate cost, and destroy the stacks when you are done.
- **Monaco Editor is loaded from a CDN.** `@monaco-editor/react` fetches Monaco from a public CDN at runtime, so the editor needs internet access from the browser and depends on that CDN's availability. Bundling Monaco locally is a possible later improvement.
- **The tutor is a mock.** `POST /api/chat` streams one fixed Spanish Socratic reply, whatever the student writes. Sending `__simulate_error__` triggers an error event on purpose. The real Strands agent arrives in Phase 1.
- **Code execution is simulated.** `POST /api/run` never evaluates the code: the starter code fails and any other code passes. Real execution in the AgentCore Code Interpreter sandbox arrives in Phase 2. Student code never runs in the Lambdas.
- **Progress is fixed.** `GET /api/progress` returns a constant value and completed exercises are kept only in the browser tab. Persistent progress arrives in Phase 3.
- **One module only.** Only module 3 (conditionals) has content, in Spanish.
- **No custom domain and no alarms.** The site uses the default CloudFront domain; observability, budgets and the `.dev` domain arrive in Phase 5.
- **Reference solutions stay on the server.** They are bundled into the Lambdas for later phases and are never returned by any endpoint or copied to `web/`.
