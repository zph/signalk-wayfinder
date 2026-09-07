import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { pluginDataDir } from '../setup';

const roots: string[] = [];

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('pluginDataDir migrates the legacy cache into the Sail Wayfinder identity', () => {
  const configPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-setup-'));
  roots.push(configPath);
  const legacy = path.join(configPath, 'plugin-config-data', 'signalk-weather-routing');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'edge-index.bin'), 'cached shoreline');

  const current = pluginDataDir({ config: { configPath } } as never);

  assert.equal(current, path.join(configPath, 'plugin-config-data', 'signalk-wayfinder'));
  assert.equal(fs.readFileSync(path.join(current, 'edge-index.bin'), 'utf8'), 'cached shoreline');
  assert.equal(fs.existsSync(legacy), false);
});

test('pluginDataDir never overwrites an existing Sail Wayfinder cache', () => {
  const configPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-setup-'));
  roots.push(configPath);
  const root = path.join(configPath, 'plugin-config-data');
  const current = path.join(root, 'signalk-wayfinder');
  const legacy = path.join(root, 'signalk-weather-routing');
  fs.mkdirSync(current, { recursive: true });
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(current, 'marker'), 'current');
  fs.writeFileSync(path.join(legacy, 'marker'), 'legacy');

  assert.equal(pluginDataDir({ config: { configPath } } as never), current);
  assert.equal(fs.readFileSync(path.join(current, 'marker'), 'utf8'), 'current');
  assert.equal(fs.readFileSync(path.join(legacy, 'marker'), 'utf8'), 'legacy');
});
