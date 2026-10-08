import { execFileSync } from "node:child_process";

export function vtoBuildInfo(root, environment = process.env) {
  const git = (args, fallback) => {
    try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { return fallback; }
  };
  const vercelCommit = environment.VERCEL_GIT_COMMIT_SHA;
  return { commit: vercelCommit || git(["rev-parse", "HEAD"], "unavailable"),
    branch: environment.VERCEL_GIT_COMMIT_REF || git(["branch", "--show-current"], "unavailable"),
    dirty: vercelCommit ? false : Boolean(git(["status", "--porcelain", "--untracked-files=normal"], "unknown")),
    builtAt: new Date().toISOString(), deployment: environment.VERCEL_URL || null };
}
