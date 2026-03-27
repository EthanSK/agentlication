import * as fs from "fs";
import * as path from "path";
import { execFileSync, execFile } from "child_process";
import type {
  AppProfile,
  SourceRepoSearchResult,
  SourceRepoFindResult,
  SourceCloneResult,
} from "@agentlication/contracts";

/**
 * Search GitHub for an app's open source repository using the GitHub CLI.
 *
 * Strategy:
 * 1. Search by app name + "electron" keyword
 * 2. Search by bundle ID if available
 * 3. Rank results by stars and relevance
 */
export async function findSourceRepo(
  appName: string,
  bundleId?: string
): Promise<SourceRepoFindResult> {
  try {
    // Check if `gh` CLI is available
    try {
      execFileSync("which", ["gh"], { stdio: "pipe" });
    } catch {
      return {
        success: false,
        error: "GitHub CLI (gh) is not installed. Install it with: brew install gh",
      };
    }

    // Search GitHub using gh CLI
    const candidates: SourceRepoSearchResult[] = [];

    // Primary search: app name with electron context
    const searchQueries = [
      appName,
      `${appName} electron`,
    ];

    // If bundle ID is available, extract the org/name part for an extra search
    if (bundleId) {
      // e.g. "com.ethansk.producer-player" -> "producer-player"
      const parts = bundleId.split(".");
      const lastPart = parts[parts.length - 1];
      if (lastPart && lastPart !== appName.toLowerCase().replace(/\s+/g, "-")) {
        searchQueries.push(lastPart);
      }
    }

    for (const query of searchQueries) {
      try {
        const result = await execFilePromise(
          "gh",
          [
            "search",
            "repos",
            query,
            "--sort",
            "stars",
            "--order",
            "desc",
            "--limit",
            "5",
            "--json",
            "fullName,url,description,stargazersCount,updatedAt",
          ],
          { timeout: 15000 }
        );

        if (!result.trim()) continue;

        const repos = JSON.parse(result) as Array<{
          fullName: string;
          url: string;
          description: string;
          stargazersCount: number;
          updatedAt: string;
        }>;

        for (const repo of repos) {
          // Avoid duplicates
          if (candidates.some((c) => c.fullName === repo.fullName)) continue;

          const confidence = scoreConfidence(
            repo.fullName,
            repo.description || "",
            repo.stargazersCount,
            appName,
            bundleId
          );

          candidates.push({
            repoUrl: repo.url,
            fullName: repo.fullName,
            description: repo.description || "",
            stars: repo.stargazersCount,
            confidence,
          });
        }
      } catch {
        // Individual search query failed, continue with next
      }
    }

    if (candidates.length === 0) {
      return {
        success: true,
        candidates: [],
        error: "No repositories found matching the app name",
      };
    }

    // Sort by confidence then stars
    const confidenceOrder = { high: 0, medium: 1, low: 2, none: 3 };
    candidates.sort((a, b) => {
      const confDiff = confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
      if (confDiff !== 0) return confDiff;
      return b.stars - a.stars;
    });

    const best = candidates[0];

    // Only auto-select if confidence is high or medium
    if (best.confidence === "high" || best.confidence === "medium") {
      return {
        success: true,
        repo: best,
        candidates,
      };
    }

    return {
      success: true,
      candidates,
      error: "No high-confidence match found. Manual selection may be needed.",
    };
  } catch (err) {
    return {
      success: false,
      error: `Source repo search failed: ${String(err)}`,
    };
  }
}

/**
 * Clone a source repo into the app's profile source/ directory.
 * Uses --depth 1 for speed. Tries to checkout the matching version tag.
 */
