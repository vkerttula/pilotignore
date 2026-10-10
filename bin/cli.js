#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

// ESM equivalents for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USAGE = `pilotignore — keep your secrets secret

Usage:
  npx pilotignore init      Install the Copilot hook and create .pilotignore
  npx pilotignore verify    Check the installation with live hook runs
  npx pilotignore help      Show this message
`;

async function init(targetDir) {
  const githubHooksDir = path.join(targetDir, ".github", "hooks");
  const srcDir = path.join(__dirname, "..", "src");
  const templatesDir = path.join(srcDir, "templates");

  try {
    // 1. Create the directory structure
    await fs.mkdir(githubHooksDir, { recursive: true });
    console.log("✅ Ensured directory: .github/hooks");

    // 2. Copy the configuration file
    await fs.copyFile(
      path.join(templatesDir, "pilotignore.json"),
      path.join(githubHooksDir, "pilotignore.json"),
    );
    console.log("✅ Copied: .github/hooks/pilotignore.json");

    // 3. Copy the actual firewall script
    await fs.copyFile(
      path.join(srcDir, "pilotignore.cjs"),
      path.join(githubHooksDir, "pilotignore.cjs"),
    );
    console.log("✅ Copied: .github/hooks/pilotignore.cjs");

    // 4. Create .pilotignore only if it doesn't exist
    const targetPilotignore = path.join(targetDir, ".pilotignore");
    try {
      await fs.access(targetPilotignore);
      console.log("ℹ️  .pilotignore already exists, skipping creation.");
    } catch {
      await fs.copyFile(
        path.join(templatesDir, "default.pilotignore"),
        targetPilotignore,
      );
    }

    // 5. Add .copilot/ to .gitignore if not already ignored
    const targetGitignore = path.join(targetDir, ".gitignore");
    try {
      let gitignoreContent = "";
      try {
        gitignoreContent = await fs.readFile(targetGitignore, "utf8");
      } catch {
        // .gitignore doesn't exist yet, we will create it
      }

      if (!gitignoreContent.includes(".copilot")) {
        const separator = gitignoreContent && !gitignoreContent.endsWith("\n") ? "\n" : "";
        await fs.writeFile(
          targetGitignore,
          gitignoreContent + separator + "\n# pilotignore logs\n.copilot/\n",
          "utf8"
        );
        console.log("✅ Added .copilot/ to .gitignore");
      } else {
        console.log("ℹ️  .copilot/ already in .gitignore, skipping.");
      }
    } catch (err) {
      console.log("ℹ️  Could not update .gitignore: " + err.message);
    }

    console.log("\n🚀 pilotignore initialization complete!");
    console.log(
      "Add your sensitive files to the .pilotignore file at the root of your project,",
    );
    console.log("then run `npx pilotignore verify` to confirm the firewall works.");
  } catch (error) {
    console.error("❌ Installation error:", error.message);
    process.exit(1);
  }
}

function runHook(scriptPath, cwd, payload) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (err) =>
      resolve({ code: -1, stdout, stderr: String(err) }),
    );
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// An allow is silent (exit 0, no stdout); a deny carries a JSON decision.
function parseDecision({ code, stdout }) {
  const out = stdout.trim();
  if (!out) return code === 0 ? "allow" : null;
  try {
    const parsed = JSON.parse(out);
    return (
      parsed.permissionDecision ||
      parsed.hookSpecificOutput?.permissionDecision ||
      null
    );
  } catch {
    return null;
  }
}

// Turns a glob rule into one concrete path that should match it,
// so verify can exercise the real hook with real rules.
function concretePathFor(rule) {
  let p = rule.trim();
  if (p.startsWith("!") || p.startsWith("#")) return null;
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  p = p
    .replace(/\*\*/g, "x/y")
    .replace(/\*/g, "x")
    .replace(/\?/g, "x")
    .replace(/\[([^\]]*)\]/g, (m, cls) =>
      cls.startsWith("!") || cls.startsWith("^")
        ? "x"
        : cls.replace(/\\/g, "").charAt(0) || "x",
    );
  return p || null;
}

async function verify(targetDir) {
  let ok = true;
  const results = [];
  const check = (passed, label) => {
    results.push(`${passed ? "✓" : "✗"} ${label}`);
    if (!passed) ok = false;
  };

  const hooksDir = path.join(targetDir, ".github", "hooks");
  const jsonPath = path.join(hooksDir, "pilotignore.json");
  const scriptPath = path.join(hooksDir, "pilotignore.cjs");
  const ignorePath = path.join(targetDir, ".pilotignore");

  // 1. Hook configuration
  try {
    const cfg = JSON.parse(await fs.readFile(jsonPath, "utf8"));
    const hooks = cfg?.hooks?.preToolUse;
    check(
      Array.isArray(hooks) && hooks.length > 0,
      ".github/hooks/pilotignore.json — valid preToolUse hook config",
    );
  } catch {
    check(
      false,
      ".github/hooks/pilotignore.json — missing or invalid (run: npx pilotignore init)",
    );
  }

  // 2. Hook script
  const scriptExists = await fs
    .access(scriptPath)
    .then(() => true)
    .catch(() => false);
  check(
    scriptExists,
    ".github/hooks/pilotignore.cjs — firewall script present",
  );

  // 3. .pilotignore rules
  let rules = [];
  try {
    rules = (await fs.readFile(ignorePath, "utf8"))
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"));
    check(true, `.pilotignore — ${rules.length} blocking rule(s) loaded`);
    if (rules.length === 0) {
      check(false, ".pilotignore contains no blocking rules");
    }
  } catch {
    check(false, ".pilotignore — not found (run: npx pilotignore init)");
  }

  // 4. Live checks against the real installed hook
  if (scriptExists && rules.length > 0) {
    let denyCandidate = null;
    for (const rule of rules.slice(0, 10)) {
      const candidate = concretePathFor(rule);
      if (!candidate) continue;
      const result = await runHook(scriptPath, targetDir, {
        timestamp: Date.now(),
        cwd: targetDir,
        toolName: "view",
        toolArgs: { path: candidate },
      });
      if (parseDecision(result) === "deny") {
        denyCandidate = candidate;
        check(true, `view "${candidate}" (rule "${rule}") → denied`);
        break;
      }
    }
    if (!denyCandidate) {
      check(
        false,
        "no .pilotignore rule produced a deny — check your patterns",
      );
    }

    if (denyCandidate) {
      const result = await runHook(scriptPath, targetDir, {
        timestamp: Date.now(),
        cwd: targetDir,
        toolName: "bash",
        toolArgs: { command: `cat ${denyCandidate}` },
      });
      check(
        parseDecision(result) === "deny",
        `bash "cat ${denyCandidate}" → denied`,
      );
    }

    const probe = "pilotignore-verify-probe";
    const result = await runHook(scriptPath, targetDir, {
      timestamp: Date.now(),
      cwd: targetDir,
      toolName: "view",
      toolArgs: { path: probe },
    });
    check(
      parseDecision(result) === "allow",
      `view "${probe}" → allowed (no output, Copilot's normal permission flow applies)`,
    );
  }

  console.log("\npilotignore verify\n");
  results.forEach((r) => console.log("  " + r));
  console.log(
    `\n${ok ? "✅ All checks passed." : "❌ Some checks FAILED."}`,
  );
  console.log(
    `Live hook decisions are logged to .copilot/logs/pilotignore.log\n`,
  );
  process.exit(ok ? 0 : 1);
}

const command = process.argv[2];
const targetDir = process.cwd();

if (command === "init") {
  await init(targetDir);
} else if (command === "verify") {
  await verify(targetDir);
} else {
  console.log(USAGE);
  process.exit(
    command === "help" || command === "--help" || command === "-h" ? 0 : 1,
  );
}
