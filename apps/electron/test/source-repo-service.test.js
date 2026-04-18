const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSearchQueries,
  scoreConfidence,
  rankRepoCandidates,
  selectRepoFromCandidates,
  isSafeGitRepoUrl,
  isSafeGitRef,
} = require("../dist/source-repo-service.js");

function repo(fullName, description, stars) {
  return {
    fullName,
    url: `https://github.com/${fullName}`,
    description,
    stargazersCount: stars,
    updatedAt: "2026-04-01T00:00:00Z",
  };
}

test("buildSearchQueries includes raw/kebab/no-space/quoted variants", () => {
  const queries = buildSearchQueries("Visual Studio Code", "com.microsoft.VSCode");

  assert.ok(queries.includes("Visual Studio Code"));
  assert.ok(queries.includes("visual-studio-code"));
  assert.ok(queries.includes("visualstudiocode"));
  assert.ok(queries.includes('"Visual Studio Code"'));
});

test("description-only generic matches are down-ranked", () => {
  const confidence = scoreConfidence(
    "someone/random-repo",
    "Unofficial plugin for Notion workspace",
    5000,
    "Notion",
    "com.electron.notion"
  );

  assert.notEqual(confidence, "high");
});

const scenarios = [
  {
    appName: "Visual Studio Code",
    bundleId: "com.microsoft.VSCode",
    repos: [
      repo("microsoft/vscode", "Visual Studio Code", 173000),
      repo("vscode-icons/vscode-icons", "Icons extension for VS Code", 17000),
      repo("foo/vscode-theme-pack", "Theme plugin for VS Code", 2000),
    ],
    expectAutoRepo: "microsoft/vscode",
  },
  {
    appName: "Notion",
    bundleId: "com.electron.notion",
    repos: [
      repo("notion/notion", "Community tooling around Notion", 12000),
      repo("notion-enhancer/notion-enhancer", "Enhancement tool for Notion app", 9000),
      repo("ramnes/notion-sdk-py", "Python SDK for Notion API", 4000),
    ],
    expectNoAuto: true,
  },
  {
    appName: "Slack",
    bundleId: "com.tinyspeck.slackmacgap",
    repos: [
      repo("slackapi/node-slack-sdk", "Slack API SDK for Node.js", 8200),
      repo("claabs/slack-cleaner2", "Tooling for Slack", 2200),
      repo("someone/slack-theme-pack", "Theme plugin for Slack desktop", 500),
    ],
    expectNoAuto: true,
  },
  {
    appName: "Discord",
    bundleId: "com.hnc.Discord",
    repos: [
      repo("BetterDiscord/BetterDiscord", "Client mod for Discord", 13000),
      repo("discordjs/discord.js", "Powerful library for Discord API", 25000),
      repo("someone/discord-theme", "Theme plugin for Discord", 1500),
    ],
    expectNoAuto: true,
  },
  {
    appName: "Producer Player",
    bundleId: "com.ethansk.producer-player",
    repos: [
      repo("EthanSK/producer-player", "Producer Player desktop app", 42),
      repo("someone/producer-player-theme", "Theme plugin for Producer Player", 12),
    ],
    expectAutoRepo: "EthanSK/producer-player",
  },
  {
    appName: "Fake App",
    bundleId: "com.fake.app",
    repos: [
      repo("foo/bar", "Totally unrelated utility", 5500),
      repo("someone/fake-plugin", "Plugin for fake data", 100),
    ],
    expectNoAuto: true,
  },
];

for (const scenario of scenarios) {
  test(`edge-case selection: ${scenario.appName}`, () => {
    const ranked = rankRepoCandidates(scenario.repos, scenario.appName, scenario.bundleId);
    const selection = selectRepoFromCandidates(ranked);

    if (scenario.expectAutoRepo) {
      assert.equal(selection.repo?.fullName, scenario.expectAutoRepo);
      assert.equal(ranked[0]?.confidence, "high");
      return;
    }

    assert.equal(selection.repo, undefined);
    assert.notEqual(ranked[0]?.confidence, "high");
  });
}

// ─────────────────────────────────────────────────────────────────────
// Security: isSafeGitRepoUrl / isSafeGitRef
//
// Before the fix, `cloneSourceRepo` passed a renderer-supplied `repoUrl`
// straight to `git clone --depth 1 <url> <dest>`. Because git accepts
// `--upload-pack=...` / `--config=...` as flags, a URL like
// `--upload-pack=/tmp/pwn.sh` would cause `git clone` to execute an
// arbitrary command under the Electron main process (CVE-2017-1000117
// class). These tests lock in the validator so a regression immediately
// fails CI instead of shipping a main-process RCE.
// ─────────────────────────────────────────────────────────────────────

