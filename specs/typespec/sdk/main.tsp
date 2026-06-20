// specs/typespec/sdk/main.tsp; canonical target-native validation surfaces.
//
// Root package scripts stay target-neutral. Per-target native
// lint/type/test/build commands and generated-artifact inventories live here
// and are emitted into `codegen/fixtures/sdk-targets.json` for the generic
// check, drift, and cleanup runners.

import "typespec-workflow";

using OpenBox.Workflow;

@sdkTargets(#{
  generatedArtifacts: #{
    generatedRoots: #[
      "specs/generated",
      "python/openbox_sdk/generated",
      "apps/extension/src/generated",
      "example/n8n/custom-node/src/generated",
    ],
    generatedFiles: #[
      "codegen/method-names.json",
      "codegen/method-permissions.json",
      "codegen/fixtures/cli-auth.json",
      "codegen/fixtures/env-resolution.json",
      "codegen/fixtures/govern-protocol.json",
      "codegen/fixtures/provider-capabilities.json",
      "codegen/fixtures/sdk-manifests.json",
      "codegen/fixtures/sdk-targets.json",
    ],
    nestedGeneratedFiles: #[
      #{ root: "ts/src", suffixes: #[".ts", ".d.ts"] },
    ],
  },
  cleanArtifacts: #{
    paths: #[
      "dist",
      "dist-pack",
      "apps/extension/dist",
    ],
    nestedNames: #[
      #{ root: "codegen", names: #["dist", "tsconfig.tsbuildinfo"] },
    ],
    filePatterns: #[
      #{ root: "apps/extension", prefix: "openbox-", suffix: ".vsix" },
    ],
  },
  securityAudit: #{
    commands: #[
      #{ id: "root-npm-audit", label: "root npm audit", command: "npm", args: #["audit"], workingDirectory: "." },
      #{ id: "n8n-npm-audit", label: "n8n npm audit", command: "npm", args: #["audit"], workingDirectory: "example/n8n/custom-node" },
    ],
    secretScanExcludes: #[
      #{ path: "codegen/fixtures/cli-auth.json", reason: "Parser/spec fixture intentionally contains non-secret obx_* examples." },
      #{ path: "codegen/fixtures/env-resolution.json", reason: "Parser/spec fixture intentionally contains non-secret obx_* examples." },
      #{ path: "specs/typespec/cli/main.tsp", reason: "CLI contract fixture intentionally contains non-secret obx_* examples." },
      #{ path: "specs/typespec/env/main.tsp", reason: "Env contract fixture intentionally contains non-secret obx_* examples." },
      #{ path: "tests/e2e/core-client.test.ts", reason: "Core client test fixture intentionally contains deterministic non-secret tokens." },
      #{ path: "tests/unit/core-client.test.ts", reason: "Core client test fixture intentionally contains deterministic non-secret tokens." },
      #{ path: "tests/unit/cursor-mcp-install-coverage.test.ts", reason: "Install fixture intentionally contains deterministic non-secret tokens." },
      #{ path: "tests/unit/runtime-cursor-mappers.test.ts", reason: "Runtime mapper fixture intentionally contains deterministic non-secret tokens." },
    ],
  },
  localCi: #{
    steps: #[
      #{ id: "check-sdks", label: "SDK target validation", command: "npm", args: #["run", "check:sdks"], workingDirectory: "." },
      #{
        id: "coverage",
        label: "Vitest coverage",
        command: "npx",
        args: #["vitest", "run", "--coverage", "--project", "unit", "--project", "contract", "--project", "hook-integration", "--coverage.reporter=lcov"],
        workingDirectory: ".",
        env: #{ OPENBOX_CLI: "./scripts/openbox-cli-dev.mjs" },
      },
      #{ id: "build", label: "Bundle build", command: "npm", args: #["run", "build"], workingDirectory: ".", env: #{ NODE_OPTIONS: "--max-old-space-size=4096" } },
      #{ id: "generated-drift", label: "Generated drift", command: "npm", args: #["run", "check:generated-drift"], workingDirectory: "." },
      #{ id: "generated-banners", label: "Generated banners", command: "npm", args: #["run", "lint:generated-banners"], workingDirectory: "." },
      #{ id: "openapi-lint", label: "OpenAPI lint", command: "npx", args: #["--yes", "@stoplight/spectral-cli", "lint", "specs/generated/openapi3/*.json"], workingDirectory: "." },
      #{ id: "npm-audit", label: "Root npm audit", command: "npm", args: #["audit", "--audit-level=high"], workingDirectory: "." },
      #{ id: "security-audit", label: "Security audit", command: "npm", args: #["run", "audit:security"], workingDirectory: "." },
    ],
  },
  targets: #[
    #{
      id: "typescript",
      label: "TypeScript SDK",
      kind: "sdk",
      workingDirectory: ".",
      commands: #[
        #{ command: "npm", args: #["run", "lint"] },
        #{ command: "npx", args: #["tsc", "--noEmit"] },
        #{
          command: "npm",
          args: #["run", "test"],
          env: #{ OPENBOX_CLI: "./scripts/openbox-cli-dev.mjs" },
        },
      ],
    },
    #{
      id: "python",
      label: "Python SDK",
      kind: "sdk",
      workingDirectory: "python",
      commands: #[
        #{ command: "uv", args: #["run", "--locked", "--extra", "dev", "ruff", "check", "."] },
        #{
          command: "uv",
          args: #["run", "--locked", "--extra", "dev", "mypy", "openbox_sdk", "tests"],
        },
        #{ command: "uv", args: #["run", "--locked", "--extra", "dev", "pytest"] },
        #{ command: "uv", args: #["build"] },
      ],
    },
    #{
      id: "extension",
      label: "VS Code Extension",
      kind: "app",
      workingDirectory: "apps/extension",
      extensionManifest: #{
        packageName: "openbox",
        publisher: "openbox",
        displayName: "OpenBox",
        main: "./dist/extension.js",
        activationEvents: #["onStartupFinished", "onView:openbox.onboard", "onView:openbox.approvals", "onView:openbox.history", "onView:openbox.profile", "onView:openbox.debugControls", "onCommand:openbox.setApiKey", "onCommand:openbox.openDashboard", "onCommand:openbox.openWalkthrough", "onCommand:openbox.reboot"],
        views: #["openbox.onboard", "openbox.approvals", "openbox.history", "openbox.profile", "openbox.debugControls"],
        commands: #["openbox.approve", "openbox.reject", "openbox.refresh", "openbox.openDetail", "openbox.copyDetail", "openbox.search", "openbox.filter", "openbox.filterTier", "openbox.filterType", "openbox.filterTeam", "openbox.filterOwner", "openbox.toggleSort", "openbox.clearFilters", "openbox.loadMore", "openbox.setPageSize", "openbox.history.refresh", "openbox.history.search", "openbox.history.filter", "openbox.history.filterTier", "openbox.history.filterType", "openbox.history.filterTeam", "openbox.history.filterOwner", "openbox.history.toggleSort", "openbox.history.clearFilters", "openbox.history.setStatus", "openbox.history.setDateRange", "openbox.history.loadMore", "openbox.history.setPageSize", "openbox.setApiKey", "openbox.openDashboard", "openbox.clearCredentials", "openbox.signOut", "openbox.reboot", "openbox.openWalkthrough", "openbox.showDebugInfo"],
        configurationKeys: #["openbox.tabObserver.enabled", "openbox.tabObserver.outputLog", "openbox.tabObserver.emitAgentTrace", "openbox.agentId", "openbox.preWriteGate.active", "openbox.tabObserver.active", "openbox.fileOpGate.enabled", "openbox.strictSourceFilter"],
      },
      commands: #[
        #{ command: "npm", args: #["run", "build"] },
        #{ command: "npm", args: #["run", "test"] },
      ],
    },
    #{
      id: "n8n-custom-node",
      label: "n8n Custom Node",
      kind: "app",
      workingDirectory: "example/n8n/custom-node",
      commands: #[
        #{ command: "npm", args: #["ci", "--ignore-scripts"] },
        #{ command: "npm", args: #["run", "build"] },
        #{ command: "npm", args: #["run", "smoke:load"] },
      ],
    },
  ],
})
namespace OpenboxSdk;
