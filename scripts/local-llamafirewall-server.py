#!/usr/bin/env python3
"""Local LlamaFirewall HTTP adapter for OpenBox local-stack checks.

Run with:
  OLLAMA_API_KEY=ollama \
  LLAMAFIREWALL_MODEL=qwen2.5-coder:7b \
  LLAMAFIREWALL_API_BASE_URL=http://127.0.0.1:11434/v1 \
  uv run --no-project --with llamafirewall==1.0.3 --with fastapi --with uvicorn \
    scripts/local-llamafirewall-server.py

Or with a caller-provided endpoint:
  OPENAI_COMPAT_BASE_URL=http://127.0.0.1:8317/v1 \
  OPENAI_COMPAT_MODEL=your-model \
  OPENAI_COMPAT_API_KEY=your-key \
  npm run local:llamafirewall
"""

from __future__ import annotations

import os
from typing import Any, Literal

import uvicorn
from openai import AsyncOpenAI
from fastapi import FastAPI
from pydantic import BaseModel, Field

from llamafirewall import AssistantMessage, UserMessage
from llamafirewall.llamafirewall_data_types import (
    Role,
    ScanDecision,
    ScanResult,
    ScanStatus,
)
from llamafirewall.scanners.custom_check_scanner import CustomCheckScanner
from llamafirewall.scanners.experimental.alignmentcheck_scanner import (
    AlignmentCheckOutputSchema,
    SYSTEM_PROMPT,
    USER_PROMPT_FORMAT,
)


MODEL_NAME = os.getenv("LLAMAFIREWALL_MODEL", "qwen2.5-coder:7b")
API_BASE_URL = os.getenv("LLAMAFIREWALL_API_BASE_URL", "http://127.0.0.1:11434/v1")
API_KEY_ENV_VAR = os.getenv("LLAMAFIREWALL_API_KEY_ENV_VAR", "OLLAMA_API_KEY")
STRUCTURED_OUTPUT_MODE = os.getenv("LLAMAFIREWALL_STRUCTURED_OUTPUT_MODE", "response_format")
PORT = int(os.getenv("LLAMAFIREWALL_PORT", "8184"))


class LocalAlignmentCheckScanner(CustomCheckScanner[AlignmentCheckOutputSchema]):
    def __init__(self) -> None:
        super().__init__(
            scanner_name="Local LlamaFirewall AlignmentCheck",
            system_prompt=SYSTEM_PROMPT,
            output_schema=AlignmentCheckOutputSchema,
            model_name=MODEL_NAME,
            api_base_url=API_BASE_URL,
            api_key_env_var=API_KEY_ENV_VAR,
            temperature=0.0,
        )
        self.require_full_trace = True
        self.tool_client = (
            AsyncOpenAI(
                api_key=os.getenv(API_KEY_ENV_VAR),
                base_url=API_BASE_URL,
            )
            if STRUCTURED_OUTPUT_MODE == "tool_call"
            else None
        )

    async def _evaluate_with_llm(self, text: str) -> AlignmentCheckOutputSchema:
        if STRUCTURED_OUTPUT_MODE != "tool_call":
            return await super()._evaluate_with_llm(text)

        if not self.tool_client:
            return self._get_default_error_response()

        try:
            response = await self.tool_client.chat.completions.create(
                model=MODEL_NAME,
                temperature=0.0,
                messages=[
                    {
                        "role": "system",
                        "content": f"{SYSTEM_PROMPT}\n\nYou must call the classify_alignment tool.",
                    },
                    {"role": "user", "content": text},
                ],
                tools=[
                    {
                        "type": "function",
                        "function": {
                            "name": "classify_alignment",
                            "description": "Return the LlamaFirewall alignment classification.",
                            "parameters": AlignmentCheckOutputSchema.model_json_schema(),
                        },
                    }
                ],
                tool_choice={
                    "type": "function",
                    "function": {"name": "classify_alignment"},
                },
            )
            arguments = response.choices[0].message.tool_calls[0].function.arguments
            return AlignmentCheckOutputSchema.model_validate_json(arguments)
        except Exception:
            return self._get_default_error_response()

    def _get_default_error_response(self) -> AlignmentCheckOutputSchema:
        return AlignmentCheckOutputSchema(
            observation="Error occurred during local LlamaFirewall evaluation",
            thought="Treating as potentially compromised for safety",
            conclusion=True,
        )

    async def _convert_llm_response_to_score(
        self,
        response: AlignmentCheckOutputSchema,
    ) -> float:
        return 1.0 if response.conclusion else 0.0

    async def scan(
        self,
        message: Any,
        past_trace: list[Any] | None = None,
    ) -> ScanResult:
        if not past_trace:
            return ScanResult(
                decision=ScanDecision.ALLOW,
                reason="No trace provided, cannot proceed",
                score=0.0,
                status=ScanStatus.ERROR,
            )

        user_input = next(
            (trace_message.content for trace_message in past_trace if trace_message.role == Role.USER),
            None,
        )
        if not user_input:
            return ScanResult(
                decision=ScanDecision.ALLOW,
                reason="No user goal found in trace",
                score=0.0,
                status=ScanStatus.ERROR,
            )

        trace = "\n".join(str(trace_message) for trace_message in [*past_trace, message])
        llm_response = await self._evaluate_with_llm(
            USER_PROMPT_FORMAT.format(user_message=user_input, trace=trace),
        )
        score = await self._convert_llm_response_to_score(llm_response)
        decision = (
            ScanDecision.HUMAN_IN_THE_LOOP_REQUIRED
            if score == 1.0
            else ScanDecision.ALLOW
        )
        reason = (
            f"Observation: {llm_response.observation}\n"
            f"Thought: {llm_response.thought}\n"
            f"Conclusion: {llm_response.conclusion}"
        )
        return ScanResult(
            decision=decision,
            reason=reason,
            score=score,
            status=ScanStatus.SUCCESS,
        )


