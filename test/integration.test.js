import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(projectDir, '.test-runtime');
const testDataFile = path.join(testDir, 'environment.json');
const baseUrl = 'http://127.0.0.1:42991';

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start in time.')), 5000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Mockoon Live Studio:')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => code && reject(new Error(`Server exited with ${code}`)));
  });
}

test('loads, validates, saves, and versions a Mockoon environment', async (t) => {
  await mkdir(testDir, { recursive: true });
  await copyFile(path.join(projectDir, 'data', 'sample-environment.json'), testDataFile);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectDir,
    env: { ...process.env, STUDIO_PORT: '42991', MOCKOON_DATA_FILE: testDataFile, STUDIO_HISTORY_DIR: path.join(testDir, 'history') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    child.kill();
    await rm(testDir, { recursive: true, force: true });
  });
  await waitForServer(child);

  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);

  const initial = await fetch(`${baseUrl}/api/environment`).then((response) => response.json());
  assert.equal(initial.environment.name, 'Storefront API');
  assert.equal(initial.environment.routes.length, 2);

  initial.environment.name = 'Integration Test API';
  const savedResponse = await fetch(`${baseUrl}/api/environment`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ environment: initial.environment, reason: 'integration-test' })
  });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.ok, true);
  assert.ok(saved.snapshot);

  const diskValue = JSON.parse(await readFile(testDataFile, 'utf8'));
  assert.equal(diskValue.name, 'Integration Test API');

  const history = await fetch(`${baseUrl}/api/history`).then((response) => response.json());
  assert.ok(history.history.some((entry) => entry.reason === 'integration test'));

  const invalidResponse = await fetch(`${baseUrl}/api/environment`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ environment: { name: 'Broken', routes: [] } })
  });
  assert.equal(invalidResponse.status, 422);
});
