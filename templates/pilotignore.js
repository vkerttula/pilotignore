const fs = require("fs");
const path = require("path");

// Helper function for logging
function appendLog(cwd, message) {
  try {
    const logDir = path.join(cwd, ".copilot", "logs");
    const logFile = path.join(logDir, "pilotignore.log");

    // Ensure the log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
  } catch (e) {
    // If logging fails, do not crash the entire program
  }
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});

process.stdin.on("end", () => {
  // Default cwd, updated if a better one is found in the payload
  let currentCwd = process.cwd();
  appendLog(currentCwd, `HOOK PROCESS STARTED (pid: ${process.pid})`);

  try {
    const payload = JSON.parse(input || "{}");
    currentCwd = payload.cwd || currentCwd; // Use the project root

    const candidates = [];
    function collect(val) {
      if (!val) return;
      if (typeof val === "string") {
        try {
          const parsed = JSON.parse(val);
          if (parsed && typeof parsed === "object") {
            collect(parsed);
            return;
          }
        } catch (e) {}
        candidates.push(val);
        return;
      }
      if (Array.isArray(val)) {
        val.forEach(collect);
        return;
      }
      if (typeof val === "object") {
        Object.values(val).forEach(collect);
        return;
      }
      candidates.push(String(val));
    }

    if (payload.tool_input) collect(payload.tool_input);
    if (
      payload.tool_input_as_string &&
      typeof payload.tool_input_as_string === "string"
    ) {
      try {
        collect(JSON.parse(payload.tool_input_as_string));
      } catch (e) {}
    }

    if (payload.toolArgs) collect(payload.toolArgs);
    if (payload.arguments) collect(payload.arguments);

    if (candidates.length === 0) {
      collect(payload);
    }

    [
      "path",
      "file",
      "target",
      "filePath",
      "args",
      "files",
      "targetPath",
      "file_path",
    ].forEach((k) => collect(payload[k]));

    appendLog(currentCwd, `Candidate paths: ${JSON.stringify(candidates)}`);

    const ignoreRules = [];
    const ignoreFilePath = path.join(currentCwd, ".pilotignore");
    if (fs.existsSync(ignoreFilePath)) {
      const content = fs.readFileSync(ignoreFilePath, "utf8");
      content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) ignoreRules.push(trimmed);
      });
      appendLog(
        currentCwd,
        `Loaded ${ignoreRules.length} rules from the .pilotignore file.`,
      );
    } else {
      appendLog(
        currentCwd,
        `Warning: .pilotignore file not found at path ${ignoreFilePath}`,
      );
    }

    const isBlocked = candidates.some((candidate) => {
      if (!candidate.includes(path.sep) && !candidate.includes("/"))
        return false;
      const relative = path.relative(currentCwd, candidate).replace(/\\/g, "/");
      return ignoreRules.some(
        (rule) => relative.endsWith(rule) || relative === rule,
      );
    });

    if (isBlocked) {
      const reason = "File reading is blocked based on a .pilotignore rule.";
      appendLog(
        currentCwd,
        `DECISION: DENY (Blocked) - Path found on the blocklist.`,
      );

      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason,
          },
        }),
      );

      console.error(reason);

      if (input.includes("vscode") || input.includes("copilot-chat")) {
        process.exit(0); // copilot chat VS Code IDE
      } else {
        process.exit(2); // copilot CLI
      }
    }

    appendLog(currentCwd, `DECISION: ALLOW`);
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      }),
    );
    process.exit(0);
  } catch (err) {
    appendLog(currentCwd, `ERROR: ${err.message}`);
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      }),
    );
    process.exit(0);
  }
});