export async function cloneSourceRepo(
  profile: AppProfile,
  repoUrl: string,
  profileRoot: string
): Promise<SourceCloneResult> {
  const sourceDir = path.join(profileRoot, profile.slug, "source");

  try {
    // Clean up existing source directory contents if any
    if (fs.existsSync(sourceDir)) {
      const contents = fs.readdirSync(sourceDir);
      if (contents.length > 0) {
        // Source dir already has content -- remove it for a fresh clone
        fs.rmSync(sourceDir, { recursive: true, force: true });
        fs.mkdirSync(sourceDir, { recursive: true });
      }
    } else {
      fs.mkdirSync(sourceDir, { recursive: true });
    }

    // Clone with --depth 1 for speed, using execFile with git directly
    await execFilePromise(
      "git",
      ["clone", "--depth", "1", repoUrl, sourceDir],
      { timeout: 120000 } // 2 min timeout for clone
    );

    // Try to match installed version with a git tag
    let checkedOutVersion: string | undefined;
    if (profile.installedVersion && profile.installedVersion !== "unknown") {
      try {
        // Fetch all tags (shallow clone doesn't include them)
        await execFilePromise("git", ["fetch", "--tags"], {
          cwd: sourceDir,
          timeout: 30000,
        });

        // List tags
        const tagsOutput = await execFilePromise("git", ["tag", "-l"], {
          cwd: sourceDir,
          timeout: 10000,
        });

        if (tagsOutput.trim()) {
          const tags = tagsOutput.trim().split("\n").map((t) => t.trim()).filter(Boolean);
          const version = profile.installedVersion;

          // Try exact matches: v1.2.3, 1.2.3
          const matchingTag = tags.find(
            (t) => t === `v${version}` || t === version
          );

          if (matchingTag) {
            // Fetch the specific tag
            await execFilePromise(
              "git",
              ["fetch", "--depth", "1", "origin", `tag`, matchingTag],
              { cwd: sourceDir, timeout: 30000 }
            );

            await execFilePromise("git", ["checkout", matchingTag], {
              cwd: sourceDir,
              timeout: 10000,
            });

            checkedOutVersion = matchingTag;
          }
        }
      } catch {
        // Version tag matching is best-effort -- not critical
      }
    }

    return {
      success: true,
      clonedTo: sourceDir,
      checkedOutVersion,
    };
  } catch (err) {
    return {
      success: false,
      error: `Clone failed: ${String(err)}`,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Promise wrapper around execFile to avoid shell injection risks.
 */
function execFilePromise(
  cmd: string,
  args: string[],
  options?: { timeout?: number; cwd?: string }
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        encoding: "utf-8",
        timeout: options?.timeout ?? 30000,
        cwd: options?.cwd,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${cmd} failed: ${stderr || error.message}`));
        } else {
          resolve(stdout);
        }
      }
    );
  });
}

/**
 * Score how confident we are that a repo matches the target app.
 */
function scoreConfidence(
  fullName: string,
  description: string,
  stars: number,
  appName: string,
  bundleId?: string
): "high" | "medium" | "low" | "none" {
  const repoName = fullName.split("/")[1]?.toLowerCase() || "";
  const normalizedAppName = appName.toLowerCase().replace(/\s+/g, "-");
  const normalizedAppNameNoSpaces = appName.toLowerCase().replace(/\s+/g, "");
  const descLower = description.toLowerCase();

  // High confidence: repo name matches app name closely
  if (
    repoName === normalizedAppName ||
    repoName === normalizedAppNameNoSpaces ||
    repoName === normalizedAppName.replace(/-/g, "")
  ) {
    return "high";
  }

  // High confidence: bundle ID contains repo name
  if (bundleId) {
    const bundleParts = bundleId.toLowerCase().split(".");
    if (bundleParts.some((part) => part === repoName)) {
      return "high";
    }
  }

  // Medium confidence: repo name contains the app name or vice versa
  if (
    repoName.includes(normalizedAppName) ||
    normalizedAppName.includes(repoName)
  ) {
    if (stars > 10) return "medium";
    return "low";
  }

  // Medium confidence: description mentions the app name and has decent stars
  if (descLower.includes(normalizedAppName) && stars > 50) {
    return "medium";
  }

  // Low confidence: description mentions electron and app name
  if (
    descLower.includes("electron") &&
    (descLower.includes(appName.toLowerCase()) || repoName.includes(normalizedAppName.slice(0, 4)))
  ) {
    return "low";
  }

  return "none";
}
