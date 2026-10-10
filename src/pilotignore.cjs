const fs = require("fs");
const os = require("os");
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

// --- .pilotignore rule engine (gitignore-style patterns) ---

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Translates one glob pattern (without leading `!` or trailing `/`)
// into a regex source string. Supports *, **, ? and [char] classes.
function globToRegExpSource(glob) {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:[^/]+/)*";
          i += 3;
        } else if (i + 2 === glob.length && i > 0 && glob[i - 1] === "/") {
          // trailing `/**`: fold the already-emitted `/` into the group
          // so `a/**` matches both `a` and everything under it
          re = re.slice(0, -1) + "(?:/.*)?";
          i += 2;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if (c === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end === -1) {
        re += "\\[";
        i += 1;
      } else {
        let cls = glob.slice(i + 1, end);
        if (cls.startsWith("!")) cls = "^" + cls.slice(1);
        re += "[" + cls.replace(/\\/g, "\\\\") + "]";
        i = end + 1;
      }
    } else if (c === "\\") {
      if (i + 1 < glob.length) {
        re += escapeRegExp(glob[i + 1]);
        i += 2;
      } else {
        re += "\\\\";
        i += 1;
      }
    } else {
      re += escapeRegExp(c);
      i += 1;
    }
  }
  return re;
}

// Parses a single .pilotignore line into a rule object, or null.
function compileRule(rawLine) {
  let pattern = rawLine.trim();
  if (!pattern || pattern.startsWith("#")) return null;

  let negated = false;
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  }
  pattern = pattern.replace(/^\\!/, "!").replace(/^\\#/, "#");

  let dirOnly = false;
  if (pattern.endsWith("/")) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }
  if (!pattern) return null;

  // A `/` anywhere inside the pattern anchors it to the project root.
  const anchored = pattern.includes("/");
  const body = globToRegExpSource(pattern.replace(/^\/+/, ""));
  const prefix = anchored ? "^" : "^(?:.+/)?";

  return {
    raw: rawLine.trim(),
    pattern: pattern.replace(/^\/+/, ""),
    anchored,
    negated,
    dirOnly,
    re: new RegExp(prefix + body + "(?:/.*)?$", "i"),
    // Matches only when the pattern consumes a directory strictly inside
    // the candidate path (used for `dir/` rules).
    insideRe: dirOnly
      ? new RegExp(prefix + body + "/.+$", "i")
      : null,
  };
}

function loadRules(ignoreFilePath) {
  const rules = [];
  if (!fs.existsSync(ignoreFilePath)) return rules;
  const content = fs.readFileSync(ignoreFilePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const rule = compileRule(line);
    if (rule) rules.push(rule);
  });
  return rules;
}

// Last matching rule wins; `!` rules un-ignore (gitignore semantics).
function matchRules(rules, cwd, absolutePath, relative) {
  let blocked = false;
  let hit = null;
  for (const rule of rules) {
    let matches = rule.re.test(relative);
    if (matches && rule.dirOnly) {
      if (!rule.insideRe.test(relative)) {
        // The candidate *is* the directory pattern target itself; only
        // match when it actually resolves to a directory.
        let isDir = false;
        try {
          isDir = fs.statSync(absolutePath).isDirectory();
        } catch (e) {
          isDir = true; // fail closed on unresolvable paths
        }
        matches = isDir;
      }
    }
    if (matches) {
      blocked = !rule.negated;
      hit = rule;
    }
  }
  return { blocked, rule: hit };
}

// --- filesystem-aware checks (shell globs, directory operations) ---

const GLOB_CHARS = /[*?[]/;
// Upper bound on directory entries visited per walk, so a hook call on a
// huge tree stays well inside Copilot's hook timeout.
const WALK_LIMIT = 5000;

// Iterative directory walk. `visit` returning true stops the walk early.
// Symlinked directories are not followed.
function walk(dir, maxDepth, visit) {
  let seen = 0;
  const stack = [{ dir, rel: "", depth: 0 }];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur.dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (++seen > WALK_LIMIT) return "truncated";
      const entryAbs = path.join(cur.dir, entry.name);
      const entryRel = cur.rel ? cur.rel + "/" + entry.name : entry.name;
      if (visit(entryAbs, entryRel) === true) return "found";
      if (entry.isDirectory() && cur.depth + 1 < maxDepth) {
        stack.push({ dir: entryAbs, rel: entryRel, depth: cur.depth + 1 });
      }
    }
  }
  return "done";
}

