const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSearchQueries,
  scoreConfidence,
  rankRepoCandidates,
  selectRepoFromCandidates,
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
