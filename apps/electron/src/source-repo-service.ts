import * as fs from "fs";
import * as path from "path";
import { execFileSync, execFile } from "child_process";
import type {
  AppProfile,
  SourceRepoSearchResult,
  SourceRepoFindResult,
  SourceCloneResult,
} from "@agentlication/contracts";

type ConfidenceLevel = SourceRepoSearchResult["confidence"];

interface GitHubRepoSearchRow {
  fullName: string;
  url: string;
  description: string;
  stargazersCount: number;
  updatedAt: string;
}

interface ScoredCandidate {
  candidate: SourceRepoSearchResult;
  score: number;
}

const CONFIDENCE_ORDER: Record<ConfidenceLevel, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

const HIGH_CONFIDENCE_THRESHOLD = 90;
const MEDIUM_CONFIDENCE_THRESHOLD = 55;
const LOW_CONFIDENCE_THRESHOLD = 25;

const GENERIC_BUNDLE_VENDORS = new Set([
  "com",
  "org",
  "net",
  "io",
  "app",
  "electron",
  "github",
  "www",
  "mac",
]);

const GENERIC_REPO_KEYWORDS = [
  "theme",
  "themes",
  "plugin",
  "plugins",
  "extension",
  "extensions",
  "sdk",
  "api",
  "bot",
  "wrapper",
  "client",
  "enhancer",
  "mod",
  "integration",
  "tool",
  "tools",
  "awesome",
  "list",
];

/**
 * Search GitHub for an app's open source repository using the GitHub CLI.
 *
 * Strategy:
 * 1. Build query variants from app name + bundle ID
 * 2. Score and rank candidate repos for confidence
 * 3. Auto-select only HIGH confidence matches
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

    const searchQueries = buildSearchQueries(appName, bundleId);
    const rawCandidates: GitHubRepoSearchRow[] = [];

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
            "8",
            "--json",
            "fullName,url,description,stargazersCount,updatedAt",
          ],
          { timeout: 15000 }
        );

        if (!result.trim()) continue;

        const repos = JSON.parse(result) as GitHubRepoSearchRow[];
        rawCandidates.push(...repos);
      } catch {
        // Individual search query failed, continue with next
      }
    }

    const candidates = rankRepoCandidates(rawCandidates, appName, bundleId);

    if (candidates.length === 0) {
      return {
        success: true,
        candidates: [],
        error: "No repositories found matching the app name",
      };
    }

    const selection = selectRepoFromCandidates(candidates);

    if (selection.repo) {
      return {
        success: true,
        repo: selection.repo,
        candidates,
      };
    }

    return {
      success: true,
      candidates,
      error:
        selection.error ||
        "No high-confidence match found. Please choose from candidates manually.",
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
          const tags = tagsOutput
            .trim()
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean);
          const version = profile.installedVersion;

          // Try exact matches: v1.2.3, 1.2.3
          const matchingTag = tags.find((t) => t === `v${version}` || t === version);

          if (matchingTag) {
            // Fetch the specific tag
            await execFilePromise(
              "git",
              ["fetch", "--depth", "1", "origin", "tag", matchingTag],
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

// ── Query/ranking helpers ─────────────────────────────────────

/** Build search query variants for better recall across naming styles. */
export function buildSearchQueries(appName: string, bundleId?: string): string[] {
  const trimmed = appName.trim();
  const tokens = splitNameTokens(trimmed);
  const kebab = tokens.join("-");
  const noSpace = tokens.join("");

  const queries = new Set<string>();

  // Required variants
  if (trimmed) queries.add(trimmed); // raw
  if (kebab) queries.add(kebab); // kebab-case
  if (noSpace) queries.add(noSpace); // no-space
  if (trimmed) queries.add(`"${trimmed}"`); // quoted exact name

  // Context variants
  if (trimmed) queries.add(`${trimmed} electron`);
  if (kebab && kebab !== trimmed.toLowerCase()) {
    queries.add(`${kebab} electron`);
  }

  // Bundle ID variant
  const bundleInfo = parseBundleInfo(bundleId);
  if (bundleInfo.tail) {
    queries.add(bundleInfo.tail);
  }

  return Array.from(queries).filter(Boolean);
}

