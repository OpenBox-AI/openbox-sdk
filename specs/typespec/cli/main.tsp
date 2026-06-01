// Lean `openbox` CLI metadata namespace.
//
// The main CLI product is hand-authored around:
// auth/config/connect, install/uninstall, doctor/health/versions,
// Cursor/Claude Code/MCP runtime entrypoints, and the compact
// `openbox api backend|core <operationId>` caller backed by endpoint
// manifests from the Backend/Core TypeSpec specs.
//
// Do not reintroduce generated CRUD/admin command trees here.

namespace OpenboxCli {}