class MessagePayload(BaseModel):
    role: Literal["user", "assistant", "system", "tool"]
    content: str = ""


class CheckAlignmentRequest(BaseModel):
    message: MessagePayload
    trace: list[MessagePayload] = Field(default_factory=list)
    system_prompt: str | None = None


class ScanReplayRequest(BaseModel):
    trace: list[MessagePayload]


app = FastAPI(title="OpenBox Local LlamaFirewall")
scanner = LocalAlignmentCheckScanner()


def to_firewall_message(message: MessagePayload) -> Any:
    if message.role == "user":
        return UserMessage(message.content)
    return AssistantMessage(message.content)


def result_payload(result: ScanResult) -> dict[str, Any]:
    return {
        "decision": result.decision.value,
        "reason": result.reason,
        "score": result.score,
        "status": result.status.value,
        "provider": "local-llamafirewall",
        "model": MODEL_NAME,
        "api_base_url": API_BASE_URL,
        "structured_output_mode": STRUCTURED_OUTPUT_MODE,
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "provider": "local-llamafirewall",
        "model": MODEL_NAME,
        "api_base_url": API_BASE_URL,
    }


@app.post("/check_alignment")
async def check_alignment(request: CheckAlignmentRequest) -> dict[str, Any]:
    result = await scanner.scan(
        to_firewall_message(request.message),
        [to_firewall_message(trace_message) for trace_message in request.trace],
    )
    return result_payload(result)


@app.post("/scan_replay")
async def scan_replay(request: ScanReplayRequest) -> dict[str, Any]:
    if len(request.trace) < 2:
        return {
            "decision": ScanDecision.ALLOW.value,
            "reason": "Trace too short for alignment checking",
            "score": 0.0,
            "status": ScanStatus.ERROR.value,
            "provider": "local-llamafirewall",
            "model": MODEL_NAME,
            "api_base_url": API_BASE_URL,
        }

    past_trace: list[Any] = [to_firewall_message(request.trace[0])]
    for message in request.trace[1:]:
        firewall_message = to_firewall_message(message)
        result = await scanner.scan(firewall_message, past_trace)
        if result.decision != ScanDecision.ALLOW:
            return result_payload(result)
        past_trace.append(firewall_message)

    return {
        "decision": ScanDecision.ALLOW.value,
        "reason": "Trace aligned",
        "score": 0.0,
        "status": ScanStatus.SUCCESS.value,
        "provider": "local-llamafirewall",
        "model": MODEL_NAME,
        "api_base_url": API_BASE_URL,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT)
