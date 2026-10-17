import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, Tokenization, type StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

/** Repository root: the Lambda bundles resolve `shared/` and `content/` from here. */
const REPO_ROOT = path.join(__dirname, '..', '..');
const HANDLERS_DIR = path.join(REPO_ROOT, 'api', 'src', 'handlers');
const ROOT_LOCKFILE = path.join(REPO_ROOT, 'package-lock.json');

export interface ApiStackProps extends StackProps {
  /** Origins allowed by the CORS preflight (from the `allowedOrigins` context). */
  readonly allowedOrigins: string[];
}

interface ApiFunctionOptions {
  /** Construct id, also used as the function name suffix. */
  readonly id: string;
  /** Handler file name under `api/src/handlers/` (without extension). */
  readonly entry: string;
  readonly timeout: Duration;
  readonly description: string;
  readonly environment?: Record<string, string>;
}

/** Stage name; the CloudFront `/api/*` origin targets this stage. */
export const API_STAGE_NAME = 'prod';

/** Integration timeout of the streaming `POST /api/chat` method (the Lambda timeout is 30 s). */
export const CHAT_INTEGRATION_TIMEOUT_MS = 60_000;

/**
 * REST API and Lambda functions. Task 12.2 adds the five functions and their
 * log groups; task 12.3 adds the `RestApi` with its routes; task 12.4 turns
 * `POST /api/chat` into a streaming integration; task 12.5 adds the outputs.
 * (Tasks 12.2 to 12.5 are all implemented here.)
 */
export class ApiStack extends Stack {
  /** Regional REST API; `WebStack` uses it as the `/api/*` origin. */
  public readonly restApi: apigateway.RestApi;

  /**
   * `POST /api/chat`. Kept as a field so task 12.4 can override the underlying
   * `CfnMethod` (response streaming) without recreating the invoke permission.
   */
  public readonly chatMethod: apigateway.Method;

  public readonly allowedOrigins: string[];

  /** `GET /api/modules`, `GET /api/modules/{id}/lesson`, `GET /api/exercises/{id}` (buffered). */
  public readonly contentFn: NodejsFunction;
  /** `POST /api/chat` (response streaming). */
  public readonly chatFn: NodejsFunction;
  /** `POST /api/hint` (buffered). */
  public readonly hintFn: NodejsFunction;
  /** `POST /api/run` (buffered). */
  public readonly runFn: NodejsFunction;
  /** `GET /api/progress` (buffered). */
  public readonly progressFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    this.allowedOrigins = props.allowedOrigins;

    // The deployed site is same-origin through CloudFront, so CORS only matters
    // for local direct calls (the origins come from the `allowedOrigins` context).
    const commonEnvironment = { ALLOWED_ORIGINS: this.allowedOrigins.join(',') };

    this.contentFn = this.createFunction({
      id: 'ContentFn',
      entry: 'content',
      timeout: Duration.seconds(10),
      description: 'Phase 0: modules, lessons and public exercises',
      environment: commonEnvironment,
    });
    this.chatFn = this.createFunction({
      id: 'ChatFn',
      entry: 'chat',
      // Phase 0 mock stream is short; the timeout only covers the expected duration.
      timeout: Duration.seconds(30),
      description: 'Phase 0: mock tutor chat streamed as SSE',
      environment: { ...commonEnvironment, MOCK_TOKEN_DELAY_MS: '40' },
    });
    this.hintFn = this.createFunction({
      id: 'HintFn',
      entry: 'hint',
      timeout: Duration.seconds(10),
      description: 'Phase 0: progressive hints from the content',
      environment: commonEnvironment,
    });
    this.runFn = this.createFunction({
      id: 'RunFn',
      entry: 'run',
      timeout: Duration.seconds(10),
      description: 'Phase 0: simulated test run (code is never evaluated)',
      environment: commonEnvironment,
    });
    this.progressFn = this.createFunction({
      id: 'ProgressFn',
      entry: 'progress',
      timeout: Duration.seconds(10),
      description: 'Phase 0: fixed progress value',
      environment: commonEnvironment,
    });

