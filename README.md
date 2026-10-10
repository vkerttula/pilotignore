<p align="center">
  <img src="https://raw.githubusercontent.com/vkerttula/pilotignore/main/assets/logo.svg" alt="pilotignore logo" width="120" height="156">
</p>

</p>

<h1 align="center">

`.pilotignore` — keep your secrets secret

</h1>

<p align="center">
  <strong>like <code>.gitignore</code>, but for github copilot agents</strong>
</p>

> [!WARNING]
>
> **EARLY DEVELOPMENT/EXPERIMENTAL PHASE. USE AT YOUR OWN RISK.**
>
> This project is currently in active development and may still contain bugs or unhandled edge cases.
>
> AI technologies and their capabilities are evolving rapidly and continuously, meaning new bypass methods could emerge. Use this tool strictly at your own risk. It is a supplementary security layer, not a silver bullet. Always follow best practices for secret management: use secure environment vaults, never commit hardcoded secrets to your repository, and **never expose data to an AI agent that you absolutely cannot afford to leak.** Be the boss of your agent, not the other way around.

> [!TIP]
> **Fun fact:** VS Code Copilot Chat now ships an official `.copilotignore` implementation — but it governs suggestions and chat context, not agent-mode tool reads, and Copilot CLI has no equivalent yet. Until GitHub's native coverage extends to agentic tool calls, `pilotignore` is here to bridge the gap!

GitHub Copilot Cloud Agent and CLI are powerful tools that can navigate your codebase, read files, and execute commands. But sometimes, they shouldn't see everything. `pilotignore` is a lightweight CLI that sets up a programmatic firewall — actively blocking AI agents from reading `.env` files, API keys, or private configs.

One tool. One philosophy: **Agent boundaries should be simple.**

<p align="center">
  <a href="https://www.npmjs.com/package/pilotignore"><img src="https://img.shields.io/npm/v/pilotignore?style=flat&color=000000" alt="NPM Version"></a>
  <a href="https://www.npmjs.com/package/pilotignore"><img src="https://img.shields.io/npm/dt/pilotignore?style=flat&color=000000" alt="Downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/vkerttula/pilotignore?style=flat&color=000000" alt="License"></a>
</p>

## Table of Contents

<p align="center">
  <a href="#before--after">Before/After</a> •
  <a href="#install">Install</a> •
  <a href="#what-you-get">What You Get</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#security-model--design-decisions">Security Model</a> •
  <a href="#roadmap">Roadmap</a>
</p>

---

## Before / After

### 🔓 Normal Copilot Agent

> **You:** "What is the database password inside config/secrets.json?"
> **Copilot:** "Looking at your `config/secrets.json` file, the database password is `super_secret_p4ssw0rd`. I can help you rotate this if you need!"

### 🛡️ Copilot + pilotignore

> **You:** "What is the database password inside config/secrets.json?"
> **Copilot:** "I'm sorry, I cannot access `config/secrets.json` because my file-reading tool was denied by your `.pilotignore` rules."

<p align="center">
  <img src="https://raw.githubusercontent.com/vkerttula/pilotignore/main/assets/copilot-vscode.png" alt="Copilot VS Code Chat blocked" width="49%">
  &nbsp;
  <img src="https://raw.githubusercontent.com/vkerttula/pilotignore/main/assets/copilot-cli.png" alt="Copilot CLI blocked" width="49%">
</p>

**Same agent. 0% leaked secrets. Peace of mind.**

## Install

Install `pilotignore` as a development dependency. This ensures your project is locked to a specific version and makes updates seamless.

```bash
# 1. Install the package
npm install -D pilotignore

# 2. Initialize the hooks and .pilotignore file
npx pilotignore init

# 3. Confirm the firewall actually works in your project
npx pilotignore verify

```

## What You Get

After initialization, your project will have the following structure:

