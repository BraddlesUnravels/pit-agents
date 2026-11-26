import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('validates required manifest versions without accepting unknown keys', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pit-validator-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'tools'));
  mkdirSync(join(root, 'example'));
  cpSync(
    join(dirname(fileURLToPath(import.meta.url)), 'validate-repo.ts'),
    join(root, 'tools', 'validate-repo.ts'),
  );
  execFileSync('git', ['init', '-q', root]);
  writeFileSync(
    join(root, 'example', 'example.agent.md'),
    '---\ndescription: Example agent\n---\n',
  );

  const validate = (manifest: object) => {
    writeFileSync(
      join(root, 'example', 'agent.manifest.json'),
      JSON.stringify(manifest),
    );
    return spawnSync(
      process.execPath,
      [join(root, 'tools', 'validate-repo.ts')],
      {
        encoding: 'utf8',
      },
    );
  };

  const valid = validate({ agent: 'example', version: '0.1.0' });
  assert.equal(valid.status, 0, valid.stderr);

  for (const version of [undefined, '', '  ', 1, null]) {
    const invalid = validate({ agent: 'example', version });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /"version" must be a non-empty string/);
  }

  const unknown = validate({ agent: 'example', version: '0.1.0', extra: true });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown manifest key "extra"/);
});