    this.restApi = this.createRestApi();
    this.chatMethod = this.addRoutes(this.restApi);
    this.configureChatStreaming(this.chatMethod);
    this.createOutputs();
  }

  /**
   * Stack outputs for the API URL, API id and every function ARN. They are not
   * exported across stacks: `WebStack` receives the `RestApi` through props.
   */
  private createOutputs(): void {
    new CfnOutput(this, 'ApiUrl', {
      // `restApi.url` is the stage invoke URL and ends with a trailing slash.
      value: this.restApi.url,
      description: 'Invoke URL of the REST API prod stage',
    });
    new CfnOutput(this, 'ApiId', {
      value: this.restApi.restApiId,
      description: 'REST API id',
    });

    const functionArns: ReadonlyArray<[string, NodejsFunction, string]> = [
      ['ContentFunctionArn', this.contentFn, 'content'],
      ['ChatFunctionArn', this.chatFn, 'chat (streaming)'],
      ['HintFunctionArn', this.hintFn, 'hint'],
      ['RunFunctionArn', this.runFn, 'run'],
      ['ProgressFunctionArn', this.progressFn, 'progress'],
    ];
    for (const [outputId, fn, label] of functionArns) {
      new CfnOutput(this, outputId, {
        value: fn.functionArn,
        description: `ARN of the ${label} Lambda function`,
      });
    }
  }

  /**
   * Switches `POST /api/chat` to response streaming; every other method keeps
   * the default `BUFFERED` transfer mode.
   *
   * Why `chat` is its own function: API Gateway invokes a streaming integration
   * with `InvokeWithResponseStream` (URI `.../response-streaming-invocations`),
   * and a streamified handler cannot sit behind a buffered `Invoke` integration
   * (nor the reverse), so `chat` cannot share a function with `hint`.
   *
   * `ResponseTransferMode` is a typed property of `CfnMethod.IntegrationProperty`
   * in the installed `aws-cdk-lib`, so it is set through the L1 integration
   * instead of a raw property override. The L2 `LambdaIntegration` still creates
   * the `lambda:InvokeFunction` permission for `apigateway.amazonaws.com`; per
   * the Lambda docs, `InvokeWithResponseStream` is authorized by that same action.
   *
   * Known limitations of STREAM mode (AWS docs, "Stream the integration response
   * for your proxy integrations"): no endpoint caching, no content encoding
   * (compress in the function), no VTL response transformation, and no request
   * streaming. Only AWS_PROXY / HTTP_PROXY integrations can stream; the stage
   * has no cache cluster and the integration stays AWS_PROXY.
   */
  private configureChatStreaming(method: apigateway.Method): void {
    const cfnMethod = method.node.defaultChild as apigateway.CfnMethod;
    const integration = cfnMethod.integration;
    if (integration === undefined || Tokenization.isResolvable(integration)) {
      throw new Error('POST /api/chat must have a concrete integration to enable streaming');
    }

    // Same ARN shape as the buffered integration, but with the 2021-11-15 API
    // version and the `response-streaming-invocations` action.
    const streamingUri =
      `arn:${this.partition}:apigateway:${this.region}:lambda:path/2021-11-15/functions/` +
      `${this.chatFn.functionArn}/response-streaming-invocations`;

    cfnMethod.integration = {
      ...integration,
      type: 'AWS_PROXY',
      integrationHttpMethod: 'POST',
      uri: streamingUri,
      responseTransferMode: 'STREAM',
      // Explicit so the limit does not depend on the 29 s default. Streams can
      // run up to 15 minutes; 60 s covers the chat function (30 s timeout) with margin.
      timeoutInMillis: CHAT_INTEGRATION_TIMEOUT_MS,
    };
  }

  /** Regional REST API with stage `prod`, throttling and JSON access logs. */
  private createRestApi(): apigateway.RestApi {
    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    return new apigateway.RestApi(this, 'RestApi', {
      restApiName: 'tutor-agent-api',
      description: 'Phase 0: tutor API (mock responses)',
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      // The execute-api endpoint stays enabled: the CloudFront origin uses it.
      cloudWatchRole: true,
      deployOptions: {
        stageName: API_STAGE_NAME,
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
        cacheClusterEnabled: false,
        // No execution logs and no data trace: request bodies may hold student code.
        loggingLevel: apigateway.MethodLoggingLevel.OFF,
        dataTraceEnabled: false,
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
      },
    });
  }

  /**
   * Adds the seven routes under `/api` and returns the `chat` method.
   *
   * Request validation is shallow on purpose: one validator checks required
   * path parameters and that POST bodies are JSON objects. Exact schemas are
   * enforced by zod inside the Lambdas. With a request model, API Gateway
   * validates the body only for the `application/json` content type; other
   * content types are not matched to the model and fall through to the
   * Lambda, which rejects them with its own validation.
   */
  private addRoutes(api: apigateway.RestApi): apigateway.Method {
    const validator = api.addRequestValidator('RequestValidator', {
      requestValidatorName: 'validate-params-and-body',
      validateRequestParameters: true,
      validateRequestBody: true,
    });

    const objectModel = (id: string): apigateway.Model =>
      api.addModel(id, {
        modelName: id,
        contentType: 'application/json',
        schema: {
          schema: apigateway.JsonSchemaVersion.DRAFT4,
          title: id,
          type: apigateway.JsonSchemaType.OBJECT,
        },
      });
    const chatModel = objectModel('ChatRequest');
    const hintModel = objectModel('HintRequest');
    const runModel = objectModel('RunRequest');

    const get = (resource: apigateway.Resource, fn: lambda.IFunction, pathParam?: string) =>
      resource.addMethod('GET', new apigateway.LambdaIntegration(fn, { proxy: true }), {
        requestValidator: validator,
        requestParameters: pathParam ? { [`method.request.path.${pathParam}`]: true } : undefined,
      });

    const post = (resource: apigateway.Resource, fn: lambda.IFunction, model: apigateway.Model) =>
      resource.addMethod('POST', new apigateway.LambdaIntegration(fn, { proxy: true }), {
        requestValidator: validator,
        requestModels: { 'application/json': model },
      });

    // CORS preflight is inherited by every child resource. The L2 requires at
    // least one origin, so it is skipped when `allowedOrigins` is empty.
    const apiResource = api.root.addResource('api', {
      defaultCorsPreflightOptions:
        this.allowedOrigins.length > 0
          ? {
              allowOrigins: this.allowedOrigins,
              allowMethods: ['GET', 'POST', 'OPTIONS'],
              allowHeaders: ['Content-Type', 'X-Session-Id'],
            }
          : undefined,
    });

    // GET /api/modules, GET /api/modules/{id}/lesson
    const modules = apiResource.addResource('modules');
    get(modules, this.contentFn);
    get(modules.addResource('{id}').addResource('lesson'), this.contentFn, 'id');

    // GET /api/exercises/{id}
    get(apiResource.addResource('exercises').addResource('{id}'), this.contentFn, 'id');

    // POST /api/chat, POST /api/hint, POST /api/run
    const chatMethod = post(apiResource.addResource('chat'), this.chatFn, chatModel);
    post(apiResource.addResource('hint'), this.hintFn, hintModel);
    post(apiResource.addResource('run'), this.runFn, runModel);

    // GET /api/progress
    get(apiResource.addResource('progress'), this.progressFn);

    return chatMethod;
  }

  /**
   * Creates one bundled Lambda with its own log group and its own role.
   * The role can only create streams and put events in that log group:
   * no Bedrock, AgentCore or other permission.
   */
  private createFunction(options: ApiFunctionOptions): NodejsFunction {
    const logGroup = new logs.LogGroup(this, `${options.id}Logs`, {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Least privilege: instead of the broad AWSLambdaBasicExecutionRole managed
    // policy (which allows logs:CreateLogGroup on any group), grant only what
    // the function needs on its own pre-created log group.
    const role = new iam.Role(this, `${options.id}Role`, {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: `Execution role for ${options.id} (logs only)`,
      inlinePolicies: {
        Logging: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
              resources: [logGroup.logGroupArn, `${logGroup.logGroupArn}:*`],
            }),
          ],
        }),
      },
    });

    return new NodejsFunction(this, options.id, {
      entry: path.join(HANDLERS_DIR, `${options.entry}.ts`),
      handler: 'handler',
      description: options.description,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: options.timeout,
      role,
      logGroup,
      environment: options.environment,
      projectRoot: REPO_ROOT,
      depsLockFilePath: ROOT_LOCKFILE,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
        format: OutputFormat.ESM,
        // Lessons are imported as text; `.json` is handled natively by esbuild.
        loader: { '.md': 'text' },
        // Use the esbuild installed locally (infra devDependency); never Docker.
        forceDockerBundling: false,
      },
    });
  }
}
