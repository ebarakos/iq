#!/usr/bin/env -S node --import tsx

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SECRET_NAME = "QUIZ_TOKEN_SECRET";
const TARGETS = ["production", "preview"] as const;
const VERCEL_PACKAGE = "vercel@latest";
const CUSTOM_DOMAIN = "iq.ebarakos.com";

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const baseArgs = ["--yes", VERCEL_PACKAGE];

function printHelp(): void {
  console.log(`Usage: npm run vercel:setup [-- --dry-run]

One-time Vercel bootstrap for aiq:
  1. Link or create the Vercel project.
  2. Create missing ${SECRET_NAME} values for production and preview.
  3. Mark new values as sensitive so Vercel never displays them.
  4. Connect the repository's origin remote for deployments on git push.
  5. Attach ${CUSTOM_DOMAIN} to the production project and inspect its DNS state.

Existing secrets are kept. This command never rotates them or forcibly moves a domain.`);
}

function vercelArgs(args: readonly string[]): string[] {
  return [...baseArgs, ...args];
}

function runInteractive(args: readonly string[], input?: string): void {
  const result = spawnSync(npxCommand, vercelArgs(args), {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: "1" },
    input,
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`Could not start the Vercel CLI: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Vercel CLI exited with status ${result.status ?? "unknown"}.`);
  }
}

function runCaptured(args: readonly string[]): { status: number; output: string } {
  const result = spawnSync(npxCommand, vercelArgs(args), {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`Could not start the Vercel CLI: ${result.error.message}`);
  }
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

function environmentHasSecret(target: (typeof TARGETS)[number]): boolean {
  const result = runCaptured(["env", "ls", target]);
  if (result.status !== 0) {
    throw new Error(`Could not inspect Vercel's ${target} environment.`);
  }
  return result.output.split(/\s+/).includes(SECRET_NAME);
}

function ensureSecret(target: (typeof TARGETS)[number]): void {
  if (environmentHasSecret(target)) {
    console.log(`${target}: keeping the existing ${SECRET_NAME}.`);
    return;
  }

  // The value goes straight from memory to the CLI's stdin. It is never printed
  // or written to disk, and --sensitive makes it unreadable in Vercel after creation.
  const secret = randomBytes(32).toString("hex");
  runInteractive(["env", "add", SECRET_NAME, target, "--sensitive"], secret);
  console.log(`${target}: created a sensitive ${SECRET_NAME}.`);
}

function requireOrigin(): void {
  const remote = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (remote.status !== 0 || !remote.stdout.trim()) {
    throw new Error(
      "Git has no origin remote. Add the repository URL as origin before running Vercel setup; " +
        "without a remote, git push cannot trigger a deployment.",
    );
  }
}

function connectGit(): void {
  const result = runCaptured(["git", "connect", "--yes"]);
  if (result.status === 0) {
    console.log("git: connected origin to the Vercel project.");
    return;
  }

  const normalized = result.output.toLowerCase();
  if (normalized.includes("already connected") && !normalized.includes("another")) {
    console.log("git: origin is already connected to this Vercel project.");
    return;
  }
  throw new Error(`Could not connect the Git repository to Vercel.\n${result.output.trim()}`);
}

function linkedProjectName(): string {
  try {
    const project = JSON.parse(readFileSync(".vercel/project.json", "utf8")) as {
      projectName?: unknown;
      projectId?: unknown;
    };
    const name = typeof project.projectName === "string" && project.projectName.length > 0
      ? project.projectName
      : typeof project.projectId === "string" && project.projectId.length > 0
        ? project.projectId
        : null;
    if (name) return name;
  } catch {
    // The message below describes both a missing file and malformed link data.
  }
  throw new Error("Vercel linked the directory without recording a project name or id.");
}

function ensureDomain(): void {
  const projectName = linkedProjectName();
  const added = runCaptured(["domains", "add", CUSTOM_DOMAIN, projectName]);
  if (added.status !== 0) {
    const inspected = runCaptured(["domains", "inspect", CUSTOM_DOMAIN]);
    const inspection = inspected.output.toLowerCase();
    if (
      inspected.status === 0 &&
      inspection.includes(projectName.toLowerCase()) &&
      !inspection.includes("another project")
    ) {
      console.log(`domain: ${CUSTOM_DOMAIN} is already attached to this project.`);
      return;
    }
    throw new Error(
      `Could not attach ${CUSTOM_DOMAIN}. The setup command will not use --force because that ` +
        `could remove it from another site.\n${added.output.trim()}`,
    );
  }

  console.log(`domain: attached ${CUSTOM_DOMAIN} to ${projectName}.`);
  const inspected = runCaptured(["domains", "inspect", CUSTOM_DOMAIN]);
  if (inspected.status !== 0) {
    console.warn(`domain: attached, but Vercel could not inspect ${CUSTOM_DOMAIN} yet.`);
    return;
  }
  const status = inspected.output.trim();
  if (status) console.log(status);
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    printHelp();
    return;
  }
  if (args.has("--dry-run")) {
    requireOrigin();
    console.log(
      `Would link the Vercel project, create missing sensitive ${SECRET_NAME} values for ` +
        `${TARGETS.join(" and ")}, connect the origin Git remote, and attach ${CUSTOM_DOMAIN}. ` +
        "Existing values would stay unchanged.",
    );
    return;
  }
  const unknown = [...args].filter((arg) => !["--help", "-h", "--dry-run"].includes(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown option: ${unknown.join(", ")}`);
  }

  // Check every local prerequisite before creating a project or changing its secrets.
  requireOrigin();
  console.log("Linking this directory to Vercel. Sign in if the CLI asks you to.");
  runInteractive(["link", "--yes"]);
  for (const target of TARGETS) ensureSecret(target);
  connectGit();
  ensureDomain();
  console.log(
    `Vercel setup is complete. Future pushes deploy through Git, and production is assigned to ${CUSTOM_DOMAIN}.`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
