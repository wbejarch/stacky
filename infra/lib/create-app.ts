import { App, Tags } from 'aws-cdk-lib';
import { ApiStack } from './api-stack';
import { WebStack } from './web-stack';

export const DEFAULT_REGION = 'us-east-1';
export const DEFAULT_WEB_DIST_PATH = '../web/dist';

/**
 * Builds the CDK app: reads configuration from context (`cdk.json` or `-c`),
 * tags every resource with `Project` and `Phase`, and creates the stacks.
 * Deploy order is `ApiStack` then `WebStack`.
 */
export function createApp(app: App = new App()): App {
  const projectName = String(app.node.tryGetContext('projectName') ?? 'tutor-agent');
  const phase = String(app.node.tryGetContext('phase') ?? '0');
  const region = String(app.node.tryGetContext('region') ?? DEFAULT_REGION);
  const allowedOrigins = (app.node.tryGetContext('allowedOrigins') ?? []) as string[];
  const webDistPath = String(app.node.tryGetContext('webDistPath') ?? DEFAULT_WEB_DIST_PATH);

  const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region };

  Tags.of(app).add('Project', projectName);
  Tags.of(app).add('Phase', phase);

  const apiStack = new ApiStack(app, 'ApiStack', { env, allowedOrigins });
  const webStack = new WebStack(app, 'WebStack', {
    env,
    restApi: apiStack.restApi,
    webDistPath,
  });
  webStack.addStackDependency(apiStack);

  return app;
}
