---
name: telegram-codex-bridge
description: Install, configure, validate, and operate the local Telegram-to-Codex bridge in this repository. Use when Codex needs to set up `.env`, create or update `config/agents.local.json`, verify `codex` access, build the project, register the Windows startup task, troubleshoot bridge startup failures, or safely adjust agent configuration without exposing private tokens or private agent definitions to Git.
---

# Telegram Codex Bridge

Use this skill to operate the local bridge in this repository without leaking private configuration into Git.

## Workflow

1. Read the current repo files that drive setup:
   - [`.env.example`](../../.env.example)
   - [`config/agents.example.json`](../../config/agents.example.json)
   - [`package.json`](../../package.json)
   - [`README.md`](../../README.md)
2. Keep secrets and private agents local:
   - Store runtime secrets only in `.env`
   - Store real agents only in `config/agents.local.json`
   - Never write private tokens or real agent definitions into tracked example files
3. Validate before changing behavior:
   - Confirm `node` is available
   - Confirm `codex` is available or use the configured `CODEX_BIN`
   - Run `npm run check` or `npm run build` after substantive changes
4. Use the repo scripts for Windows operations:
   - [`scripts/install-startup-task.ps1`](../../scripts/install-startup-task.ps1)
   - [`scripts/start-bridge.ps1`](../../scripts/start-bridge.ps1)
   - [`scripts/uninstall-startup-task.ps1`](../../scripts/uninstall-startup-task.ps1)
5. Prefer the smallest safe config change:
   - Adjust `allowedTelegramUserIds` and `allowedChatIds` narrowly
   - Use `read-only` agents for review-only tasks
   - Use `workspace-write` only for repo-scoped working directories

## Setup Tasks

When asked to install or configure the bridge:

1. Create `.env` from `.env.example` if it does not exist.
2. Create `config/agents.local.json` from `config/agents.example.json` if it does not exist.
3. Fill in only the values the user actually needs:
   - `TELEGRAM_BOT_TOKEN`
   - `ALLOWED_TELEGRAM_USER_IDS`
   - `ALLOWED_TELEGRAM_CHAT_IDS` when needed
   - `CODEX_BIN` if the default `codex` path is not enough
4. Ensure `.env` points to `AGENTS_FILE=./config/agents.local.json`.
5. Keep `config/agents.json` empty or example-only.

## Agent Configuration Rules

- Keep `id` short and command-friendly.
- Use absolute Windows paths for `cwd`.
- Set `skipGitRepoCheck` to `false` for normal repos and `true` only for non-repo folders.
- Use `forceNewThreadOnEachRun`:
  - `false` when the agent should preserve conversation memory
  - `true` when each run should be isolated
- Keep `extraArgs` empty unless there is a specific Codex CLI need.

## Troubleshooting

If startup fails:

- JSON parse errors: inspect `config/agents.local.json` for invalid escapes like single backslashes.
- Trusted directory errors: set `skipGitRepoCheck` correctly for that agent.
- PowerShell script-policy issues: use `codex.cmd` or the included task scripts with `-ExecutionPolicy Bypass`.
- No Telegram response: verify the bot token and run `/whoami` and `/agents`.
- Task scheduler issues: inspect `logs/bridge.stdout.log` and `logs/bridge.stderr.log`.

## Git Safety

- Do not commit `.env`.
- Do not commit `config/agents.local.json`.
- If a private agent config accidentally enters tracked history, replace the public file with an example-safe version and coordinate a history rewrite only if explicitly requested.
