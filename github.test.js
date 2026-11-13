const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('deployment polling skips unchanged images, deploys updates, and respects its lock', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-deploy-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(dir, '.env'), 'BLOG_ADMIN_KEY=test-only\n');
    fs.writeFileSync(path.join(dir, 'blog.db'), 'existing data');
    // Model the Docker boundary without touching containers or the registry.
    fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash
echo "$*" >> "$CALLS"
case "$1 $2" in
  'pull '*) exit "$PULL_STATUS" ;;
  'image inspect') echo sha256:new ;;
  'container inspect') exit 0 ;;
  'inspect --format')
    case "$3" in
      '{{.Image}}') echo "$CURRENT_IMAGE" ;;
      '{{.State.Running}}') echo "$RUNNING" ;;
    esac ;;
esac
`, { mode: 0o755 });
    // Avoid chown in the real deployment script; the fixture directory exists.
    fs.writeFileSync(path.join(bin, 'install'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DATA_DIR: dir,
      ENV_FILE: path.join(dir, '.env'), CALLS: path.join(dir, 'calls'),
      CURRENT_IMAGE: 'sha256:new', RUNNING: 'true', PULL_STATUS: '0' };
    const script = path.join(__dirname, 'github.sh');
    const run = (overrides = {}, locked = false) => {
      fs.writeFileSync(env.CALLS, '');
      const result = locked
        ? spawnSync('flock', [path.join(dir, 'deploy.lock'), 'bash', script], { env: { ...env, ...overrides }, encoding: 'utf8' })
        : spawnSync('bash', [script], { env: { ...env, ...overrides }, encoding: 'utf8' });
      return { ...result, calls: fs.readFileSync(env.CALLS, 'utf8') };
    };
    const unchanged = run();
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.match(unchanged.stdout, /no deployment needed/);
    assert.doesNotMatch(unchanged.calls, /^(stop|rm|run) /m);
    const changed = run({ CURRENT_IMAGE: 'sha256:old' });
    assert.equal(changed.status, 0, changed.stderr);
    assert.match(changed.calls, /^stop /m);
    assert.match(changed.calls, /^run .* sha256:new$/m);
    assert.match(changed.stdout, /Deployment complete/);
    const stopped = run({ RUNNING: 'false' });
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.match(stopped.calls, /^run /m);
    const failedPull = run({ PULL_STATUS: '1' });
    assert.notEqual(failedPull.status, 0);
    assert.doesNotMatch(failedPull.calls, /^(stop|rm|run) /m);
    const locked = run({}, true);
    assert.equal(locked.status, 0, locked.stderr);
    assert.match(locked.stdout, /already running/);
    assert.equal(locked.calls, '');
    assert.equal(fs.readFileSync(path.join(dir, 'blog.db'), 'utf8'), 'existing data');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
