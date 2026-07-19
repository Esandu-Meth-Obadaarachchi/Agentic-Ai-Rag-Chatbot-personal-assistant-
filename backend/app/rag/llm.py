"""Claude, via LangChain.

Generation and the agent tool loop run on CLAUDE_MODEL (default Haiku 4.5, the
cheapest tier). The agentic-retrieval helper calls — query rewrite, chunk grading,
groundedness — run on the fast model and only need a short string back.
"""

from __future__ import annotations

from functools import lru_cache

from langchain_anthropic import ChatAnthropic

from app.config import get_settings

# Ceiling on generated output per reply. Output tokens are the expensive side and
# each tool round re-sends the growing context, so this is bounded.
MAX_ANSWER_TOKENS = 1024


@lru_cache
def get_llm(fast: bool = False) -> ChatAnthropic:
    settings = get_settings()
    model = settings.claude_fast_model if fast else settings.claude_model
    return ChatAnthropic(
        model=model,
        api_key=settings.anthropic_api_key,
        max_tokens=MAX_ANSWER_TOKENS,
        timeout=60,
    )


def _text_of(content) -> str:
    """Flatten a LangChain message content (str, or a list of content blocks)."""
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for block in content or []:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "".join(parts)


def complete(prompt: str, *, system: str | None = None, max_tokens: int = 256) -> str:
    """One-shot completion on the fast model. Used by the retrieval helpers."""
    settings = get_settings()
    llm = ChatAnthropic(
        model=settings.claude_fast_model,
        api_key=settings.anthropic_api_key,
        max_tokens=max_tokens,
        timeout=60,
    )
    messages: list[tuple[str, str]] = []
    if system:
        messages.append(("system", system))
    messages.append(("human", prompt))
    return _text_of(llm.invoke(messages).content).strip()
