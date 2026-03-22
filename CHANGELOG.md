# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning as closely as practical for an early local-first tool.

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
