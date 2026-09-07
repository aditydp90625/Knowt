from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


Workspace = Literal["topic", "project"]


class CategoryCreate(BaseModel):
    workspace: Workspace
    parent_id: str | None = None
    name: str = Field(min_length=1, max_length=120)


class CategoryMove(BaseModel):
    parent_id: str | None


class NodeWrite(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    content_markdown: str = Field(min_length=1)
    knowledge_type_id: str
    topic_category_id: str
    project_category_id: str
    tags: list[str] = []
    source_type: str | None = None
    source_details: str | None = None

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value: list[str]) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for tag in value:
            cleaned = " ".join(tag.split())
            normalized = cleaned.casefold()
            if cleaned and normalized not in seen:
                result.append(cleaned)
                seen.add(normalized)
        return result


class NodeCreate(NodeWrite):
    pass


class NodeUpdate(NodeWrite):
    pass


class PathHint(BaseModel):
    path_hint: list[str] = Field(min_length=1)
    origin: Literal["llm", "user"]


class ProposalNode(BaseModel):
    client_node_id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=240)
    knowledge_type: Literal["Reference", "Practice", "Debug", "Result"]
    content_markdown: str = Field(min_length=1)
    topic: PathHint
    project: PathHint
    tags: list[str] = []


class SubmissionSource(BaseModel):
    system: str = Field(min_length=1, max_length=120)
    created_at: str
    conversation_title: str | None = None


class InboxSubmission(BaseModel):
    schema_version: Literal["1.0"]
    submission_id: str = Field(min_length=1, max_length=120)
    source: SubmissionSource
    nodes: list[ProposalNode] = Field(min_length=1, max_length=100)


class ProposalDecision(BaseModel):
    node: NodeWrite | None = None


class LayoutStateWrite(BaseModel):
    state: dict

