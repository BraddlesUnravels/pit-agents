import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentManifest, WorkerUse } from './types.ts';

type FrontMatterValue = string | boolean | string[];
type IndexEntry = { mode: string; path: string };
type AgentRecord = {
  folder: string;
  path: string;
  manifest: AgentManifest;
  mainFrontMatter: Map<string, FrontMatterValue> | undefined;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors: string[] = [];
const reservedAgentNames = new Set(['skills', 'tools', 'schema', 'docs']);
const namePattern = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]*$/;
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const manifestKeys = new Set([
  'version',
  'agent',
  'workers',
  'skills',
  'scripts',
  'uses',
]);

function report(path: string, message: string): void {
  errors.push(`${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function readIndex(): IndexEntry[] {
  const output = execFileSync('git', ['ls-files', '-s'], {
    cwd: root,
    encoding: 'utf8',
  });

  return output.split('\n').flatMap((line) => {
    const match = /^(\d{6}) [0-9a-f]+ \d\t(.+)$/.exec(line);
    return match ? [{ mode: match[1], path: match[2] }] : [];
  });
}

function parseManifest(path: string): AgentManifest | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report(relative(root, path), `cannot parse manifest: ${message}`);
    return undefined;
  }

  if (!isRecord(parsed)) {
    report(relative(root, path), 'manifest must be a JSON object');
    return undefined;
  }

  for (const key of Object.keys(parsed)) {
    if (!manifestKeys.has(key)) {
      report(relative(root, path), `unknown manifest key "${key}"`);
    }
  }

  if (typeof parsed.version !== 'string' || parsed.version.trim() === '') {
    report(relative(root, path), '"version" must be a non-empty string');
  }
  if (typeof parsed.agent !== 'string') {
    report(relative(root, path), '"agent" must be a string');
  }

  for (const key of ['workers', 'skills', 'scripts'] as const) {
    const value = parsed[key];
    if (value !== undefined && !isStringArray(value)) {
      report(relative(root, path), `"${key}" must be an array of strings`);
      continue;
    }
    if (isStringArray(value) && hasDuplicates(value)) {
      report(relative(root, path), `"${key}" must not contain duplicates`);
    }
  }

  let uses: WorkerUse[] | undefined;
  if (parsed.uses !== undefined) {
    if (!Array.isArray(parsed.uses)) {
      report(relative(root, path), '"uses" must be an array');
    } else {
      const seen = new Set<string>();
      uses = [];
      parsed.uses.forEach((value, index) => {
        const entryPath = `${relative(root, path)}: uses[${index}]`;
        if (!isRecord(value)) {
          report(entryPath, 'must be an object');
          return;
        }
        for (const key of Object.keys(value)) {
          if (key !== 'agent' && key !== 'worker') {
            report(entryPath, `unknown key "${key}"`);
          }
        }
        if (
          typeof value.agent !== 'string' ||
          typeof value.worker !== 'string'
        ) {
          report(entryPath, '"agent" and "worker" must be strings');
          return;
        }
        const signature = JSON.stringify([value.agent, value.worker]);
        if (seen.has(signature)) {
          report(entryPath, 'duplicate worker use');
        }
        seen.add(signature);
        uses?.push({ agent: value.agent, worker: value.worker });
      });
    }
  }

  return {
    version: typeof parsed.version === 'string' ? parsed.version : '',
    agent: typeof parsed.agent === 'string' ? parsed.agent : '',
    workers: isStringArray(parsed.workers) ? parsed.workers : undefined,
    skills: isStringArray(parsed.skills) ? parsed.skills : undefined,
    scripts: isStringArray(parsed.scripts) ? parsed.scripts : undefined,
    uses,
  };
}

function parseList(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return undefined;
  }
  const contents = trimmed.slice(1, -1).trim();
  if (contents === '') {
    return [];
  }

  const items = contents.split(',').map((item) => item.trim());
  if (items.some((item) => item.length === 0)) {
    return undefined;
  }
  return items.map((item) => {
    const quote = item[0];
    if ((quote === "'" || quote === '"') && item.at(-1) === quote) {
      return item.slice(1, -1);
    }
    return item;
  });
}

function parseFrontMatter(
  path: string,
): Map<string, FrontMatterValue> | undefined {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    report(relative(root, path), 'missing YAML front matter');
    return undefined;
  }
  const end = lines.indexOf('---', 1);
  if (end === -1) {
    report(relative(root, path), 'front matter is not closed');
    return undefined;
  }

  const values = new Map<string, FrontMatterValue>();
  for (const [index, rawLine] of lines.slice(1, end).entries()) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/.exec(line);
    if (!match) {
      report(
        `${relative(root, path)}:${index + 2}`,
        'unsupported front matter syntax',
      );
      continue;
    }
    const [, key, rawValue = ''] = match;
    if (values.has(key)) {
      report(
        `${relative(root, path)}:${index + 2}`,
        `duplicate front matter key "${key}"`,
      );
      continue;
    }

    const list = parseList(rawValue);
    if (list !== undefined) {
      values.set(key, list);
    } else if (rawValue === 'true') {
      values.set(key, true);
    } else if (rawValue === 'false') {
      values.set(key, false);
    } else if (rawValue === '|' || rawValue === '>') {
      values.set(key, rawValue);
    } else {
      const quote = rawValue[0];
      const unquoted =
        (quote === "'" || quote === '"') && rawValue.at(-1) === quote
          ? rawValue.slice(1, -1)
          : rawValue;
      values.set(key, unquoted);
    }
  }
  return values;
}

function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}

function walkFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') {
      return [];
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(path);
    }
    return entry.isFile() ? [path] : [];
  });
}

function validateSkills(): Set<string> {
  const skillRoot = join(root, 'skills');
  const skills = new Set<string>();
  if (!existsSync(skillRoot)) {
    return skills;
  }

  for (const entry of readdirSync(skillRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const folder = entry.name;
    const skillPath = join(skillRoot, folder);
    skills.add(folder);
    if (!skillNamePattern.test(folder) || folder.length > 64) {
      report(
        relative(root, skillPath),
        'skill name must be lowercase letters, digits, or hyphens and at most 64 characters',
      );
    }

    const file = join(skillPath, 'SKILL.md');
    if (!isFile(file)) {
      report(relative(root, file), 'required skill file is missing');
      continue;
    }
    const frontMatter = parseFrontMatter(file);
    if (!frontMatter) {
      continue;
    }
    if (frontMatter.get('name') !== folder) {
      report(
        relative(root, file),
        `front matter name must equal skill folder "${folder}"`,
      );
    }
    const description = frontMatter.get('description');
    if (
      typeof description !== 'string' ||
      description.trim() === '' ||
      description === '|' ||
      description === '>'
    ) {
      report(relative(root, file), 'description must be present on one line');
    }
  }
  return skills;
}

function validateAgentFrontMatter(
  path: string,
  isWorker: boolean,
  manifestSkills: string[],
): Map<string, FrontMatterValue> | undefined {
  const frontMatter = parseFrontMatter(path);
  if (!frontMatter) {
    return undefined;
  }
  const description = frontMatter.get('description');
  if (
    typeof description !== 'string' ||
    description.trim() === '' ||
    description === '|' ||
    description === '>'
  ) {
    report(relative(root, path), 'description must be present on one line');
  }
  if (isWorker) {
    if (frontMatter.get('user-invocable') !== false) {
      report(relative(root, path), 'workers must set user-invocable: false');
    }
  } else if (frontMatter.has('user-invocable')) {
    report(relative(root, path), 'main agents must omit user-invocable');
  }

  if (!isWorker) {
    const frontMatterSkills = frontMatter.get('skills');
    if (frontMatterSkills !== undefined && !Array.isArray(frontMatterSkills)) {
      report(relative(root, path), '"skills" front matter must be a list');
    } else {
      const actual = Array.isArray(frontMatterSkills)
        ? [...frontMatterSkills].sort()
        : [];
      const expected = [...manifestSkills].sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        report(
          relative(root, path),
          'front matter skills must match the manifest skills',
        );
      }
    }
  }
  return frontMatter;
}

function validateAgents(
  index: IndexEntry[],
  skillNames: Set<string>,
): AgentRecord[] {
  const records: AgentRecord[] = [];
  const topLevel = readdirSync(root, { withFileTypes: true });

  for (const entry of topLevel) {
    if (!entry.isDirectory()) {
      continue;
    }
    const folder = entry.name;
    const agentPath = join(root, folder);
    const manifestPath = join(agentPath, 'agent.manifest.json');
    if (!isFile(manifestPath)) {
      continue;
    }

    const manifest = parseManifest(manifestPath);
    if (!manifest) {
      continue;
    }
    const manifestRelative = relative(root, manifestPath);
    if (manifest.agent !== folder) {
      report(manifestRelative, `"agent" must equal folder name "${folder}"`);
    }
    if (!namePattern.test(manifest.agent)) {
      report(
        manifestRelative,
        '"agent" does not follow the supported name format',
      );
    }
    if (reservedAgentNames.has(manifest.agent)) {
      report(
        manifestRelative,
        `"${manifest.agent}" is a reserved agent folder name`,
      );
    }
    records.push({
      folder,
      path: agentPath,
      manifest,
      mainFrontMatter: undefined,
    });
  }

  const byName = new Map(
    records.map((record) => [record.manifest.agent, record]),
  );
  const knownAgentFolders = new Set(records.map((record) => record.folder));
  const declaredAgentFiles = new Set<string>();

  for (const record of records) {
    const { path, manifest } = record;
    const manifestRelative = relative(root, join(path, 'agent.manifest.json'));
    const workers = manifest.workers ?? [];
    const skills = manifest.skills ?? [];
    const scripts = manifest.scripts ?? [];

    for (const [field, values] of [
      ['workers', workers],
      ['skills', skills],
    ] as const) {
      for (const value of values) {
        if (!namePattern.test(value)) {
          report(
            manifestRelative,
            `"${field}" entry "${value}" does not follow the supported name format`,
          );
        }
      }
    }
    for (const worker of workers) {
      const workerPath = join(path, `${worker}.agent.md`);
      if (!isFile(workerPath)) {
        report(
          manifestRelative,
          `worker file is missing: ${relative(root, workerPath)}`,
        );
      }
    }
    for (const skill of skills) {
      if (!skillNames.has(skill)) {
        report(
          manifestRelative,
          `listed skill does not exist: skills/${skill}/SKILL.md`,
        );
      }
    }
    for (const script of scripts) {
      if (
        script === '' ||
        script === '.' ||
        script === '..' ||
        script.includes('/') ||
        script.includes('\\')
      ) {
        report(
          manifestRelative,
          `script must be a filename with no subfolders: "${script}"`,
        );
        continue;
      }
      const scriptPath = join(path, 'scripts', script);
      if (!isFile(scriptPath)) {
        report(
          manifestRelative,
          `listed script is missing: ${relative(root, scriptPath)}`,
        );
        continue;
      }
      const entry = index.find(
        (item) => item.path === relative(root, scriptPath),
      );
      if (entry?.mode !== '100755') {
        report(
          relative(root, scriptPath),
          'script must be committed with mode 100755',
        );
      }
    }

    const scriptsPath = join(path, 'scripts');
    if (existsSync(scriptsPath)) {
      for (const entry of readdirSync(scriptsPath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          report(
            relative(root, join(scriptsPath, entry.name)),
            'script folders must not contain subfolders',
          );
        } else if (entry.isFile() && !scripts.includes(entry.name)) {
          report(
            relative(root, join(scriptsPath, entry.name)),
            'script is not listed in the manifest',
          );
        }
      }
    }

    const expectedAgentFiles = new Set([
      `${manifest.agent}.agent.md`,
      ...workers.map((worker) => `${worker}.agent.md`),
    ]);
    for (const fileName of expectedAgentFiles) {
      const filePath = join(path, fileName);
      declaredAgentFiles.add(filePath);
      if (!isFile(filePath)) {
        if (fileName === `${manifest.agent}.agent.md`) {
          report(
            manifestRelative,
            `main agent file is missing: ${relative(root, filePath)}`,
          );
        }
        continue;
      }
      const frontMatter = validateAgentFrontMatter(
        filePath,
        fileName !== `${manifest.agent}.agent.md`,
        skills,
      );
      if (fileName === `${manifest.agent}.agent.md`) {
        record.mainFrontMatter = frontMatter;
      }
    }
  }

  const agentFileNames = new Map<string, string>();
  for (const filePath of walkFiles(root).filter((path) =>
    path.endsWith('.agent.md'),
  )) {
    const fileName = filePath.split(sep).at(-1) ?? filePath;
    const previousPath = agentFileNames.get(fileName);
    if (previousPath) {
      report(
        relative(root, filePath),
        `agent filename collides with ${relative(root, previousPath)}`,
      );
    } else {
      agentFileNames.set(fileName, filePath);
    }
    if (!declaredAgentFiles.has(filePath)) {
      report(
        relative(root, filePath),
        'agent file is not listed as a main agent or worker',
      );
    }
  }

  for (const record of records) {
    for (const use of record.manifest.uses ?? []) {
      if (!namePattern.test(use.agent) || !namePattern.test(use.worker)) {
        report(
          relative(root, join(record.path, 'agent.manifest.json')),
          'uses names do not follow the supported name format',
        );
      }
      if (use.agent === record.manifest.agent) {
        report(
          relative(root, join(record.path, 'agent.manifest.json')),
          'an agent cannot use its own worker',
        );
      }
      const target = byName.get(use.agent);
      if (!target || !(target.manifest.workers ?? []).includes(use.worker)) {
        report(
          relative(root, join(record.path, 'agent.manifest.json')),
          `uses target does not exist or list worker: ${use.agent}/${use.worker}`,
        );
      }
    }

    if ((record.manifest.uses ?? []).length > 0) {
      const tools = record.mainFrontMatter?.get('tools');
      if (!Array.isArray(tools) || !tools.includes('agent')) {
        report(
          relative(
            root,
            join(record.path, `${record.manifest.agent}.agent.md`),
          ),
          'agents using workers must include "agent" in tools',
        );
      }
    }

    const listedScripts = new Set(record.manifest.scripts ?? []);
    for (const agentFile of walkFiles(record.path).filter((file) =>
      file.endsWith('.agent.md'),
    )) {
      const contents = readFileSync(agentFile, 'utf8');
      for (const match of contents.matchAll(
        /\.github\/scripts\/([^\s"'`<>]+)/g,
      )) {
        const target = match[1].replace(/[.,;:!?)}\]]+$/, '');
        const [agentName, scriptName, ...extra] = target.split('/');
        if (
          agentName !== record.manifest.agent ||
          !scriptName ||
          extra.length > 0 ||
          !listedScripts.has(scriptName)
        ) {
          report(
            relative(root, agentFile),
            `script reference is not listed in this agent's manifest: .github/scripts/${target}`,
          );
        }
      }
    }
  }

  const protectedRoots = [...knownAgentFolders, 'skills'];
  for (const entry of index) {
    if (entry.mode !== '120000' && entry.mode !== '160000') {
      continue;
    }
    if (protectedRoots.some((folder) => entry.path.startsWith(`${folder}/`))) {
      report(
        entry.path,
        entry.mode === '120000'
          ? 'symlinks are not allowed in agent or skill folders'
          : 'submodules are not allowed in agent or skill folders',
      );
    }
  }

  return records;
}

const index = readIndex();
const skills = validateSkills();
const agents = validateAgents(index, skills);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`ERROR: ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`OK: ${agents.length} agents, ${skills.size} skills`);
}
