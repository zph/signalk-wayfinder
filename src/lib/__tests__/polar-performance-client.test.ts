import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as nodepath from 'node:path';
import test from 'node:test';

import {
  loadActivePolarPerformance,
  loadLocalActivePolarPerformance,
  polarPerformanceBaseUrl,
} from '../polar-performance-client';

const canonical = {
  id: 'boat / fast',
  name: 'Fast Boat',
  kind: 'polarTable',
  schemaVersion: '1.0.0',
  units: { tws: 'm/s', twa: 'rad', boatSpeed: 'm/s' },
  symmetry: { portStarboardSymmetric: true },
  axes: { tws: [5, 10], twa: [Math.PI / 4, Math.PI / 2] },
  values: {
    boatSpeedMatrix: [
      [2, 3],
      [4, 5],
    ],
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('loads the active canonical polar and converts SI axes, matrix orientation, and adjustment', async () => {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith('/polars/active')) return jsonResponse({ id: 'boat / fast' });
    if (url.endsWith('/settings')) return jsonResponse({ perfAdjust: 0.9 });
    if (url.endsWith('/polars/boat%20%2F%20fast')) return jsonResponse(canonical);
    return jsonResponse({ error: 'not found' }, 404);
  }) as typeof fetch;

  const loaded = await loadActivePolarPerformance('http://127.0.0.1:3000/plugins/signalk-polar-performance-plugin/', {
    fetchImpl,
  });

  assert.equal(loaded.id, 'boat / fast');
  assert.equal(loaded.name, 'Fast Boat');
  assert.equal(loaded.performanceAdjustment, 0.9);
  assert.deepEqual(loaded.polar.twa.map(Math.round), [45, 90]);
  assert.deepEqual(
    loaded.polar.tws.map((value) => Number(value.toFixed(3))),
    [9.719, 19.438],
  );
  assert.deepEqual(
    loaded.polar.speeds.map((row) => row.map((value) => Number(value.toFixed(3)))),
    [
      [3.499, 6.998],
      [5.248, 8.747],
    ],
  );
  assert(requested.some((url) => url.endsWith('/polars/boat%20%2F%20fast')));
});

test('loads the active polar directly from the sibling plugin data directory', async (t) => {
  const configPath = await fs.mkdtemp(nodepath.join(os.tmpdir(), 'wayfinder-polar-performance-'));
  t.after(() => fs.rm(configPath, { recursive: true, force: true }));
  const pluginConfigDir = nodepath.join(configPath, 'plugin-config-data');
  const polarDir = nodepath.join(pluginConfigDir, 'signalk-polar-performance-plugin');
  await fs.mkdir(polarDir, { recursive: true });
  await fs.writeFile(
    nodepath.join(pluginConfigDir, 'signalk-polar-performance-plugin.json'),
    JSON.stringify({ enabled: true, configuration: { activePolar: 'local-boat', perfAdjust: 0.8 } }),
  );
  await fs.writeFile(nodepath.join(polarDir, 'local-boat.json'), JSON.stringify({ ...canonical, id: 'local-boat' }));

  const loaded = await loadLocalActivePolarPerformance(configPath);

  assert.equal(loaded.id, 'local-boat');
  assert.equal(loaded.performanceAdjustment, 0.8);
  assert.equal(Number(loaded.polar.speeds[0][0].toFixed(3)), 3.11);
});

test('fails closed when the installed sibling plugin is disabled', async (t) => {
  const configPath = await fs.mkdtemp(nodepath.join(os.tmpdir(), 'wayfinder-polar-disabled-'));
  t.after(() => fs.rm(configPath, { recursive: true, force: true }));
  const pluginConfigDir = nodepath.join(configPath, 'plugin-config-data');
  await fs.mkdir(pluginConfigDir, { recursive: true });
  await fs.writeFile(
    nodepath.join(pluginConfigDir, 'signalk-polar-performance-plugin.json'),
    JSON.stringify({ enabled: false, configuration: { activePolar: 'local-boat' } }),
  );

  await assert.rejects(loadLocalActivePolarPerformance(configPath), /Polar Performance is not enabled/);
});

test('discovers the local Signal K port and accepts an explicit API override', () => {
  assert.equal(
    polarPerformanceBaseUrl({ config: { port: 3443 } } as never),
    'http://127.0.0.1:3443/plugins/signalk-polar-performance-plugin',
  );
  assert.equal(
    polarPerformanceBaseUrl({} as never, 'https://signalk.example/plugins/signalk-polar-performance-plugin/'),
    'https://signalk.example/plugins/signalk-polar-performance-plugin',
  );
});

test('fails clearly when Polar Performance has no active polar', async () => {
  const fetchImpl = (async () => jsonResponse({ error: 'No polar is currently active' }, 404)) as typeof fetch;
  await assert.rejects(
    loadActivePolarPerformance('http://127.0.0.1:3000/plugins/signalk-polar-performance-plugin', { fetchImpl }),
    /Active Polar Performance polar request failed with HTTP 404: No polar is currently active/,
  );
});

test('rejects malformed canonical matrices', async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/polars/active')) return jsonResponse({ id: 'broken' });
    if (url.endsWith('/settings')) return jsonResponse({ perfAdjust: 1 });
    return jsonResponse({ ...canonical, values: { boatSpeedMatrix: [[2]] } });
  }) as typeof fetch;
  await assert.rejects(
    loadActivePolarPerformance('http://127.0.0.1:3000/plugins/signalk-polar-performance-plugin', { fetchImpl }),
    /boat-speed matrix does not match its axes/,
  );
});

test('rejects unsorted axes before routing interpolation', async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/polars/active')) return jsonResponse({ id: 'broken' });
    if (url.endsWith('/settings')) return jsonResponse({ perfAdjust: 1 });
    return jsonResponse({ ...canonical, axes: { ...canonical.axes, tws: [10, 5] } });
  }) as typeof fetch;
  await assert.rejects(
    loadActivePolarPerformance('http://127.0.0.1:3000/plugins/signalk-polar-performance-plugin', { fetchImpl }),
    /axes must be sorted/,
  );
});
