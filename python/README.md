# OpenBox SDK for Python

Python package for OpenBox backend and core governance APIs.

```python
from openbox_sdk import AsyncOpenBoxCoreClient, govern, presets

core = AsyncOpenBoxCoreClient(api_key="obx_test_...")

async def run() -> dict:
    async def body(session):
        return await session.pre_tool_use({"toolName": "Read"})

    return await govern(core=core, preset=presets.claude_code, body=body)
```

Generated files live under `openbox_sdk/generated/` and are derived from the
monorepo TypeSpec/OpenAPI output. Regenerate them from the repo root with:

```bash
npm run generate:python
```
