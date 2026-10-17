import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import { API_STAGE_NAME } from './api-stack';

/**
 * Origin read timeout for `/api/*`. Matches the 60 s integration timeout of the
 * streaming `POST /api/chat` method so CloudFront does not cut the SSE stream first.
 */
export const API_ORIGIN_READ_TIMEOUT = Duration.seconds(60);

export interface WebStackProps extends StackProps {
  /** REST API exposed by `ApiStack`; origin of the `/api/*` behavior. */
  readonly restApi?: apigateway.IRestApi;
  /** Path to the built front end (`web/dist`), relative to `infra/`. */
  readonly webDistPath: string;
}

/**
 * Static site hosting: private S3 bucket, CloudFront distribution (with the
 * `/api/*` behavior to the REST API), a deployment of the `web/dist` build with
 * cache invalidation, and the stack outputs.
 */
export class WebStack extends Stack {
  /** Private bucket that holds the `web/dist` build; only CloudFront (OAC) can read it. */
  public readonly siteBucket: s3.Bucket;

  /** CloudFront distribution that serves the site (and, from task 13.2, `/api/*`). */
  public readonly distribution: cloudfront.Distribution;

  public readonly restApi?: apigateway.IRestApi;
  public readonly webDistPath: string;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    this.restApi = props.restApi;
    this.webDistPath = props.webDistPath;

    this.siteBucket = this.createSiteBucket();
    this.distribution = this.createDistribution(this.siteBucket);
    this.addApiBehavior(this.distribution);
    this.createDeployment(this.siteBucket, this.distribution);
    this.createOutputs();
  }

  /**
   * Uploads the built front end to the bucket and invalidates every path in the
   * distribution. Backed by a CDK-managed singleton Lambda (no containers).
   * `webDistPath` is resolved relative to `infra/` so the result does not depend
   * on the current working directory (absolute paths are kept as they are).
   */
  private createDeployment(bucket: s3.IBucket, distribution: cloudfront.IDistribution): void {
    const infraDir = path.resolve(__dirname, '..');
    const webDistDir = path.resolve(infraDir, this.webDistPath);

    new s3deploy.BucketDeployment(this, 'SiteDeployment', {
      sources: [s3deploy.Source.asset(webDistDir)],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });
  }

  /** Site URL, distribution id and bucket name. */
  private createOutputs(): void {
    new CfnOutput(this, 'SiteUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Public URL of the site (CloudFront)',
    });
    new CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution id',
    });
    new CfnOutput(this, 'BucketName', {
      value: this.siteBucket.bucketName,
      description: 'S3 bucket that holds the site build',
    });
  }

  /**
   * `/api/*` behavior: the REST API regional endpoint is the origin, with the
   * stage as origin path, so the browser calls `/api/...` on the site domain
   * (same origin, no CORS). Nothing is cached, every viewer header except
   * `Host` is forwarded (API Gateway needs its own `Host`), and compression is
   * off so streamed SSE chunks are not buffered by CloudFront.
   */
  private addApiBehavior(distribution: cloudfront.Distribution): void {
    if (this.restApi === undefined) {
      return;
    }

    const apiOrigin = new origins.HttpOrigin(`${this.restApi.restApiId}.execute-api.${this.region}.amazonaws.com`, {
      originPath: `/${API_STAGE_NAME}`,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      readTimeout: API_ORIGIN_READ_TIMEOUT,
    });

    distribution.addBehavior('/api/*', apiOrigin, {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      compress: false,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    });
  }

  /**
   * Private, encrypted bucket. Public access is fully blocked and non-TLS
   * requests are denied. `DESTROY` with `autoDeleteObjects` is acceptable for
   * a POC and is revisited in Phase 5.
   */
  private createSiteBucket(): s3.Bucket {
    return new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }

  /**
   * Distribution with the bucket as the default origin through Origin Access
   * Control (the bucket policy is generated by the construct), HTTPS redirect
   * and the managed security headers policy.
   *
   * No `errorResponses` on purpose: a 403/404 rewritten to `index.html` would
   * also rewrite API errors, which the front end must see as they are.
   */
  private createDistribution(bucket: s3.IBucket): cloudfront.Distribution {
    return new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: 'tutor-agent: static site',
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
    });
  }
}
