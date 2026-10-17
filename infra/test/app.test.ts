import * as path from 'node:path';
import { App } from 'aws-cdk-lib';
import { createApp } from '../lib/create-app';

describe('createApp', () => {
  const context = {
    projectName: 'tutor-agent',
    phase: '0',
    region: 'us-east-1',
    allowedOrigins: ['http://localhost:5173'],
    // Small fixture so the tests do not depend on a real `web/dist` build.
    webDistPath: path.resolve(__dirname, 'fixtures', 'web-dist'),
  };

  it('creates ApiStack and WebStack in us-east-1 with WebStack depending on ApiStack', () => {
    const assembly = createApp(new App({ context })).synth();

    const api = assembly.getStackByName('ApiStack');
    const web = assembly.getStackByName('WebStack');
    expect(api.environment.region).toBe('us-east-1');
    expect(web.environment.region).toBe('us-east-1');
    expect(web.dependencies.map((d) => d.id)).toContain('ApiStack');
  });

  it('applies the Project and Phase tags to the stacks', () => {
    const assembly = createApp(new App({ context })).synth();

    for (const name of ['ApiStack', 'WebStack']) {
      expect(assembly.getStackByName(name).tags).toEqual({
        Project: 'tutor-agent',
        Phase: '0',
      });
    }
  });
});