/** Convert raw GitHub rows into ranked candidates with confidence labels. */
export function rankRepoCandidates(
  repos: GitHubRepoSearchRow[],
  appName: string,
  bundleId?: string
): SourceRepoSearchResult[] {
  const deduped = new Map<string, ScoredCandidate>();

  for (const repo of repos) {
    const fullName = repo.fullName?.trim();
    if (!fullName) continue;

    const score = scoreRepoMatch(
      fullName,
      repo.description || "",
      repo.stargazersCount || 0,
      appName,
      bundleId
    );
    const confidence = confidenceFromScore(score);

    const candidate: SourceRepoSearchResult = {
      repoUrl: repo.url,
      fullName,
      description: repo.description || "",
      stars: repo.stargazersCount || 0,
      confidence,
    };

    const existing = deduped.get(fullName);
    if (!existing || score > existing.score) {
      deduped.set(fullName, { candidate, score });
    }
  }

  const scored = Array.from(deduped.values());
  scored.sort((a, b) => {
    const confidenceDiff =
      CONFIDENCE_ORDER[a.candidate.confidence] - CONFIDENCE_ORDER[b.candidate.confidence];
    if (confidenceDiff !== 0) return confidenceDiff;

    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;

    return b.candidate.stars - a.candidate.stars;
  });

  return scored.map((s) => s.candidate);
}

/**
 * Auto-select only HIGH-confidence matches.
 * Medium/low must be explicit user choice from candidates.
 */
export function selectRepoFromCandidates(candidates: SourceRepoSearchResult[]): {
  repo?: SourceRepoSearchResult;
  error?: string;
} {
  if (candidates.length === 0) {
    return { error: "No repositories found matching the app name" };
  }

  const best = candidates[0];
  if (best.confidence === "high") {
    return { repo: best };
  }

  return {
    error:
      `Top match is ${best.confidence} confidence. ` +
      "Please choose a repository manually from the candidate list.",
  };
}

/**
 * Score how confident we are that a repo matches the target app.
 */
export function scoreConfidence(
  fullName: string,
  description: string,
  stars: number,
  appName: string,
  bundleId?: string
): ConfidenceLevel {
  return confidenceFromScore(scoreRepoMatch(fullName, description, stars, appName, bundleId));
}

