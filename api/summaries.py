from collections.abc import Iterable
from uuid import UUID

from rag import Answer, Citation, Settings, _positive_int, generate_json
from pydantic import BaseModel


class Summary(BaseModel):
    summary: str


class SectionSummary(Summary):
    source_ids: list[str]


class SummaryLimit(ValueError):
    pass


def _groups(passages: Iterable[Citation], char_budget: int) -> list[list[Citation]]:
    groups: list[list[Citation]] = []
    current: list[Citation] = []
    size = 0
    for passage in passages:
        if len(passage.content) > char_budget:
            raise SummaryLimit("A document passage exceeds the summary section limit.")
        if current and size + len(passage.content) > char_budget:
            groups.append(current)
            current = []
            size = 0
        current.append(passage)
        size += len(passage.content)
    if current:
        groups.append(current)
    return groups


def summary_batches(
    document_ids: list[UUID], passages: list[Citation]
) -> list[list[list[Citation]]]:
    limit = _positive_int("SOURCELEAF_SUMMARY_SECTIONS", 100)
    budget = _positive_int("SOURCELEAF_SUMMARY_SECTION_CHARS", 100000)
    plan = [
        _groups((row for row in passages if row.document_id == document_id), budget)
        for document_id in document_ids
    ]
    if any(not groups for groups in plan):
        raise SummaryLimit("One of the selected documents has no indexed text.")
    if sum(map(len, plan)) > limit:
        raise SummaryLimit(f"This selection exceeds the demo's {limit}-section summary limit. Choose fewer documents.")
    return plan


def summary_calls(plan: list[list[list[Citation]]]) -> int:
    return sum(len(groups) + (len(groups) > 1) for groups in plan) + (len(plan) > 1)


def summarize(settings: Settings, plan: list[list[list[Citation]]]) -> Answer:
    documents = []
    sources = []
    for groups in plan:
        sections = []
        for group in groups:
            by_id = {str(passage.chunk_id): passage for passage in group}
            section = generate_json(
                settings, SectionSummary,
                "Summarize this section in plain language using only its content. "
                "Return up to three source_ids for the passages supporting the main points.",
                {"section": [{"id": key, "text": item.content} for key, item in by_id.items()]},
            )
            sections.append(section.summary)
            sources.extend(by_id[key] for key in list(dict.fromkeys(section.source_ids))[:3] if key in by_id)
        filename = groups[0][0].filename
        document_summary = sections[0] if len(sections) == 1 else generate_json(
            settings, Summary, "Combine the section summaries in their original order.",
            {"filename": filename, "sections": sections},
        ).summary
        documents.append({"filename": filename, "summary": document_summary})

    answer = documents[0]["summary"]
    if len(documents) > 1:
        answer = generate_json(
            settings, Summary, "Summarize each document in order, then highlight shared themes if supported.",
            {"documents": documents},
        ).summary
    return Answer(answer=answer, sources=sources)
