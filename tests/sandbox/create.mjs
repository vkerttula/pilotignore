// Creates a realistic demo project ("recipe-box") with pilotignore
// installed from this working tree, for hands-on testing with Copilot.
// The project deliberately contains no hints about pilotignore or testing,
// so the agent behaves as it would in a real repository.
//
// Usage: node tests/sandbox/create.mjs [target-dir] [--force]
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const fixture = path.join(here, "fixture");

const args = process.argv.slice(2);
const force = args.includes("--force");
const target = path.resolve(
  args.find((a) => !a.startsWith("--")) ||
    path.join(os.tmpdir(), "recipe-box"),
);

function run(cmd, cmdArgs, cwd) {
  return new Promise((resolve) => {
    // On Windows npm is npm.cmd, which Node can only start through a shell.
    const shell = process.platform === "win32" && cmd === "npm";
    const child = spawn(cmd, cmdArgs, { cwd, shell });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stderr }));
    child.on("error", (err) => resolve({ code: -1, stderr: String(err) }));
  });
}

async function step(label, promise) {
  const { code, stderr } = await promise;
  if (code !== 0) {
    console.error(`❌ ${label} failed:\n${stderr}`);
    process.exit(1);
  }
}

const exists = await fs
  .access(target)
  .then(() => true)
  .catch(() => false);
if (exists && !force) {
  console.error(`Target already exists: ${target}`);
  console.error("Re-run with --force to recreate it, or pass another path.");
  process.exit(1);
}
if (exists) await fs.rm(target, { recursive: true, force: true });

console.log(`Creating sandbox project at ${target}\n`);
await fs.cp(fixture, target, { recursive: true });

// Depend on this working tree, so the sandbox always tests the current
// code. Real paths, so symlinked locations (e.g. macOS /tmp) resolve.
const pkgPath = path.join(target, "package.json");
const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
const rel = path
  .relative(await fs.realpath(target), await fs.realpath(root))
  .split(path.sep)
  .join("/");
pkg.devDependencies = { pilotignore: `file:${rel}` };
await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

await step(
  "npm install",
  run("npm", ["install", "--silent", "--no-audit", "--no-fund"], target),
);
const cli = path.join(target, "node_modules", "pilotignore", "bin", "cli.js");
await step("pilotignore init", run(process.execPath, [cli, "init"], target));

// A real project has history; identity is passed per-command so no git
// config is touched.
const git = (...gitArgs) =>
  run(
    "git",
    ["-c", "user.name=Sandbox", "-c", "user.email=sandbox@example.com", ...gitArgs],
    target,
  );
await step("git init", git("init", "-q"));
await step("git add", git("add", "-A"));
await step("git commit", git("commit", "-q", "-m", "Initial commit"));

console.log(`✅ Sandbox ready: ${target}

Open it with:
  code "${target}"     # VS Code, Copilot Chat in agent mode
  cd "${target}" && copilot

Test prompts and what to expect: tests/README.md
`);
