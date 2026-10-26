#!/usr/bin/env node
// Claude Code hooks for DepoTrack. Cross-platform (Windows Git Bash, macOS, Linux).
// Modes:
//   guard      PreToolUse(Bash)            blocks destructive docker commands
//   post-edit  PostToolUse(Edit|Write)     lints the edited file
//   stop       Stop                        typecheck/tests for packages with changes
// Exit code 2 sends stderr back to Claude so it fixes the problem itself.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CACHE = path.join(ROOT, ".claude", ".cache");
const mode = process.argv[2];

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function run(cmd, cwd) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function has(cmd) {
  return run(process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`, ROOT).ok;
}

function tail(text, lines = 60) {
  const all = text.split(/\r?\n/);
  return all.length > lines ? `…(${all.length - lines} riadkov vynechaných)\n${all.slice(-lines).join("\n")}` : text;
}

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(2);
}

function relPath(p) {
  if (!p) return "";
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

// --- guard -----------------------------------------------------------------
function guard() {
  const cmd = String(readInput().tool_input?.command ?? "");
  const destructive =
    /docker[\s-]+compose\b[^|;&]*\bdown\b[^|;&]*(\s-v\b|--volumes\b)/.test(cmd) ||
    /docker\s+volume\s+(rm|prune)\b/.test(cmd) ||
    /docker\s+system\s+prune\b[^|;&]*--volumes/.test(cmd);
  if (destructive) {
    fail(
      "Zablokované hookom: mazanie Docker volumes zmaže všetky dáta (docs/plan-doplnky.md, Pravidlá práce). " +
        "Ak je to naozaj potrebné, vysvetli prečo a požiadaj používateľa, nech príkaz spustí sám.",
    );
  }
}

// --- post-edit -------------------------------------------------------------
const JS_EXT = /\.(ts|tsx|js|mjs|cjs|jsx)$/;

function postEdit() {
  const input = readInput();
  const file = relPath(input.tool_input?.file_path ?? input.tool_input?.path);
  if (!file || file.startsWith("..")) return;

  for (const pkg of ["frontend", "telematics"]) {
    if (file.startsWith(`${pkg}/`) && JS_EXT.test(file)) {
      const dir = path.join(ROOT, pkg);
      if (!existsSync(path.join(dir, "node_modules", ".bin"))) return; // npm install not done yet
      const r = run(`npx --no-install eslint --no-warn-ignored "${file.slice(pkg.length + 1)}"`, dir);
      if (!r.ok) fail(`eslint našiel problémy v ${file}:\n${tail(r.out)}`);
      return;
    }
  }

  if (file.startsWith("app/") && file.endsWith(".py")) {
    const ruff = has("ruff") ? "ruff" : null;
    if (!ruff) return; // ruff not installed locally: full check runs in container (ADR-015)
    const target = file.slice("app/".length);
    const fix = run(`${ruff} check --fix --quiet "${target}"`, path.join(ROOT, "app"));
    if (!fix.ok) fail(`ruff našiel problémy v ${file}:\n${tail(fix.out)}`);
  }
}

// --- stop ------------------------------------------------------------------
function changedPackages() {
  const r = run("git status --porcelain --untracked-files=all", ROOT);
  if (!r.ok) return new Map();
  const pkgs = new Map();
  for (const line of r.out.split(/\r?\n/)) {
    const p = line.slice(3).replace(/^"|"$/g, "").split(" -> ").pop() ?? "";
    const pkg = p.split("/")[0];
    if (["frontend", "telematics", "app"].includes(pkg)) {
      if (!pkgs.has(pkg)) pkgs.set(pkg, []);
      pkgs.get(pkg).push(p);
    }
  }
  return pkgs;
}

function fingerprint(pkg, files) {
  const h = createHash("sha256");
  h.update(run(`git diff HEAD -- "${pkg}"`, ROOT).out);
  for (const f of files.sort()) {
    const abs = path.join(ROOT, f);
    h.update(f);
    if (existsSync(abs)) {
      try {
        h.update(readFileSync(abs));
      } catch {
        /* directory or unreadable */
      }
    }
  }
  return h.digest("hex");
}

function stop() {
  const input = readInput();
  if (input.stop_hook_active) return; // already continued once because of this hook: avoid loops

  const checks = {
    frontend: ["npm run --silent typecheck"],
    telematics: ["npm run --silent typecheck", "npm test --silent"],
    app: has("ruff") ? ["ruff check src tests"] : [],
  };

  mkdirSync(CACHE, { recursive: true });
  const problems = [];
  for (const [pkg, files] of changedPackages()) {
    const cmds = checks[pkg];
    const dir = path.join(ROOT, pkg);
    if (!cmds.length) continue;
    if (pkg !== "app" && !existsSync(path.join(dir, "node_modules"))) continue;
    const fp = fingerprint(pkg, files);
    const cacheFile = path.join(CACHE, `stop-${pkg}.sha`);
    if (existsSync(cacheFile) && readFileSync(cacheFile, "utf8") === fp) continue; // unchanged since last green run
    let green = true;
    for (const cmd of cmds) {
      const r = run(cmd, dir);
      if (!r.ok) {
        green = false;
        problems.push(`[${pkg}] \`${cmd}\` zlyhal:\n${tail(r.out)}`);
        break;
      }
    }
    if (green) writeFileSync(cacheFile, fp);
  }
  if (problems.length) {
    fail(
      `Kontroly pred ukončením neprešli. Oprav ich, potom pokračuj.\n\n${problems.join("\n\n")}\n\n` +
        "Ak ide o chybu, ktorá sa môže zopakovať, pridaj riadok do CLAUDE.md → Lessons learned.",
    );
  }
}

try {
  if (mode === "guard") guard();
  else if (mode === "post-edit") postEdit();
  else if (mode === "stop") stop();
} catch (e) {
  // A broken hook must never block work: report and let Claude continue.
  process.stderr.write(`check.mjs (${mode}) interná chyba: ${e?.message ?? e}\n`);
  process.exit(0);
}
