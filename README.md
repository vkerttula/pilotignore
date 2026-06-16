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
> This project is currently in active development and still contain bugs or unhandled edge cases.
>
> AI technologies and their capabilities are evolving rapidly and continuously, meaning new bypass methods could emerge. Use this tool strictly at your own risk. It is a supplementary security layer, not a silver bullet. Always follow best practices for secret management: use secure environment vaults, never commit hardcoded secrets to your repository, and **never expose data to an AI agent that you absolutely cannot afford to leak.** Be the boss of your agent, not the other way around.

> [!TIP]
> **Fun fact:** Some other AI coding assistants already have native, built-in features to prevent the AI from reading specific files. Until GitHub Copilot introduces an official, first-class `.copilotignore` feature, `pilotignore` is here to bridge the gap!

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

```

## What You Get

After initialization, your project will have the following structure:

```text
project-root/
├── .github/
│   └── hooks/
│       └── pilotignore.json   <-- Tells Copilot to run the firewall from node_modules
├── .copilot/
│   └── logs/
│       └── pilotignore.log    <-- Action logs accumulate here (automatically added to your .gitignore!)
├── .pilotignore               <-- Add your sensitive files/folders to this blocklist
└── package.json               <-- pilotignore is installed as a devDependency

```

Simply add your sensitive files to the generated `.pilotignore` file at the root of your project:

```text
# Add files here to hide them from GitHub Copilot
# Examples:
# secrets.json
# .env
# Block from reading this file
.pilotignore

```

Commit the `.pilotignore` file and the generated `.github/hooks/` directory configuration to Git. That's it.

| Target               | Status         | Note                                                                                                |
| -------------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| **Copilot CLI**      | 🛡️ Blocked     | Local commands (`view`, `read_file`) are intercepted.                                               |
| **IDE Chat**         | 🛡️ Blocked     | Agentic workspace reads are stopped at the tool level.                                              |
| **Cloud Agent**      | ⏳ Coming soon | Support for GitHub's secure cloud sandbox (see V2 roadmap).                                         |
| **IDE Autocomplete** | ⏳ Coming soon | Ghost-text autocomplete does not use tools (see V3 roadmap). Already possible with vscode settings. |

## How It Works

1. You install the package and run `npx pilotignore init`.
2. The tool drops an official Copilot Hooks API configuration script into `.github/hooks/pilotignore.json` that points to the local `node_modules` package.
3. When a Copilot Agent tries to run a tool (like `view` to read a file), the `preToolUse` hook fires.
4. If the target file matches an entry in your `.pilotignore`, the hook forcefully returns a `{"permissionDecision": "deny"}` JSON payload and a non-zero exit code.
5. The Agent gracefully backs off. No files read.

> [!IMPORTANT]
> While `pilotignore` blocks native file-reading tools, an extremely determined AI could theoretically write a custom script to read a file and execute it via `bash`. **We block the front door, but complex workarounds are always a possibility with AI.** Use at your own risk, and ensure you understand the limitations of agentic boundaries. This is the closest to native, code-level blocking we've achieved so far — be the boss of your agent, not the other way around.

## Roadmap

- [x] Block Copilot Cloud Agent & CLI tools via `preToolUse` hooks.
- [x] Basic exact-path and glob matching.
- [ ] **V1.1:** Add global installation support (`pilotignore init --global`) for user-level protection across all local repositories.
- [ ] **V2:** Cloud Agent support (syncing hooks to GitHub's secure cloud sandbox).
- [ ] **V2:** Inject `.pilotignore` rules into Copilot Chat's `custom instructions` for double redundancy.
- [ ] **V3:** Sync `.pilotignore` rules to `.vscode/settings.json` to automatically disable IDE ghost-text autocomplete for sensitive files.

## Links

- [GitHub Copilot Hooks Reference](https://docs.github.com/en/copilot/reference/hooks-reference) — the underlying API
- [Issues](https://github.com/vkerttula/pilotignore/issues) — bug, feature, weird behavior

## Star This Repo

`.pilotignore` keeps your secrets secret. Star cost zero. Fair trade. ⭐

## License

MIT