function scoreRepoMatch(
  fullName: string,
  description: string,
  stars: number,
  appName: string,
  bundleId?: string
): number {
  const [ownerRaw = "", repoRaw = ""] = fullName.split("/");

  const owner = normalizeToken(ownerRaw);
  const repoName = normalizeToken(repoRaw);
  const repoTokens = splitNameTokens(repoRaw);

  const appTokens = splitNameTokens(appName);
  const appVariants = buildNameVariants(appName);
  const primaryAppVariant = appVariants[0] || normalizeToken(appName);
  const isSingleTokenApp = appTokens.length <= 1;

  const bundleInfo = parseBundleInfo(bundleId);
  const descLower = description.toLowerCase();
  const repoRawLower = repoRaw.toLowerCase();

  const repoNameExactVariant = appVariants.some((variant) => variant === repoName);
  const repoContainsVariant = appVariants.some(
    (variant) => variant.length >= 4 && variant !== repoName && repoName.includes(variant)
  );

  const sharedRepoTokenCount = repoTokens.filter((token) => appTokens.includes(token)).length;
  const repoContainsAllAppTokens =
    appTokens.length > 0 && appTokens.every((token) => repoTokens.includes(token));

  const bundleTailMatch = !!bundleInfo.tail && bundleInfo.tail === repoName;
  const bundleOwnerMatch = !!bundleInfo.vendor && bundleInfo.vendor === owner;

  const hasExactDescriptionMatch = descriptionMentionsApp(descLower, appName, appTokens);
  const hasGenericRepoKeywords = GENERIC_REPO_KEYWORDS.some(
    (keyword) => repoRawLower.includes(keyword) || descLower.includes(keyword)
  );

  const hasRepoNameSignal =
    repoNameExactVariant ||
    repoContainsVariant ||
    repoContainsAllAppTokens ||
    sharedRepoTokenCount > 0 ||
    bundleTailMatch;

  let score = 0;

  // Strongest signal: exact normalized repo-name match
  if (repoNameExactVariant) {
    score += isSingleTokenApp ? 55 : 80;
    if (!isSingleTokenApp) {
      score += 15;
    }
  } else {
    // Token-based name similarity
    if (repoContainsAllAppTokens) {
      score += isSingleTokenApp ? 18 : 45;
    }

    if (sharedRepoTokenCount > 0) {
      score += Math.min(sharedRepoTokenCount * 8, 20);
    }

    if (repoContainsVariant) {
      score += isSingleTokenApp ? 8 : 16;
    }
  }

  // Bundle ID alignment (helps official repos where owner/vendor align)
  if (bundleTailMatch) {
    score += isSingleTokenApp ? 8 : 25;
  }

  if (bundleOwnerMatch) {
    if (bundleInfo.vendor && !GENERIC_BUNDLE_VENDORS.has(bundleInfo.vendor)) {
      score += 35;
    } else {
      score += 12;
    }
  }

  // Description is supporting evidence only (never primary)
  if (hasExactDescriptionMatch) {
    score += 8;
  }

  if (hasExactDescriptionMatch && !hasRepoNameSignal) {
    // Description-only matches are noisy, especially for closed-source apps.
    score -= 25;
  }

  // Single-token app names are very collision-prone (Notion, Slack, Discord, etc.)
  if (isSingleTokenApp && !repoNameExactVariant && hasRepoNameSignal) {
    score -= 12;
  }

  // Generic "plugin/theme/sdk/api/client" repos should not outrank likely source repos
  if (hasGenericRepoKeywords && !repoNameExactVariant) {
    score -= 25;
  }

  // Stars help break ties, but should not dominate relevance.
  if (stars > 0) {
    score += Math.min(10, Math.round(Math.log10(stars + 1) * 2));
  }

  // Light penalty for very short variants to reduce accidental substring hits
  if (primaryAppVariant.length < 4 && !repoNameExactVariant) {
    score -= 8;
  }

  return score;
}

function confidenceFromScore(score: number): ConfidenceLevel {
  if (score >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (score >= MEDIUM_CONFIDENCE_THRESHOLD) return "medium";
  if (score >= LOW_CONFIDENCE_THRESHOLD) return "low";
  return "none";
}

function descriptionMentionsApp(
  descLower: string,
  appName: string,
  appTokens: string[]
): boolean {
  const trimmedAppName = appName.trim().toLowerCase();
  if (trimmedAppName && descLower.includes(trimmedAppName)) {
    return true;
  }

  if (appTokens.length >= 2) {
    return appTokens.every((token) => descLower.includes(token));
  }

  return appTokens.length === 1 && descLower.includes(appTokens[0]);
}

function buildNameVariants(appName: string): string[] {
  const tokens = splitNameTokens(appName);
  if (tokens.length === 0) return [];

  const variants = new Set<string>();

  variants.add(normalizeToken(appName));
  variants.add(normalizeToken(tokens.join("-")));
  variants.add(normalizeToken(tokens.join("")));

  // Acronym, e.g. Visual Studio Code -> vsc
  variants.add(tokens.map((token) => token[0]).join(""));

  // Short-code variant, e.g. Visual Studio Code -> vscode
  if (tokens.length >= 2) {
    const shortCode = `${tokens
      .slice(0, -1)
      .map((token) => token[0])
      .join("")}${tokens[tokens.length - 1]}`;
    variants.add(normalizeToken(shortCode));
  }

  return Array.from(variants).filter(Boolean);
}

function splitNameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseBundleInfo(bundleId?: string): { vendor?: string; tail?: string } {
  if (!bundleId) return {};

  const parts = bundleId
    .split(".")
    .map((part) => normalizeToken(part))
    .filter(Boolean);

  if (parts.length === 0) return {};

  const vendor = parts.length >= 2 ? parts[1] : parts[0];
  const tail = parts[parts.length - 1];

  return { vendor, tail };
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