test("isSafeGitRepoUrl: accepts standard GitHub HTTPS URLs", () => {
  assert.equal(isSafeGitRepoUrl("https://github.com/EthanSK/producer-player"), true);
  assert.equal(isSafeGitRepoUrl("https://github.com/EthanSK/producer-player.git"), true);
  assert.equal(isSafeGitRepoUrl("http://example.com/repo.git"), true);
});

test("isSafeGitRepoUrl: accepts git:// and ssh:// URLs", () => {
  assert.equal(isSafeGitRepoUrl("git://github.com/foo/bar.git"), true);
  assert.equal(isSafeGitRepoUrl("ssh://git@github.com/foo/bar.git"), true);
  assert.equal(isSafeGitRepoUrl("git+ssh://git@github.com/foo/bar.git"), true);
});

test("isSafeGitRepoUrl: accepts SCP-style git@host:owner/repo", () => {
  assert.equal(isSafeGitRepoUrl("git@github.com:EthanSK/agentlication.git"), true);
  assert.equal(isSafeGitRepoUrl("git@gitlab.com:group/subgroup/repo"), true);
});

test("isSafeGitRepoUrl: rejects flag-like URLs (the actual bug)", () => {
  // These were exploitable before the fix. If this test ever regresses,
  // an attacker-controlled repoUrl becomes arbitrary command execution.
  assert.equal(isSafeGitRepoUrl("--upload-pack=/tmp/pwn.sh"), false);
  assert.equal(isSafeGitRepoUrl("--config=core.sshCommand=touch /tmp/pwn"), false);
  assert.equal(isSafeGitRepoUrl("-u"), false);
  assert.equal(isSafeGitRepoUrl("-"), false);
  // Leading whitespace still resolves to a `-`-prefixed trimmed value
  assert.equal(isSafeGitRepoUrl("   --upload-pack=x"), false);
});

test("isSafeGitRepoUrl: rejects whitespace/control-char smuggling", () => {
  assert.equal(isSafeGitRepoUrl("https://github.com/foo bar"), false);
  assert.equal(isSafeGitRepoUrl("https://github.com/foo\nbar"), false);
  assert.equal(isSafeGitRepoUrl("https://github.com/foo\x00bar"), false);
});

test("isSafeGitRepoUrl: rejects non-strings and empty values", () => {
  assert.equal(isSafeGitRepoUrl(""), false);
  assert.equal(isSafeGitRepoUrl("   "), false);
  assert.equal(isSafeGitRepoUrl(null), false);
  assert.equal(isSafeGitRepoUrl(undefined), false);
  assert.equal(isSafeGitRepoUrl(42), false);
  assert.equal(isSafeGitRepoUrl({}), false);
});

test("isSafeGitRepoUrl: rejects schemes we don't expect", () => {
  // file:// and javascript: are pathological — refuse them even though
  // they don't start with `-`.
  assert.equal(isSafeGitRepoUrl("file:///etc/passwd"), false);
  assert.equal(isSafeGitRepoUrl("javascript:alert(1)"), false);
  assert.equal(isSafeGitRepoUrl("ftp://example.com/repo"), false);
});

test("isSafeGitRef: accepts typical version tags", () => {
  assert.equal(isSafeGitRef("v1.2.3"), true);
  assert.equal(isSafeGitRef("1.2.3"), true);
  assert.equal(isSafeGitRef("release/2.0"), true);
  assert.equal(isSafeGitRef("refs/tags/v1"), true);
});

test("isSafeGitRef: rejects flag-like or whitespace-bearing refs", () => {
  // A malicious cloned repo could ship a tag named `--upload-pack=...`
  // that then flows into `git fetch ... tag <ref>`. Filter it.
  assert.equal(isSafeGitRef("--upload-pack=/tmp/pwn.sh"), false);
  assert.equal(isSafeGitRef("-v1"), false);
  assert.equal(isSafeGitRef("v 1.0"), false);
  assert.equal(isSafeGitRef("v1;ls"), false);
  assert.equal(isSafeGitRef(""), false);
  assert.equal(isSafeGitRef(null), false);
});
