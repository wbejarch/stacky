# Stack and technical conventions

## Stack summary

| Component | Technology |
|---|---|
| Front end | Vite + React + TypeScript (strict) |
| API | Amazon API Gateway (REST) + TypeScript Lambdas, Node.js 22.x, arm64, `NodejsFunction` |
| Agent | Python 3.13 + Strands Agents SDK on Amazon Bedrock AgentCore Runtime |
| Python | uv with a virtual environment (`.venv`); agent only |
| Infrastructure | AWS CDK in TypeScript |
| Model | Amazon Bedrock (Claude); the model ID is set through a variable |
| AgentCore services | Runtime, Memory, Code Interpreter, Observability and Identity when available |

## Deployment rules
- **Direct code deploy everywhere:** no container images and no ECR.
- **Lambdas:** `NodejsFunction` (esbuild) with `NODEJS_22_X` and `ARM_64`; esbuild installed locally as a devDependency
  so bundling does not depend on Docker. No manual packaging scripts.
- **Agent:** arm64 zip uploaded to S3 and deployed on AgentCore Runtime. In CDK use
  `aws_bedrockagentcore` from `aws-cdk-lib` (`Runtime` and `AgentRuntimeArtifact.fromCodeAsset` or `fromS3`);
  if a construct is missing (for example Memory or Code Interpreter) use the matching L1.
- Before using an AgentCore service or construct, check the current documentation and record
  any limitations in the spec design.

## Python rules (agent) with uv
- Create the environment: `uv venv --python 3.13`; sync with `uv sync`; run with `uv run`.
- Dependencies live in `pyproject.toml` and are locked in `uv.lock` (committed).
- Direct `pip install` and a hand-written `requirements.txt` are forbidden (if one is needed, use `uv export`).
- Packaging for AgentCore: `uv pip install --python-platform aarch64-manylinux2014 --only-binary=:all: --target=<folder>`,
  copy the agent code to the zip root and set POSIX permissions before zipping.
- Agent entrypoint with `@app.entrypoint` from the AgentCore SDK (or `/invocations` and `/ping`).
- Lint and format with ruff; tests with pytest.

## Lambda rules (TypeScript)
- One handler per responsibility, five Lambdas in total (content, chat, hint, run, progress) for least-privilege IAM (confirmed, D1). `chat` (streamified) and `hint` (buffered) are separate functions and never share one, because API Gateway does not support a streamified function behind a buffered integration.
- Input validation with zod; types and schemas shared from `shared/`.
- To invoke the agent, use the AWS SDK v3 Bedrock AgentCore client (`InvokeAgentRuntime`).
- **Chat streaming:** API Gateway REST with `responseTransferMode: STREAM`, a Lambda proxy integration
  invoked with `InvokeWithResponseStream` (URI ending in `/response-streaming-invocations`), and a handler using
  `awslambda.streamifyResponse`. The CDK L2 may not expose it; use L1 (`CfnMethod`) if needed.
  Fallback: a Function URL in `RESPONSE_STREAM` mode for `/api/chat` only.
- Structured logs with a session identifier on every request.

## Front end rules (web/)
- Vite + React + TypeScript strict. Editor: `@monaco-editor/react`. Markdown: `react-markdown`.
- State with hooks and Context; no global state libraries in Phase 0.
- Styling: **CSS Modules** (decided and confirmed, D2; do not add Tailwind).
- Tests: Vitest + React Testing Library.
- Every HTTP call goes through `src/api/client.ts`; no component uses `fetch` directly.
- The base URL comes from `import.meta.env.VITE_API_URL`.
- Accessibility: editor and chat navigable by keyboard, adequate contrast.

## API contract
- Source of truth in `shared/` (zod schemas and TypeScript types), consumed by `web/` and `api/`.
- Endpoints: `GET /api/modules`, `GET /api/modules/{id}/lesson`, `GET /api/exercises/{id}`,
  `POST /api/chat` (SSE: `token`, `done`, `error`), `POST /api/hint`, `POST /api/run`, `GET /api/progress`.
- The contract is stable across phases: the front end does not change when the backend moves from mock to the real agent.
- The `solution` field never appears in a response.

## CDK rules
- One `App` with stacks per responsibility: `WebStack`, `ApiStack`, `AgentStack`, `ContentStack`, `AuthStack`, `OpsStack` (dashboards, alarms, budget; added in Phase 5).
- Default region: `us-east-1` (confirmed, D5).
- Outputs (`CfnOutput`) for URLs and ARNs; configuration through context (`cdk.json`) or variables.
- Least-privilege IAM permissions; no credentials in code or in the front end.
- `Project` and `Phase` tags on all resources.
- `cdk synth` and the CDK tests must pass before `cdk deploy`.

## Security and costs
- Student code runs only in AgentCore Code Interpreter, never in the Lambdas.
- CORS is restricted; the front end never calls AgentCore or Bedrock directly.
- Token limit per message and per session; budget with an alarm.

## General conventions
- Code and comments in English; UI and tutor text in Spanish.
- Small commits per task; one tag per phase.
- Linters: ESLint for TypeScript, ruff for Python.
