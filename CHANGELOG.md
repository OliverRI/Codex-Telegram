# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning as closely as practical for an early local-first tool.

## [Unreleased]

### Added

- Telegram attachment delivery for files explicitly requested by the user
- Attachment safety checks that restrict sending to files inside the agent working scope
- Prompt guidance so agents can declare attachments using a dedicated bridge block
- Agent-to-agent handoff orchestration with optional return to the source agent
- Windows batch script to rebuild, re-register autostart, and restart the bridge service in one step, with fallback to the user's Startup folder when scheduled tasks are blocked
- Local skill activation from Telegram with per-agent allowlists and installed-skill discovery
- Plugin skill discovery for Codex-installed integrations such as Gmail and Google Drive
- `CODEX_TRANSPORT` setting with `app-server` support as the primary runtime for native local-skill execution
- Local Gmail web-session bootstrap script for the bridge (`npm run auth:gmail`)
- Native Gmail read-only context loading through the user's persisted browser session when `permissions.gmailAccess=true`
- Native Gmail send action through the user's persisted local browser session
- Bridge process shutdown script so restarts replace stale Windows instances cleanly

### Improved

- Documentation for file delivery through Telegram
- Documentation for agent delegation through the bridge
- Documentation for working with one main coordinator agent and specialist agents
- Telegram command UX in Spanish with softer, assistant-style responses while keeping English aliases for compatibility
- Telegram command support for listing and invoking Codex skills in Spanish
- Runtime architecture so Telegram executions can use native local skills through `codex app-server`
- Bridge error handling for connector-backed skills like Gmail and Google Drive so the bot explains the real runtime limitation instead of claiming they are simply disabled
- Gmail prompts so they now use real web-session context from the bridge instead of falling back to fake plugin availability
- Windows execution routing so trusted agents can fall back to `codex exec` for local shell and file tasks when `app-server` is weaker on Windows
- Gmail setup flow in the README so linking Gmail is a local browser-session step instead of an OAuth/Google Cloud flow
- Telegram output so the harmless PowerShell `shell snapshot` warning no longer appears to the user

## [0.1.0] - 2026-03-23

### Added

- Initial Telegram-to-Codex bridge in TypeScript for Windows
- Telegram commands for agent listing, status, execution, and last-run inspection
- Per-agent queueing and persisted local state for jobs and thread ids
- Configurable agent registry with per-agent access control
- Windows startup-task scripts for unattended bridge execution
- Private local agent configuration pattern using `config/agents.local.json`
- MIT license
- Codex skill in `skills/telegram-codex-bridge`
- Release notes for `v0.1.0`

### Notes

- This release targets local Windows usage with a locally installed and authenticated Codex CLI
- The bridge currently uses `codex exec` and `codex exec resume`
