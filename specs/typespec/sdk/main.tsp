// specs/typespec/sdk/main.tsp; canonical SDK validation targets.
//
// Root package scripts stay language-neutral. Per-target native
// lint/type/test/build commands live here and are emitted into
// `codegen/fixtures/sdk-targets.json` for the generic check runner.

import "typespec-workflow";

using OpenBox.Workflow;

@sdkTargets(#{
  targets: #[
    #{
      id: "typescript",
      label: "TypeScript SDK",
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
  ],
})
namespace OpenboxSdk;
