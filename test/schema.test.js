import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCallback,
  buildDataBucket,
  buildFolder,
  buildResponse,
  buildRoute,
  normalizeEnvironment,
  validateEnvironmentSchema
} from '../public/mockoon-schema.js';

test('normalizes a Desktop-style environment without dropping unknown fields', () => {
  const environment = {
    uuid: crypto.randomUUID(),
    lastMigration: 33,
    name: 'Desktop export',
    port: 3000,
    hostname: '0.0.0.0',
    endpointPrefix: 'api',
    latency: 0,
    routes: [],
    futureMockoonProperty: { preserved: true }
  };

  const normalized = normalizeEnvironment(environment);

  assert.deepEqual(normalized.futureMockoonProperty, { preserved: true });
  assert.deepEqual(normalized.folders, []);
  assert.deepEqual(normalized.data, []);
  assert.deepEqual(normalized.callbacks, []);
  assert.deepEqual(validateEnvironmentSchema(normalized), []);
});

test('builds and validates the full Mockoon route model', () => {
  const bucket = buildDataBucket();
  const callback = buildCallback();
  const folder = buildFolder();
  const httpRoute = buildRoute('http');
  const crudRoute = buildRoute('crud');
  const websocketRoute = buildRoute('ws');
  const conditionalResponse = buildResponse({ isDefault: false });
  conditionalResponse.rules.push({ target: 'query', modifier: 'role', operator: 'equals', value: 'admin', invert: false });
  conditionalResponse.callbacks.push({ uuid: callback.uuid, latency: 10 });
  httpRoute.responses.push(conditionalResponse);
  crudRoute.responses[0].databucketID = bucket.uuid;
  websocketRoute.streamingMode = 'BROADCAST';
  websocketRoute.streamingInterval = 1000;
  folder.children.push({ type: 'route', uuid: httpRoute.uuid });

  const environment = normalizeEnvironment({
    uuid: crypto.randomUUID(),
    lastMigration: 33,
    name: 'Complete environment',
    port: 3000,
    hostname: '0.0.0.0',
    endpointPrefix: '',
    latency: 0,
    routes: [httpRoute, crudRoute, websocketRoute],
    folders: [folder],
    rootChildren: [
      { type: 'folder', uuid: folder.uuid },
      { type: 'route', uuid: crudRoute.uuid },
      { type: 'route', uuid: websocketRoute.uuid }
    ],
    data: [bucket],
    callbacks: [callback]
  });

  assert.deepEqual(validateEnvironmentSchema(environment), []);
  assert.equal(environment.routes[0].responses[1].default, false);
  assert.equal(environment.routes[2].streamingMode, 'BROADCAST');
});

test('rejects unsupported route and rule values', () => {
  const route = buildRoute('http');
  route.type = 'graphql';
  route.responses[0].rules.push({ target: 'unknown', modifier: '', operator: 'nope', value: '', invert: false });
  const environment = normalizeEnvironment({ uuid: crypto.randomUUID(), name: 'Invalid', routes: [route] });
  const errors = validateEnvironmentSchema(environment);

  assert.ok(errors.some((error) => error.includes('unsupported type')));
  assert.ok(errors.some((error) => error.includes('unsupported target')));
  assert.ok(errors.some((error) => error.includes('unsupported operator')));
});
