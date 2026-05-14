import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noPush = args.includes("--no-push");
const bump = args.find((arg) => !arg.startsWith("--"));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function usage() {
  return [
    "Usage: bun scripts/release-version.mjs <patch|minor|major|x.y.z> [--dry-run] [--no-push]",
    "",
    "Examples:",
    "  bun run release:patch",
    "  bun run release:minor -- --no-push",
    "  bun run release:version -- 1.2.3",
  ].join("\n");
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.status !== 0 && !options.allowFailure) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr || `${command} ${commandArgs.join(" ")} failed`);
  }

  return result;
}

function read(command, commandArgs) {
  return run(command, commandArgs, { capture: true }).stdout.trim();
}

function parseSemver(value) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error(`Invalid semver version: ${value}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function nextVersion(currentVersion, release) {
  if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(release)) return release;

  const current = parseSemver(currentVersion);
  if (release === "major") return `${current.major + 1}.0.0`;
  if (release === "minor") return `${current.major}.${current.minor + 1}.0`;
  if (release === "patch") return `${current.major}.${current.minor}.${current.patch + 1}`;

  throw new Error(`Unknown release version "${release}".\n\n${usage()}`);
}

function assertCleanTree() {
  const status = read("git", ["status", "--porcelain"]);
  if (status) {
    throw new Error(`Release needs a clean working tree. Commit or stash these changes first:\n${status}`);
  }
}

function assertMainMatchesOrigin() {
  const branch = read("git", ["branch", "--show-current"]);
  if (branch !== "main") {
    throw new Error(`Release must run from main. Current branch: ${branch || "(detached)"}`);
  }

  run("git", ["fetch", "origin", "main", "--tags"]);
  const local = read("git", ["rev-parse", "HEAD"]);
  const remote = read("git", ["rev-parse", "origin/main"]);
  if (local !== remote) {
    throw new Error("Local main must match origin/main before releasing. Pull or push first.");
  }
}

function assertTagIsUnused(tag) {
  const localTag = run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], {
    allowFailure: true,
    capture: true,
  });
  if (localTag.status === 0) throw new Error(`Tag ${tag} already exists locally.`);

  const remoteTag = run("git", ["ls-remote", "--exit-code", "--tags", "origin", tag], {
    allowFailure: true,
    capture: true,
  });
  if (remoteTag.status === 0) throw new Error(`Tag ${tag} already exists on origin.`);
}

async function writeJson(path, update) {
  const url = new URL(path, import.meta.url);
  const json = JSON.parse(await readFile(url, "utf8"));
  update(json);
  await writeFile(url, `${JSON.stringify(json, null, 2)}\n`);
}

async function replaceFile(path, replacements) {
  const url = new URL(path, import.meta.url);
  let content = await readFile(url, "utf8");

  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(content)) {
      throw new Error(`Could not update ${path}: missing ${pattern}`);
    }
    content = content.replace(pattern, replacement);
  }

  await writeFile(url, content);
}

if (!bump) {
  throw new Error(usage());
}

const packageUrl = new URL("../package.json", import.meta.url);
const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
const version = nextVersion(packageJson.version, bump);
const tag = `v${version}`;

if (dryRun) {
  console.log(`Would release ${tag}`);
  process.exit(0);
}

assertCleanTree();
assertMainMatchesOrigin();
assertTagIsUnused(tag);

await writeJson("../package.json", (json) => {
  json.version = version;
});

await writeJson("../src-tauri/tauri.conf.json", (json) => {
  json.version = version;
});

await replaceFile("../src-tauri/Cargo.toml", [[/^version = ".*"$/m, `version = "${version}"`]]);

run("bun", ["run", "build"]);
run("git", ["add", "package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]);
run("git", ["commit", "-m", `Release ${tag}`]);
run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);

if (noPush) {
  console.log(`Created local release commit and tag ${tag}. Push with:`);
  console.log(`  git push origin main ${tag}`);
} else {
  run("git", ["push", "origin", "main", tag]);
  console.log(`Released ${tag}. GitHub Actions will build and publish the desktop app.`);
}
