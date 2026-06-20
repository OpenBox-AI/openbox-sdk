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