// Expands a shell-style glob token (`shop*`, `*.tx?`, `[s]ecret`) into the
// paths it would match on disk, so `cat shop*` is judged by what the shell
// would actually pass to `cat`. Dotfiles are matched too (conservative).
function expandGlob(cwd, token) {
  const abs = resolveCandidate(cwd, token).replace(/\\/g, "/");
  const segments = abs.split("/");
  const firstGlob = segments.findIndex((s) => GLOB_CHARS.test(s));
  if (firstGlob === -1) return [];
  const base = segments.slice(0, firstGlob).join("/") || "/";
  const rest = segments.slice(firstGlob).join("/");
  const re = new RegExp("^" + globToRegExpSource(rest) + "$", "i");
  const maxDepth = rest.includes("**")
    ? Infinity
    : segments.length - firstGlob;
  const matches = [];
  walk(base, maxDepth, (entryAbs, entryRel) => {
    if (re.test(entryRel)) matches.push(entryAbs);
  });
  return matches;
}

// Returns { path, rule } when `relative` is a directory that contains a
// blocked path, so `rm -rf .github` cannot remove the firewall wholesale.
function findBlockedDescendant(rules, cwd, absolutePath, relative) {
  const dirPrefix = relative.toLowerCase() + "/";

  // 1. Anchored rules: blocked even if the protected file doesn't exist.
  for (const rule of rules) {
    if (rule.negated || !rule.anchored) continue;
    const segs = rule.pattern.split("/");
    const idx = segs.findIndex((s) => GLOB_CHARS.test(s));
    const literal = (idx === -1 ? segs : segs.slice(0, idx)).join("/");
    if (literal.toLowerCase().startsWith(dirPrefix)) {
      return { path: rule.pattern, rule };
    }
  }

  // 2. Any rule: scan what actually exists under the directory.
  let isDir = false;
  try {
    isDir = fs.statSync(absolutePath).isDirectory();
  } catch (e) {}
  if (!isDir) return null;

  let hit = null;
  const status = walk(absolutePath, Infinity, (entryAbs, entryRel) => {
    const rel = relative + "/" + entryRel;
    const { blocked, rule } = matchRules(rules, cwd, entryAbs, rel);
    if (blocked) {
      hit = { path: rel, rule };
      return true;
    }
  });
  if (status === "truncated") {
    appendLog(
      cwd,
      `Directory scan of '${relative}' stopped after ${WALK_LIMIT} entries.`,
    );
  }
  return hit;
}

// --- candidate extraction ---

// Tool input fields whose string values are shell-like commands and
// therefore deserve full tokenization.
const COMMAND_KEYS = new Set([
  "command",
  "cmd",
  "script",
  "shell",
  "shellcommand",
  "commandline",
  "bash",
  "powershell",
  "sh",
  "input",
  "args",
  "arguments",
]);

function tokenize(str) {
  return str
    .split(/[\s'"`|&;(){}<>]+/)
    .flatMap((t) => t.split("="))
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith("-") && !t.includes("://"));
}

function isPathLike(tok) {
  return (
    tok.includes("/") ||
    tok.includes("\\") ||
    tok.startsWith(".") ||
    tok.startsWith("~")
  );
}

function collectCandidates(payload) {
  const candidates = [];

  function add(str, isCommand) {
    candidates.push(str);
    for (const tok of tokenize(str)) {
      if (isCommand || isPathLike(tok)) candidates.push(tok);
    }
  }

  function collect(val, isCommand) {
    if (!val) return;
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (parsed && typeof parsed === "object") {
          collect(parsed, isCommand);
          return;
        }
      } catch (e) {}
      add(val, isCommand);
      return;
    }
    if (Array.isArray(val)) {
      val.forEach((v) => collect(v, isCommand));
      return;
    }
    if (typeof val === "object") {
      for (const [k, v] of Object.entries(val)) {
        const keyIsCommand =
          isCommand || COMMAND_KEYS.has(k.toLowerCase().replace(/[_-]/g, ""));
        collect(v, keyIsCommand);
      }
      return;
    }
    candidates.push(String(val));
  }

  if (payload.tool_input) collect(payload.tool_input, false);
  if (
    payload.tool_input_as_string &&
    typeof payload.tool_input_as_string === "string"
  ) {
    try {
      collect(JSON.parse(payload.tool_input_as_string), false);
    } catch (e) {}
  }

  if (payload.toolArgs) collect(payload.toolArgs, false);
  if (payload.arguments) collect(payload.arguments, false);

  if (candidates.length === 0) {
    collect(payload, false);
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
    "command",
    "commandLine",
  ].forEach((k) =>
    collect(payload[k], COMMAND_KEYS.has(k.toLowerCase().replace(/[_-]/g, ""))),
  );

  return candidates;
}