```text
project-root/
├── .github/
│   └── hooks/
│       ├── pilotignore.json   <-- Tells Copilot to run the firewall before every tool call
│       └── pilotignore.cjs    <-- The firewall itself (re-run `init` after upgrading)
├── .copilot/
│   └── logs/
│       └── pilotignore.log    <-- Action logs accumulate here (automatically added to your .gitignore!)
├── .pilotignore               <-- Add your sensitive files/folders to this blocklist
└── package.json               <-- pilotignore is installed as a devDependency

```

Simply add your sensitive files to the generated `.pilotignore` file at the root of your project. The syntax follows `.gitignore` conventions — globs, directory rules, root anchoring and `!` negations all work:

```text
# Add files here to hide them from GitHub Copilot
# Supports gitignore-style patterns:
#   .env                  exact file, matched at any depth
#   *.pem                 wildcard: any file ending in .pem
#   .env*                 .env, .env.local, .env.production, ...
#   secrets/              everything under any secrets/ directory
#   /config.json          anchored to the project root only
#   secrets/**            everything under root secrets/
#   !secrets/public.txt   negation: allow an exception
# Protect the blocklist itself — prevents the agent from reading
# the ruleset or disabling protection by editing/removing it
.pilotignore
# Protect the firewall files for the same reason
.github/hooks/pilotignore.cjs
.github/hooks/pilotignore.json

```

Commit the `.pilotignore` file and the generated `.github/hooks/` directory configuration to Git. That's it.

## Verify It Works

Run `npx pilotignore verify` in any project where pilotignore is installed. It checks that the hook config and firewall script are in place, then fires real `preToolUse` payloads at the installed hook using **your actual rules**:

```text
pilotignore verify

  ✓ .github/hooks/pilotignore.json — valid preToolUse hook config
  ✓ .github/hooks/pilotignore.cjs — firewall script present
  ✓ .pilotignore — 4 blocking rule(s) loaded
  ✓ view ".env" (rule ".env") → denied
  ✓ bash "cat .env" → denied
  ✓ view "pilotignore-verify-probe" → allowed (no output, Copilot's normal permission flow applies)

✅ All checks passed.
```

Every real hook decision — including the candidate paths Copilot actually sends — is logged to `.copilot/logs/pilotignore.log`. If a deny doesn't fire when you expect it to, that log is the first place to look.

Want to see it block a real agent first? [`tests/README.md`](tests/README.md) walks you through a ready-made demo project and test prompts for VS Code and Copilot CLI.

| Target               | Status         | Note                                                                                             |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| **Copilot CLI**      | 🛡️ Blocked     | Local commands (`view`, `read_file`) are intercepted.                                            |
| **IDE Chat**         | 🛡️ Blocked     | Agentic workspace reads are stopped at the tool level.                                           |
| **Cloud Agent**      | ⏳ Coming soon | Support for GitHub's secure cloud sandbox (see roadmap).                                         |
| **IDE Autocomplete** | ⏳ Coming soon | Ghost-text autocomplete does not use tools (see roadmap). Already possible with vscode settings. |

## How It Works

1. You install the package and run `npx pilotignore init`.
2. The tool writes an official Copilot Hooks API configuration (`.github/hooks/pilotignore.json`) and the firewall script it runs (`.github/hooks/pilotignore.cjs`).
3. When a Copilot Agent tries to run a tool (like `view` to read a file, or `bash` to run a command), the `preToolUse` hook fires.
4. If any path in the tool call matches your `.pilotignore`, the hook returns a `deny` decision with a reason naming the matched rule (exit code `2` for Copilot CLI, `0` for VS Code Chat).
5. The Agent backs off and tells you which rule blocked it. No files read.

## Security Model & Design Decisions

These are deliberate choices. Each one favors blocking over leaking.

