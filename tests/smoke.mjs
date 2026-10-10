import { spawn, execFileSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// On Windows npm is npm.cmd, which Node can only start through a shell.
const npmShell = process.platform === "win32";

let failures = 0;
const check = (cond, label) => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
};

function run(cmd, args, cwd, input = null) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: npmShell && cmd === "npm" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (err) =>
      resolve({ code: -1, stdout, stderr: String(err) }),
    );
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

console.log(
  "pilotignore smoke — packing, installing and exercising the real artifact\n",
);

// 1. Pack the package exactly like npm publish would ship it
const packOut = execFileSync("npm", ["pack"], { cwd: root, shell: npmShell })
  .toString()
  .split("\n")
  .filter((l) => l.trim().endsWith(".tgz"))
  .pop()
  .trim();
const tarball = path.join(root, packOut);
console.log(`packed: ${packOut}\n`);

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pilotignore-smoke-"));
try {
  // 2. Install the tarball into a scratch project
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "smoke", version: "1.0.0" }),
  );
  const install = await run(
    "npm",
    // quoted for the Windows shell, in case the path contains spaces
    ["install", "--silent", "--no-audit", "--no-fund", npmShell ? `"${tarball}"` : tarball],
    dir,
  );
  check(install.code === 0, "npm install of packed tarball");

  // 3. Run init through the installed bin
  const cli = path.join(dir, "node_modules", "pilotignore", "bin", "cli.js");
  const init = await run(process.execPath, [cli, "init"], dir);
  check(init.code === 0, "pilotignore init exits cleanly");
  for (const f of [
    ".github/hooks/pilotignore.json",
    ".github/hooks/pilotignore.cjs",
    ".pilotignore",
    ".gitignore",
  ]) {
    check(
      await fs
        .access(path.join(dir, f))
        .then(() => true)
        .catch(() => false),
      `${f} created`,
    );
  }

  // 4. Write real rules and exercise the installed hook end-to-end
  // Appended, so the default self-protection rules from init stay active
  await fs.appendFile(path.join(dir, ".pilotignore"), "\n.env\nsecrets/**\n");
  const hook = path.join(dir, ".github", "hooks", "pilotignore.cjs");
  const runHook = (toolArgs, toolName = "view") =>
    run(
      process.execPath,
      [hook],
      dir,
      JSON.stringify({
        timestamp: Date.now(),
        cwd: dir,
        toolName,
        toolArgs,
      }),
    );

  let r = await runHook({ path: ".env" });
  check(r.code === 2, 'view ".env" → denied (exit 2)');

  r = await runHook({ command: "cat secrets/prod.key" }, "bash");
  check(r.code === 2, 'bash "cat secrets/prod.key" → denied');

  r = await runHook({ path: "package.json" });
  check(
    r.code === 0 && r.stdout.trim() === "",
    'view "package.json" → allowed (silent)',
  );

  r = await runHook({ command: "rm -rf .github" }, "bash");
  check(r.code === 2, 'bash "rm -rf .github" → denied (protects the firewall)');

  r = await run(process.execPath, [hook], dir, "not json");
  check(r.code === 2, "malformed payload → denied (fail-closed)");

  // 5. The shipped verify command, end-to-end
  r = await run(process.execPath, [cli, "verify"], dir);
  check(r.code === 0, "pilotignore verify passes in the installed project");

  // 6. Decisions were logged
  const log = await fs
    .readFile(path.join(dir, ".copilot", "logs", "pilotignore.log"), "utf8")
    .catch(() => "");
  check(
    log.includes("DECISION: DENY"),
    "deny decisions written to .copilot/logs/pilotignore.log",
  );
} finally {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(tarball, { force: true });
}

console.log(
  failures === 0
    ? "\n✅ All smoke checks passed."
    : `\n❌ ${failures} smoke check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
