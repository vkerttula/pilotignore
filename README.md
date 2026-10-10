<p align="center">
  <img src="https://raw.githubusercontent.com/vkerttula/pilotignore/main/assets/logo.svg" alt="pilotignore logo" width="120" height="156">
</p>

<h1 align="center">

`.pilotignore`

</h1>

<p align="center">
  <strong>like <code>.gitignore</code>, but for GitHub Copilot agents</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pilotignore"><img src="https://img.shields.io/npm/v/pilotignore?style=flat&color=000000" alt="NPM Version"></a>
  <a href="https://www.npmjs.com/package/pilotignore"><img src="https://img.shields.io/npm/dt/pilotignore?style=flat&color=000000" alt="Downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/vkerttula/pilotignore?style=flat&color=000000" alt="License"></a>
</p>

Copilot agents read files and run commands in your project. `pilotignore` lets you list the files they should leave alone. It installs a Copilot `preToolUse` hook that checks every tool call before it runs and denies the ones that touch a path in your `.pilotignore`. Everything else works exactly as before.

It's a small, zero-dependency tool for keeping an agent out of files it has no business opening: personal notes, local configs, drafts, generated data. It filters tool calls; it doesn't control everything Copilot can see (see [Good to know](#good-to-know)).

## Quick start

```bash
npm install -D pilotignore
npx pilotignore init      # adds the hook and a .pilotignore file
npx pilotignore verify    # checks that blocking actually works
```

Add paths to `.pilotignore`, then commit it together with `.github/hooks/`.

## Try it first

Want to see it block a real agent before adding it to your project?

```bash
git clone https://github.com/vkerttula/pilotignore && cd pilotignore
npm run sandbox
```

This creates a small demo project with pilotignore installed. Open it in VS Code or Copilot CLI and follow the test prompts in [`tests/README.md`](tests/README.md#test-prompts).

## Writing rules

`.pilotignore` uses `.gitignore` syntax:

```text
.env                   # this name, at any depth
*.pem                  # any file ending in .pem
.env*                  # .env, .env.local, .env.production, ...
/config.json           # only at the project root
private/               # everything under any private/ directory
notes/**               # everything under the root notes/
!notes/public.md       # ...except this file
```

Matching is case-insensitive. The default `.pilotignore` also lists itself and the hook files, so the agent can't read the rules, change them, or remove the hook.

## What it looks like

When the agent tries to open a blocked file, the hook denies the tool call and tells the agent why. In Copilot CLI (abbreviated):

```text
● Read shopping-list.txt
  Denied by preToolUse hook: Access to 'shopping-list.txt' is blocked by
  .pilotignore rule 'shopping-list.txt'.
```

Shell commands are checked too, including globs and directories:

```text
$ cat shop*            → denied (shopping-list.txt)
$ rm -rf .github       → denied (contains .github/hooks/pilotignore.cjs)
$ npm start            → allowed, Copilot asks for approval as usual
```

Every decision is logged to `.copilot/logs/pilotignore.log`, which `init` adds to your `.gitignore`:

```text
[2026-10-10T14:02:11.482Z] Candidate paths: ["shopping-list.txt"]
[2026-10-10T14:02:11.483Z] DECISION: DENY (Blocked) - shopping-list.txt matched rule 'shopping-list.txt'.
```

## Where it works

| Copilot surface | Status |
| --- | --- |
| **Copilot CLI** | ✅ Supported and tested |
| **VS Code Copilot Chat, agent mode** | ✅ Tested. VS Code agent hooks are in Preview. |
| **Copilot cloud agent** | Should work (it runs `.github/hooks`), not yet tested |
| **Inline suggestions, workspace index, open editor files** | ❌ Not covered. These don't go through tool calls. |

## Good to know

pilotignore only sees **tool calls**. Some ways content reaches Copilot don't involve a tool call it can filter:

- **Content searches.** `grep -r milk .` or the agent's search tool can return matching lines from blocked files without opening them, because the search command itself names no blocked path.
- **Workspace index and open files.** VS Code indexes your workspace for semantic search, and the file open in your editor is sent as context. Neither goes through a hook.
- **Indirect reads.** A script or interpreter that builds the path at runtime, for example `python3 -c "open('se'+'crets.json').read()"`, isn't recognized.

To cover these as well, also add sensitive paths to `.gitignore` or VS Code's `files.exclude` / `search.exclude` settings. Those keep them out of the index and search results. Organizations on Copilot Business or Enterprise can additionally use GitHub's [content exclusion](https://docs.github.com/en/copilot/concepts/context/content-exclusion). And as always, real credentials belong in a secret manager, not in a workspace an agent works in.

## How it works

`init` writes two files: `.github/hooks/pilotignore.json` registers the hook with Copilot, and `.github/hooks/pilotignore.cjs` is the hook itself. Before each tool call, Copilot passes the call's arguments to the hook. The hook collects every path in them, including paths inside shell commands, and checks them against `.pilotignore`.

A few deliberate design choices:

- **Silent allow.** If nothing matches, the hook prints nothing. Copilot's normal approval prompts and tool rules apply as if pilotignore weren't there. It only ever takes permissions away.
- **Fail-closed.** If the hook can't evaluate a call (malformed input, unreadable rules), the call is denied. This matches how Copilot treats a failing `preToolUse` hook. One exception comes from Copilot itself: a hook that times out is skipped, so the hook is built to finish well within its 5-second limit.
- **Shell-aware.** Commands are split into tokens. Globs like `cat shop*` are expanded against the filesystem, and operations on a directory that contains blocked paths (`rm -rf .github`) are denied. The project root is exempt, so `ls .` keeps working.
- **Explains itself.** A deny always names the rule that matched, so you can tell exactly why a call was blocked.
- **Errs on the side of blocking.** A command that only *mentions* a blocked name, like `git add .pilotignore`, is denied too. Commit changes to your ruleset yourself.

## Troubleshooting

- **Run `npx pilotignore verify`.** It checks the setup and fires test calls at the installed hook using your own rules.
- **Nothing in the log** means Copilot didn't run the hook. Check that `.github/hooks/pilotignore.json` exists and that hooks aren't disabled in your Copilot settings.
- **A blocked file shows `ALLOW` in the log** means the path wasn't found in the tool call. Please [open an issue](https://github.com/vkerttula/pilotignore/issues) with the log lines.
- **After upgrading pilotignore**, run `npx pilotignore init` again to update the hook script. Your `.pilotignore` is never overwritten. Check the [changelog](CHANGELOG.md) for rule changes.

## Uninstall

```bash
npm uninstall pilotignore
rm .pilotignore .github/hooks/pilotignore.json .github/hooks/pilotignore.cjs
```

Optionally remove `.copilot/logs/pilotignore.log` and the `# pilotignore logs` entry from your `.gitignore`.

## Roadmap

- [x] Block Copilot CLI and VS Code agent tool calls via `preToolUse` hooks
- [x] `.gitignore`-style rules, shell scanning, directory protection, `verify` (v0.2.0)
- [ ] Test and document Copilot cloud agent
- [ ] Optionally sync rules to VS Code `search.exclude` / `files.exclude` to cover search and indexing
- [ ] Explore filtering blocked files out of search results with a `postToolUse` hook

## Development

```text
bin/cli.js            CLI: init and verify
src/pilotignore.cjs   the hook (copied into projects by init)
src/templates/        hook config and default .pilotignore
tests/                automated tests, smoke test and a sandbox demo project
```

`npm test` runs the test suite. [`tests/README.md`](tests/README.md) covers the smoke test and hands-on testing with Copilot in a ready-made demo project.

## License

[MIT](LICENSE). The software is provided "as is", without warranty of any kind, and the authors aren't liable for any damages arising from its use. See the license for the full terms.
