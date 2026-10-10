# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-10-10

A rewrite of the rule engine and hook, plus a `verify` command and a test setup for trying pilotignore with a real Copilot agent.

### Upgrading from 0.1.x

1. Update the package and **re-run `npx pilotignore init`**. The hook script in `.github/hooks/` is a copy and won't update otherwise. Your `.pilotignore` is left untouched.
2. **Check rules that contain a `/`.** These are now anchored to the project root, as in `.gitignore` (see *Changed*). To keep matching at any depth, prefix them with `**/`, e.g. `config/secrets.json` → `**/config/secrets.json`.
3. **Add the new self-protection rules** to your existing `.pilotignore`. New installs get them by default, but `init` never edits an existing file:
   ```text
   .pilotignore
   .github/hooks/pilotignore.cjs
   .github/hooks/pilotignore.json
   ```
4. Run `npx pilotignore verify` to confirm everything works.

### Changed

- **Rules follow `.gitignore` semantics.** Previously a rule matched by plain path comparison (exact path, path prefix, or path suffix). Now:
  - A rule with a `/` anywhere in it is **anchored to the project root**. `config/secrets.json` no longer matches `nested/config/secrets.json`; use `**/config/secrets.json` for that. **This can change what an existing rule blocks.**
  - A rule without a `/` matches that name at any depth, as before.
  - The last matching rule wins, so `!` negations can re-allow paths.
- **Allowed tool calls produce no output.** 0.1.x printed an explicit `allow` decision, which could auto-approve tool calls and skip Copilot's own approval prompts. The hook now stays silent unless it denies, so Copilot's normal permission flow applies. pilotignore only ever takes permissions away.
- **Errors fail closed.** If the hook can't evaluate a call (malformed or empty payload, unreadable `.pilotignore`, unexpected error), the call is now denied instead of allowed. This matches how Copilot treats a failing `preToolUse` hook.
- **Shell commands are scanned.** Paths inside shell commands are now checked as well, so `cat .env` is denied like a file read. A command that only *mentions* a blocked name (e.g. `git commit -m "fix .env"`) is denied too.
- **Deny reasons name the path and rule**, e.g. `Access to '.env' is blocked by .pilotignore rule '.env'.` Previously the reason was a generic message.
- **The default `.pilotignore` protects pilotignore itself.** New installs block reading or changing `.pilotignore` and the two hook files, and include a commented pattern-syntax reference.
- **Package layout:** the hook moved from `templates/pilotignore.cjs` to `src/pilotignore.cjs`, and the templates to `src/templates/`. Installed files in your project keep their names and locations.
- **Node.js >= 18** is now declared in `engines`.
- The package description and README now describe pilotignore as a tool-call filter rather than a complete secrets boundary.

### Added

- **`.gitignore`-style patterns:** `*`, `**`, `?`, `[abc]` / `[!abc]` character classes, `!` negation, leading `/` anchoring, trailing `/` directory-only rules, `\` escapes. Matching stays case-insensitive.
- **Shell glob expansion:** a token like `shop*`, `*.tx?` or `[s]ecret.json` is expanded against the filesystem, so `cat shop*` is denied when it would match a blocked file.
- **Directory protection:** commands on a directory that contains a blocked path are denied, e.g. `rm -rf .github` or `ls private`. Anchored rules protect their parent directories even before the file exists. The project root is exempt so ordinary commands keep working. Scans stop after 5,000 entries to stay well within the hook timeout.
- **More path sources:** `~/` home paths, Windows-style `\` separators, paths outside the project (`../…`), `tool_input_as_string` payloads, and command-style fields (`command`, `args`, `script`, …) in any payload shape.
- **Both hook output formats:** deny decisions are emitted as flat fields for Copilot CLI and inside `hookSpecificOutput` for VS Code. Copilot CLI now shows the deny reason; in 0.1.x it reported that no reason was given.
- **Cloud-agent-ready hook config:** the cross-platform `command` field was added next to `bash` / `powershell` in `.github/hooks/pilotignore.json`. Cloud agent support is untested.
- **`pilotignore verify`:** checks the hook config, hook script and rules, then fires real hook calls using your own rules. A read and a `cat` of a blocked path must be denied, and an unrelated path must be allowed.
- **`pilotignore help`** and usage output for unknown commands.
- **Clearer logs:** the log records each matched path and rule, and silent allows.
- **Docs:** pattern-syntax reference, per-surface support table, *Good to know* section on what tool-call filtering can't cover (content search, workspace index, open files, indirect reads) and how to cover it, design decisions, troubleshooting, uninstall, and a [testing guide](tests/README.md).
- **Development tooling:**
  - `npm run smoke` packs the package, installs the tarball into a scratch project and exercises `init`, the hook and `verify`.
  - `npm run sandbox` creates *recipe-box*, a realistic demo project for hands-on testing with Copilot Chat and Copilot CLI.
  - The automated test suite grew from 10 to 28 tests.

### Fixed

- Rules with a leading `/` (e.g. `/config.json`) never matched in 0.1.x. They now match at the project root.
- `npm test` failed on Node.js 22 because `tests/` was passed as a module path.
- The repository's `.gitignore` referenced a non-existent `pilotignore.js` instead of `pilotignore.cjs`.
- `package-lock.json` still listed version 0.1.0.

### Removed

- Screenshots in the README, replaced with text examples.

### Known limitations

These are documented in the README under *Good to know*:

- Content searches such as `grep -r term .` can return lines from blocked files.
- The VS Code workspace index, open editor files and inline suggestions don't go through tool calls.
- Paths built at runtime by scripts or interpreters aren't recognized.
- Copilot skips hooks that time out (fail-open). This is Copilot's behavior.

## [0.1.2] and earlier

Initial releases: `pilotignore init`, a `preToolUse` hook with exact-path and folder matching, logging to `.copilot/logs/`, and `.gitignore` setup.

[0.2.0]: https://github.com/vkerttula/pilotignore/compare/9c335f9...v0.2.0
[0.1.2]: https://github.com/vkerttula/pilotignore/commit/9c335f9
