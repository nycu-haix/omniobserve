from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException

from . import enhance_the_poster, lost_at_sea


DEFAULT_TASK_NAME = lost_at_sea.TASK_ID


SHARED_SIMILARITY_SYSTEM_PROMPT_TEMPLATE = """
# Role
You judge whether a new idea block meaningfully resonates with one existing candidate idea block in a {task_title} group discussion.

Your goal is not to detect duplicate wording or shared keyword mentions. Your goal is to find ideas that could help participants notice a shared task intuition and feel invited to join the discussion.

# Task Context
{task_context}

# Core Similarity Definition
{similarity_definition}

# Similarity Criteria
Mark a candidate as similar only if ALL are true:
1. Same decision target
{decision_target_definition}

2. Compatible stance
The two ideas imply a similar practical recommendation for the task.

3. Concrete evidence
The idea gives a concrete edit, priority, reason, visual/design effect, or comparison.

4. Meaningful discussion bridge
The match would reasonably help a participant feel: "Someone else has a similar intuition, so I can build on or compare with that idea."

# Same Reason Classification
After deciding a candidate is similar, classify `is_same_reason`:
- `true`: the practical recommendation is similar AND the primary reason/effect is also similar.
- `false`: the practical recommendation is similar BUT the primary reason/effect is different.

# Do NOT Mark As Similar
Return `id: null` if:
- The ideas merely mention the same target.
- The recommendation is unclear, neutral, or too generic.
- The two ideas suggest opposite actions or incompatible edits.
- The match would not create a useful bridge for discussion.

# Selection Rule
Review the candidate list and choose only the first candidate that satisfies the similarity criteria.

# Output Requirements
Return JSON only. Do not include Markdown, comments, or extra text.

If a similar idea is found:
{{"id": 123, "reason": "Briefly explain the shared practical recommendation, then compare the primary rationale.", "is_same_reason": true}}

If the practical recommendation is similar but the reason is different:
{{"id": 123, "reason": "Both ideas share a compatible practical recommendation, but their primary rationales are different.", "is_same_reason": false}}

If no candidate has a compatible practical recommendation:
{{"id": null, "reason": "No similar ideas found", "is_same_reason": false}}
""".strip()


@dataclass(frozen=True)
class TaskPromptConfig:
    task_name: str
    task_title: str
    idea_block_topic_context: str
    similarity_system_prompt: str
    task_items: list[dict[str, Any]]
    poster_components: list[dict[str, Any]] | None = None
    actions: list[dict[str, Any]] | None = None
    advanced_actions: list[dict[str, Any]] | None = None


def normalize_task_name(task_name: str | None) -> str:
    value = (task_name or DEFAULT_TASK_NAME).strip()
    if value not in {lost_at_sea.TASK_ID, enhance_the_poster.TASK_ID}:
        raise HTTPException(status_code=400, detail=f"Unsupported task_name: {value}")
    return value


def get_task_prompt_config(task_name: str | None) -> TaskPromptConfig:
    normalized_task_name = normalize_task_name(task_name)
    if normalized_task_name == enhance_the_poster.TASK_ID:
        return _enhance_the_poster_prompt_config()
    return _lost_at_sea_prompt_config()


def _lost_at_sea_prompt_config() -> TaskPromptConfig:
    return TaskPromptConfig(
        task_name=lost_at_sea.TASK_ID,
        task_title=lost_at_sea.TASK_TITLE,
        idea_block_topic_context=lost_at_sea.LLM_TOPIC_DESCRIPTION,
        similarity_system_prompt=SHARED_SIMILARITY_SYSTEM_PROMPT_TEMPLATE.format(
            task_title=lost_at_sea.TASK_TITLE,
            task_context=lost_at_sea.SIMILARITY_TASK_CONTEXT,
            similarity_definition=(
                "A candidate idea is similar only when it shares a compatible ranking stance with the core idea. "
                "Similarity does not require the same reason."
            ),
            decision_target_definition=(
                "The two ideas discuss the same item, the same comparison pair, or the same survival strategy."
            ),
        ),
        task_items=list(lost_at_sea.TASK_CONFIG["items"]),
    )


def _enhance_the_poster_prompt_config() -> TaskPromptConfig:
    task_context = """
Participants are improving an ugly poster. In Private Phase 1, each participant proposes at least four poster task items, with no maximum. Each task item combines:
- component_id: the poster element being changed
- action_id: the specific edit action such as remove, move, enlarge, shrink, change_color, change_font, adjust_spacing, unify, replace, or transparency

In Private Phase 2 and Public Phase, participants rank only the top 10 most important proposed poster task items. Items below the top 10 are treated as not changed.
""".strip()
    return TaskPromptConfig(
        task_name=enhance_the_poster.TASK_ID,
        task_title=enhance_the_poster.TASK_TITLE,
        idea_block_topic_context=task_context,
        similarity_system_prompt=SHARED_SIMILARITY_SYSTEM_PROMPT_TEMPLATE.format(
            task_title=enhance_the_poster.TASK_TITLE,
            task_context=task_context,
            similarity_definition=(
                "A candidate idea is similar only when it shares a compatible poster-improvement stance with the core idea. "
                "Similarity may be based on the same component/action/advanced_action combination, or a clearly compatible "
                "design recommendation for the same visual problem. Similarity does not require the same reason."
            ),
            decision_target_definition=(
                "The two ideas discuss the same poster component, the same edit action, the same advanced edit method, "
                "or a clearly equivalent poster improvement."
            ),
        ),
        task_items=[],
        poster_components=[dict(item) for item in enhance_the_poster.PHASE1_POSTER_COMPONENTS],
        actions=[dict(item) for item in enhance_the_poster.PHASE1_ACTION_ITEMS],
        advanced_actions=[],
    )
