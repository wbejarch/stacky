import * as path from 'node:path';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { WebStack } from '../lib/web-stack';

// Managed policy ids published by CloudFront.
const CACHING_DISABLED_POLICY_ID = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
const ALL_VIEWER_EXCEPT_HOST_HEADER_POLICY_ID = 'b689b0a8-53d0-40ab-baf2-68738e2966ac';

// Small fixture so the tests do not depend on a real `web/dist` build.
const webDistPath = path.resolve(__dirname, 'fixtures', 'web-dist');
const env = { account: '111111111111', region: 'us-east-1' };

/** Returns the `DistributionConfig` of the single distribution in the template. */
function getDistributionConfig(template: Template): Record<string, unknown> & {
  CacheBehaviors?: Array<{ TargetOriginId: string }>;
  Origins: Array<{ Id: string; OriginPath?: string; DomainName: unknown; CustomOriginConfig?: unknown }>;
} {
  const distributions = Object.values(template.findResources('AWS::CloudFront::Distribution'));
  expect(distributions).toHaveLength(1);
  return (distributions[0] as { Properties: { DistributionConfig: never } }).Properties.DistributionConfig;
}

/** Builds a `WebStack`, optionally wired to a minimal REST API living in its own stack. */
function buildWebTemplate(withApi: boolean): Template {
  const app = new App();
  let restApi: apigateway.IRestApi | undefined;
  if (withApi) {
    const apiStack = new Stack(app, 'FakeApiStack', { env });
    const api = new apigateway.RestApi(apiStack, 'Api', { deploy: true });
    api.root.addMethod('GET', new apigateway.MockIntegration());
    restApi = api;
  }
  const stack = new WebStack(app, 'WebStack', { env, restApi, webDistPath });
  return Template.fromStack(stack);
}

describe('WebStack with the API origin', () => {
  let template: Template;

  beforeAll(() => {
    template = buildWebTemplate(true);
  });

  describe('site bucket', () => {
    it('blocks all public access', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    it('encrypts objects at rest with S3-managed keys', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }),
          ],
        },
      });
    });

    it('denies requests that do not use TLS', () => {
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Deny',
              Principal: { AWS: '*' },
              Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            }),
          ]),
        },
      });
    });

    it('lets only CloudFront read the bucket, through Origin Access Control', () => {
      template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
      template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
        OriginAccessControlConfig: Match.objectLike({
          OriginAccessControlOriginType: 's3',
          SigningBehavior: 'always',
          SigningProtocol: 'sigv4',
        }),
      });
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: 's3:GetObject',
              Principal: { Service: 'cloudfront.amazonaws.com' },
              Condition: { StringEquals: { 'AWS:SourceArn': Match.anyValue() } },
            }),
          ]),
        },
      });
    });
  });

  describe('distribution', () => {
    it('redirects HTTP to HTTPS on the default behavior', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          DefaultRootObject: 'index.html',
          DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
        },
      });
    });

    it('adds a /api/* behavior with caching disabled and no compression', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          CacheBehaviors: [
            Match.objectLike({
              PathPattern: '/api/*',
              CachePolicyId: CACHING_DISABLED_POLICY_ID,
              OriginRequestPolicyId: ALL_VIEWER_EXCEPT_HOST_HEADER_POLICY_ID,
              Compress: false,
              ViewerProtocolPolicy: 'redirect-to-https',
              AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
            }),
          ],
        },
      });
    });

    it('points the /api/* origin at the REST API stage with a 60 s read timeout', () => {
      const config = getDistributionConfig(template);

      const behavior = config.CacheBehaviors?.[0];
      expect(behavior).toBeDefined();
      const apiOrigin = config.Origins.find((o) => o.Id === behavior?.TargetOriginId);

      expect(apiOrigin).toMatchObject({
        OriginPath: '/prod',
        CustomOriginConfig: {
          OriginProtocolPolicy: 'https-only',
          OriginReadTimeout: 60,
        },
      });
      expect(JSON.stringify(apiOrigin?.DomainName)).toContain('.execute-api.');
    });

    it('does not define custom error responses', () => {
      expect(getDistributionConfig(template).CustomErrorResponses).toBeUndefined();
    });
  });

  describe('outputs', () => {
    it.each(['SiteUrl', 'DistributionId', 'BucketName'])('exposes the %s output', (name) => {
      expect(template.toJSON().Outputs).toHaveProperty(name);
    });

    it('builds the site URL over HTTPS from the distribution domain', () => {
      const outputs = template.toJSON().Outputs;
      expect(JSON.stringify(outputs.SiteUrl.Value)).toContain('https://');
      expect(JSON.stringify(outputs.SiteUrl.Value)).toContain('DomainName');
    });
  });
});

describe('WebStack without an API origin', () => {
  it('has no /api/* behavior and still has no custom error responses', () => {
    const template = buildWebTemplate(false);
    const config = getDistributionConfig(template);

    expect(config.CacheBehaviors).toBeUndefined();
    expect(config.CustomErrorResponses).toBeUndefined();
  });
});