- **Fail-closed.** If the hook cannot evaluate a tool call (malformed or empty payload, unreadable `.pilotignore`, unexpected error), the call is **denied**. This matches Copilot's own behavior for command `preToolUse` hooks, which fail closed on crashes and non-zero exits. One exception is Copilot's and can't be changed by pilotignore: **hook timeouts fail open**. The hook is designed to finish far inside its 5-second `timeoutSec`.
- **Allow is silent.** When nothing matches, the hook prints nothing and exits `0`. It never emits an explicit `allow`, because that could auto-approve tool calls and skip Copilot's normal approval prompts and tool rules. pilotignore only ever *narrows* what the agent may do.
- **Shell commands are scanned token by token.** `cat .env`, `head -n 5 .env && …` and `ENV_FILE=.env npm start` are denied just like file-reading tools.
- **Shell globs are expanded against the filesystem.** `cat shop*`, `cat *.tx?` or `cat [s]ecrets.json` are judged by the files the shell would actually pass. Dotfiles are included, which is stricter than bash.
- **Directories that contain blocked paths are protected.** `rm -rf .github` or `ls journal` is denied when a blocked path lives inside. Anchored rules (`/a/b.txt`) protect their parent directories even if the file doesn't exist yet. Scans stop after 5,000 entries per directory to stay fast.
- **The ruleset protects itself.** The default `.pilotignore` blocks `.pilotignore` and the two hook files, so the agent can't read the rules, edit them, or delete the firewall.
- **Deny reasons name the rule.** The agent (and you) can see exactly why a call was blocked. The rules aren't secret: a deny always reveals which rule matched.
- **Conservative false positives.** A command that merely *mentions* a blocked name is denied too, e.g. `git commit -m "fix .env"` or `git add .pilotignore`. Commit changes to your ruleset yourself.

### Known limitations

- **The project root is exempt** from directory protection, otherwise `ls .` and nearly every command would be denied. Recursive operations on the root, like `grep -r password .`, are therefore **not** blocked.
- **Interpreters and obfuscation** aren't caught. For example `python3 -c "open('se'+'crets.json').read()"`, base64-encoded paths, or a script the agent writes and then runs.
- **Directories outside the project** only get direct-match and anchored-rule checks, not filesystem scans.
- **Timeouts fail open** (Copilot's behavior, see above).

> [!IMPORTANT]
> **A determined AI could still obfuscate or script its way around the rules.** pilotignore blocks the front door, not every window. Use at your own risk, and ensure you understand the limitations of agentic boundaries. Be the boss of your agent, not the other way around.

## Roadmap

- [x] Block Copilot CLI & IDE agent tools via `preToolUse` hooks.
- [x] Basic exact-path and folder-level matching.
- [x] **v0.2.0:** Full gitignore-style pattern matching (`*`, `**`, `?`, `!`, `/` anchoring), shell command scanning with glob expansion, directory protection, fail-closed evaluation and `pilotignore verify`.
- [ ] **v0.3.0:** Add global installation support (`pilotignore init --global`) writing to the official user-level hooks directory (`~/.copilot/hooks/`).
- [ ] **v1.0.0:** Cloud Agent support (syncing hooks to GitHub's secure cloud sandbox).
- [ ] **v1.0.0:** Inject `.pilotignore` rules into Copilot Chat's `custom instructions` to prevent AI from using alternative terminal workarounds (e.g. `cat`).
- [ ] **v2.0.0:** Sync `.pilotignore` rules to `.vscode/settings.json` to automatically disable IDE ghost-text autocomplete for sensitive files.

## Development

```text
bin/cli.js            CLI: `init` and `verify`
src/pilotignore.cjs   the firewall hook (copied into projects by `init`)
src/templates/        hook config and default .pilotignore
tests/                automated tests, smoke test and the sandbox demo project
assets/               images used in this README
```

`npm test` runs the test suite. See [`tests/README.md`](tests/README.md) for the smoke test and manual testing with Copilot.

## Links

- [GitHub Copilot Hooks Reference](https://docs.github.com/en/copilot/reference/hooks-reference) — the underlying API
- [Issues](https://github.com/vkerttula/pilotignore/issues) — bug, feature, weird behavior

## Star This Repo

`.pilotignore` keeps your secrets secret. Star cost zero. Fair trade. ⭐

## License

MIT
