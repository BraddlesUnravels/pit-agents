# pit-agents

This repository stores Copilot agents, worker agents, scripts, and skills for installation into other projects with `pit`. `pit` clones the configured repository and copies its files as-is; keep this repository's layout and naming rules compatible with `pit`.

Configure the private repository URL once:

```sh
git config --global pit.agentsRepo <url>
```

## Installed files

| In this repository | Installed in the project |
|---|---|
| `<agent>/<x>.agent.md` | `.github/agents/<x>.agent.md` |
| `skills/<skill>/**` | `.github/skills/<skill>/**` |
| `<agent>/scripts/<file>` | `.github/scripts/<agent>/<file>` |

Agent files are installed flat, so every `.agent.md` filename must be unique across the repository. `pit` refuses symlinks and submodules inside agent and skill folders.

## Naming rules

| Item | Rule |
|---|---|
| Agent and worker names | `^[A-Za-z0-9][A-Za-z0-9._-]*$`, with no `..`; use lowercase-hyphen names |
| Agent folder | Must equal `agent` in its manifest; reserved names include `skills`, `tools`, `schema`, and `docs` |
| Main agent file | `<agent>/<agent>.agent.md` |
| Worker file | `<agent>/<worker>.agent.md`, listed in `workers` |
| Skill folder | `skills/<skill>/`; lowercase letters, digits, and hyphens, at most 64 characters |
| Skill entry point | `skills/<skill>/SKILL.md`; front matter `name` must equal the folder name |
| Script | `<agent>/scripts/<file>`, listed in `scripts`; no subfolders and executable |

Every agent manifest uses only the supported keys: `agent`, `workers`, `skills`, `scripts`, and `uses`. The manifest's `agent` is required and must match its folder name.

## Adding an agent

1. Create a top-level folder named for the agent.
2. Add `<agent>/agent.manifest.json` with the matching `agent` name.
3. Add `<agent>/<agent>.agent.md`. Include a one-line `description` in its front matter. If the manifest lists skills, use the same skills in the front matter.
4. For each worker, add `<agent>/<worker>.agent.md`, list its name in `workers`, and set `user-invocable: false`.
5. For each script, add it under `<agent>/scripts/`, list its filename in `scripts`, and make it executable with `chmod +x`.
6. Run `npm run validate` and commit the files. The validator checks committed script modes, so stage the executable files before relying on its result.

Agent front matter supports `name`, `description`, `tools`, `skills`, and `user-invocable`. Use Copilot tool aliases such as `read`, `edit`, `search`, `execute`, `agent`, `web`, and `todo`. Agents that delegate to workers need `agent` in `tools`. Refer to scripts by their installed paths, such as `.github/scripts/<agent>/<file>`.

## Adding a skill

1. Create `skills/<skill>/SKILL.md`.
2. Add front matter with `name` equal to the folder name and a one-line `description`.
3. Put any supporting files beside `SKILL.md`; reference them relative to that file.
4. Run `npm run validate` and commit the skill. Skills can be installed independently with `pit skill add <name>`.

## Sharing workers

An agent can declare a borrowed worker in `uses`, identifying the agent that owns it and the worker name. `pit` uses this declaration to offer related agents during installation and warn before removal. The request/reply protocol is an agreement described in the agents' instructions: `pit` and Copilot do not enforce it. Test the agreement before depending on it, and use identical field names on both sides.

## Validation

Run `npm run validate` before committing. The validator checks manifests, agent and skill files, references, unique agent filenames, and committed executable script modes.
