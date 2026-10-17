import { App, Tags } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../lib/api-stack';

/** Collects every IAM action found in the policy statements of the given resources. */
function collectActions(resources: Record<string, Record<string, unknown>>): string[] {
  interface IamProperties {
    PolicyDocument?: { Statement?: unknown };
    Policies?: Array<{ PolicyDocument?: { Statement?: unknown } }>;
  }
  const actions: string[] = [];
  const addFrom = (document: { Statement?: unknown } | undefined): void => {
    const statements = (document?.Statement ?? []) as Array<{ Action?: string | string[] }>;
    for (const statement of statements) {
      actions.push(...([] as string[]).concat(statement.Action ?? []));
    }
  };
  for (const resource of Object.values(resources)) {
    const properties = (resource.Properties ?? {}) as IamProperties;
    addFrom(properties.PolicyDocument);
    for (const inline of properties.Policies ?? []) {
      addFrom(inline.PolicyDocument);
    }
  }
  return actions;
}

describe('ApiStack functions', () => {
  // Real esbuild bundling runs here, so build the template once.
  let template: Template;

  beforeAll(() => {
    const app = new App();
    // Same tagging as `createApp`: tags are applied at the app scope.
    Tags.of(app).add('Project', 'tutor-agent');
    Tags.of(app).add('Phase', '0');
    const stack = new ApiStack(app, 'ApiStack', {
      env: { account: '111111111111', region: 'us-east-1' },
      allowedOrigins: ['http://localhost:5173'],
    });
    template = Template.fromStack(stack);
  }, 120_000);

  it('creates five Node.js 22 arm64 functions', () => {
    template.resourceCountIs('AWS::Lambda::Function', 5);
    const functions = template.findResources('AWS::Lambda::Function');
    for (const fn of Object.values(functions)) {
      expect(fn.Properties.Runtime).toBe('nodejs22.x');
      expect(fn.Properties.Architectures).toEqual(['arm64']);
    }
  });

  it('gives every function its own log group and a logs-only role', () => {
    // Five function log groups plus the API access log group.
    template.resourceCountIs('AWS::Logs::LogGroup', 6);
    // Five function roles plus the API Gateway CloudWatch role.
    template.resourceCountIs('AWS::IAM::Role', 6);
    const lambdaRoles = template.findResources('AWS::IAM::Role', {
      Properties: {
        AssumeRolePolicyDocument: {
          Statement: [Match.objectLike({ Principal: { Service: 'lambda.amazonaws.com' } })],
        },
      },
    });
    expect(Object.keys(lambdaRoles)).toHaveLength(5);
    for (const role of Object.values(lambdaRoles)) {
      expect(role.Properties.ManagedPolicyArns).toBeUndefined();
    }
    expect(JSON.stringify(lambdaRoles)).not.toMatch(/bedrock/i);
  });

  it('creates a regional REST API with a prod stage and throttling', () => {
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      EndpointConfiguration: { Types: ['REGIONAL'] },
    });
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      StageName: 'prod',
      AccessLogSetting: Match.objectLike({ DestinationArn: Match.anyValue() }),
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          ThrottlingRateLimit: 50,
          ThrottlingBurstLimit: 100,
          DataTraceEnabled: false,
          LoggingLevel: 'OFF',
        }),
      ]),
    });
    for (const stage of Object.values(template.findResources('AWS::ApiGateway::Stage'))) {
      expect(stage.Properties.CacheClusterEnabled).not.toBe(true);
    }
    template.resourceCountIs('AWS::ApiGateway::Account', 1);
  });

  it('exposes the seven routes under /api', () => {
    const resources = Object.values(template.findResources('AWS::ApiGateway::Resource')).map(
      (r) => r.Properties.PathPart as string,
    );
    expect(resources.sort()).toEqual(
      ['api', 'chat', 'exercises', 'hint', 'lesson', 'modules', 'progress', 'run', '{id}', '{id}'].sort(),
    );

    const methods = Object.values(
      template.findResources('AWS::ApiGateway::Method', {
        Properties: { HttpMethod: Match.not('OPTIONS') },
      }),
    );
    expect(methods).toHaveLength(7);
    for (const method of methods) {
      expect(method.Properties.Integration.Type).toBe('AWS_PROXY');
      expect(method.Properties.RequestValidatorId).toBeDefined();
    }
    expect(methods.filter((m) => m.Properties.HttpMethod === 'GET')).toHaveLength(4);
    expect(methods.filter((m) => m.Properties.HttpMethod === 'POST')).toHaveLength(3);
  });

  it('streams only POST /api/chat and keeps the other methods buffered', () => {
    const methods = Object.values(
      template.findResources('AWS::ApiGateway::Method', {
        Properties: { HttpMethod: Match.not('OPTIONS') },
      }),
    );
    const streaming = methods.filter(
      (m) => m.Properties.Integration.ResponseTransferMode === 'STREAM',
    );
    expect(streaming).toHaveLength(1);

    const chat = streaming[0]!.Properties;
    expect(chat.HttpMethod).toBe('POST');
    expect(chat.Integration.Type).toBe('AWS_PROXY');
    expect(chat.Integration.IntegrationHttpMethod).toBe('POST');
    expect(chat.Integration.TimeoutInMillis).toBe(60_000);

    // The chat resource is the one whose path part is `chat`.
    const chatResources = template.findResources('AWS::ApiGateway::Resource', {
      Properties: { PathPart: 'chat' },
    });
    expect(Object.keys(chatResources)).toHaveLength(1);
    expect(chat.ResourceId).toEqual({ Ref: Object.keys(chatResources)[0] });

    // The URI is an Fn::Join: the streaming action is the last literal part
    // and the 2021-11-15 API version appears in the first literal parts.
    const parts = chat.Integration.Uri['Fn::Join'][1] as unknown[];
    expect(parts[parts.length - 1]).toBe('/response-streaming-invocations');
    expect(JSON.stringify(parts)).toContain(':lambda:path/2021-11-15/functions/');
    expect(JSON.stringify(parts)).toContain('"Fn::GetAtt"');

    // Every other non-preflight method stays BUFFERED (property unset).
    const others = methods.filter((m) => m !== streaming[0]);
    expect(others).toHaveLength(6);
    for (const method of others) {
      expect(method.Properties.Integration.ResponseTransferMode).toBeUndefined();
      expect(JSON.stringify(method.Properties.Integration.Uri)).not.toContain(
        'response-streaming-invocations',
      );
    }
    const preflight = template.findResources('AWS::ApiGateway::Method', {
      Properties: { HttpMethod: 'OPTIONS' },
    });
    expect(JSON.stringify(preflight)).not.toContain('ResponseTransferMode');
  });

  it('grants no bedrock or bedrock-agentcore action in any IAM role or policy', () => {
    const roles = template.findResources('AWS::IAM::Role');
    const policies = template.findResources('AWS::IAM::Policy');
    const actions = collectActions({ ...roles, ...policies });

    // The scan must see the real statements, otherwise the check is vacuous.
    expect(actions).toEqual(expect.arrayContaining(['logs:CreateLogStream', 'logs:PutLogEvents']));
    expect(actions.filter((action) => /^bedrock(-agentcore)?:/i.test(action))).toEqual([]);
    expect(JSON.stringify({ roles, policies })).not.toMatch(/bedrock/i);
  });

  it('tags the resources with Project and Phase', () => {
    const expectedTags = Match.arrayWith([
      { Key: 'Phase', Value: '0' },
      { Key: 'Project', Value: 'tutor-agent' },
    ]);
    template.allResourcesProperties('AWS::Lambda::Function', { Tags: expectedTags });
    template.hasResourceProperties('AWS::ApiGateway::RestApi', { Tags: expectedTags });
    template.hasResourceProperties('AWS::ApiGateway::Stage', { Tags: expectedTags });
    template.allResourcesProperties('AWS::IAM::Role', { Tags: expectedTags });
  });

  it('lets API Gateway invoke the chat function', () => {
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'apigateway.amazonaws.com',
      SourceArn: Match.anyValue(),
    });
  });

  it('validates parameters and JSON object bodies', () => {
    template.hasResourceProperties('AWS::ApiGateway::RequestValidator', {
      ValidateRequestParameters: true,
      ValidateRequestBody: true,
    });
    template.resourceCountIs('AWS::ApiGateway::Model', 3);
    template.allResourcesProperties('AWS::ApiGateway::Model', {
      ContentType: 'application/json',
      Schema: Match.objectLike({ type: 'object' }),
    });
  });

  it('outputs the API URL, the API id and one ARN per function without exports', () => {
    const allOutputs = template.toJSON().Outputs as Record<string, Record<string, unknown>>;
    // The RestApi L2 adds its own `RestApiEndpoint*` output (same stage URL); ignore it.
    const outputs = Object.fromEntries(
      Object.entries(allOutputs).filter(([name]) => !name.startsWith('RestApiEndpoint')),
    );
    expect(Object.keys(outputs).sort()).toEqual(
      [
        'ApiId',
        'ApiUrl',
        'ChatFunctionArn',
        'ContentFunctionArn',
        'HintFunctionArn',
        'ProgressFunctionArn',
        'RunFunctionArn',
      ].sort(),
    );

    // The URL is the stage invoke URL: `https://{id}.execute-api.{region}.{suffix}/{stage}/`.
    const urlParts = (outputs.ApiUrl!.Value as { 'Fn::Join': [string, unknown[]] })['Fn::Join'][1];
    expect(urlParts[urlParts.length - 1]).toBe('/');
    expect(JSON.stringify(urlParts)).toContain('.execute-api.');
    expect(JSON.stringify(urlParts)).toContain('"Ref":"RestApiDeploymentStageprod');

    for (const [name, output] of Object.entries(outputs)) {
      expect(output.Description).toEqual(expect.any(String));
      expect(output.Export).toBeUndefined();
      if (name.endsWith('FunctionArn')) {
        expect(output.Value).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/^\w+Fn\w+$/), 'Arn'] });
      }
    }
  });

  it('restricts the CORS preflight to the allowed origins', () => {
    const preflight = Object.values(
      template.findResources('AWS::ApiGateway::Method', {
        Properties: { HttpMethod: 'OPTIONS' },
      }),
    );
    expect(preflight.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(preflight);
    expect(serialized).toContain('http://localhost:5173');
    expect(serialized).toContain('Content-Type,X-Session-Id');
    expect(serialized).not.toContain("'*'");
  });
});