function resolveCandidate(cwd, candidate) {
  const c = candidate.trim().replace(/\\/g, "/");
  if (c === "~" || c.startsWith("~/")) {
    return path.join(os.homedir(), c.slice(1));
  }
  return path.resolve(cwd, c);
}

function isIdeClient(payload, rawInput) {
  const fields = [
    payload.client,
    payload.clientName,
    payload.client_name,
    payload.ide,
    payload.host,
    payload.source,
  ];
  for (const f of fields) {
    if (typeof f === "string" && /vscode|copilot[-_ ]?chat|\bide\b/i.test(f)) {
      return true;
    }
  }
  return rawInput.includes("vscode") || rawInput.includes("copilot-chat");
}

// Emits a deny in both supported shapes: flat fields for the native
// Copilot CLI format and the hookSpecificOutput wrapper for the
// VS Code/Claude-compatible format. Extra fields are ignored per spec.
// There is deliberately no "allow" counterpart: allowing means emitting
// nothing, so Copilot's own permission flow (approval prompts, tool
// rules) still applies. pilotignore only ever narrows access.
function deny(payload, reason) {
  console.log(
    JSON.stringify({
      permissionDecision: "deny",
      permissionDecisionReason: reason,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  console.error(reason);
  if (isIdeClient(payload, input)) {
    process.exit(0); // copilot chat VS Code IDE
  } else {
    process.exit(2); // copilot CLI
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

  let payload = {};
  try {
    if (!input.trim()) throw new Error("empty hook payload");
    payload = JSON.parse(input);
    currentCwd = payload.cwd || currentCwd; // Use the project root

    const candidates = [];
    for (const c of collectCandidates(payload)) {
      if (typeof c !== "string" || !c.trim()) continue;
      candidates.push(c);
      // Single-token globs are expanded the way the shell would
      if (GLOB_CHARS.test(c) && !/\s/.test(c.trim())) {
        candidates.push(...expandGlob(currentCwd, c.trim()));
      }
    }

    appendLog(currentCwd, `Candidate paths: ${JSON.stringify(candidates)}`);

    const ignoreFilePath = path.join(currentCwd, ".pilotignore");
    const ignoreRules = loadRules(ignoreFilePath);
    if (ignoreRules.length > 0) {
      appendLog(
        currentCwd,
        `Loaded ${ignoreRules.length} rules from the .pilotignore file.`,
      );
    } else {
      appendLog(
        currentCwd,
        `Warning: no rules loaded from ${ignoreFilePath}`,
      );
    }

    for (const candidate of candidates) {
      const absolutePath = resolveCandidate(currentCwd, candidate);
      const relative = path
        .relative(currentCwd, absolutePath)
        .replace(/\\/g, "/");
      // The project root itself is exempt, otherwise `ls .` and every
      // other root-level command would be denied.
      if (!relative || relative === "." || relative === "..") continue;

      const { blocked, rule } = matchRules(
        ignoreRules,
        currentCwd,
        absolutePath,
        relative,
      );
      if (blocked) {
        appendLog(
          currentCwd,
          `DECISION: DENY (Blocked) - ${relative} matched rule '${rule.raw}'.`,
        );
        deny(
          payload,
          `Access to '${relative}' is blocked by .pilotignore rule '${rule.raw}'.`,
        );
      }

      if (!relative.startsWith("../")) {
        const hit = findBlockedDescendant(
          ignoreRules,
          currentCwd,
          absolutePath,
          relative,
        );
        if (hit) {
          appendLog(
            currentCwd,
            `DECISION: DENY (Blocked) - ${relative} contains ${hit.path} (rule '${hit.rule.raw}').`,
          );
          deny(
            payload,
            `Access to '${relative}' is blocked: it contains '${hit.path}', protected by .pilotignore rule '${hit.rule.raw}'.`,
          );
        }
      }
    }

    appendLog(currentCwd, `DECISION: ALLOW (no output, default permission flow)`);
    process.exit(0);
  } catch (err) {
    // Fail closed, matching Copilot's own handling of crashing preToolUse
    // command hooks: if the call can't be evaluated, it doesn't run.
    appendLog(currentCwd, `ERROR: ${err.message} - DECISION: DENY (fail-closed)`);
    deny(
      payload,
      `pilotignore could not evaluate this tool call (${err.message}); denying by default (fail-closed).`,
    );
  }
});
