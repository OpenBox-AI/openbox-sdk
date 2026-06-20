// specs/typespec/sdk/main.tsp; canonical target-native validation surfaces.
//
// Root package scripts stay target-neutral. Per-target native
// lint/type/test/build commands live here and are emitted into
// `codegen/fixtures/sdk-targets.json` for the generic check runner.

import "typespec-workflow";

using OpenBox.Workflow;

@sdkTargets(#{
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
