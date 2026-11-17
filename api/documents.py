from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from lxml.etree import XMLSyntaxError
from pypdf import PdfReader
from pypdf.errors import PdfReadError


class DocumentError(ValueError):
    """An uploaded document could not be read."""


@dataclass(frozen=True, slots=True)
class SourceBlock:
    text: str
    location: str


def _pdf_blocks(data: bytes) -> list[SourceBlock]:
    try:
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted:
            raise DocumentError("Password-protected PDFs are unsupported.")

        blocks = []
        for page_number, page in enumerate(reader.pages, start=1):
            text = (page.extract_text() or "").strip()
            if text:
                blocks.append(SourceBlock(text, f"Page {page_number}"))
        return blocks
    except PdfReadError as exc:
        raise DocumentError("The PDF could not be read.") from exc


def _docx_blocks(data: bytes, max_unpacked_bytes: int | None) -> list[SourceBlock]:
    try:
        if max_unpacked_bytes is not None:
            with ZipFile(BytesIO(data)) as archive:
                unpacked_bytes = sum(member.file_size for member in archive.infolist())
            if unpacked_bytes > max_unpacked_bytes:
                raise DocumentError("The expanded Word file exceeds the processing size limit.")
        document = Document(BytesIO(data))
    except DocumentError:
        raise
    except (BadZipFile, KeyError, OSError, ValueError, XMLSyntaxError) as exc:
        raise DocumentError("The Word document could not be read.") from exc

    blocks = []
    heading = ""
    for position, block in enumerate(document.iter_inner_content(), start=1):
        if isinstance(block, Paragraph):
            text = block.text.strip()
            style = block.style.name if block.style else ""
            if text and style.startswith("Heading"):
                heading = text
            anchor = f"Block {position}"
        elif isinstance(block, Table):
            text = "\n".join(
                " | ".join(cell.text.strip() for cell in row.cells)
                for row in block.rows
                if any(cell.text.strip() for cell in row.cells)
            )
            anchor = f"Table at block {position}"
        else:
            continue

        if text:
            location = f"{heading}, {anchor}" if heading else anchor
            blocks.append(SourceBlock(text, location))
    return blocks


def extract_blocks(
    filename: str, data: bytes, *, max_unpacked_bytes: int | None = None
) -> list[SourceBlock]:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        blocks = _pdf_blocks(data)
    elif suffix == ".docx":
        blocks = _docx_blocks(data, max_unpacked_bytes)
    else:
        raise DocumentError("Choose a PDF or DOCX file.")

    if not blocks:
        raise DocumentError("This document has no readable text.")
    return blocks


def chunk_blocks(
    blocks: list[SourceBlock], *, max_chars: int
) -> list[SourceBlock]:
    """Split at whitespace when possible while retaining each source location."""
    if max_chars <= 0:
        raise ValueError("max_chars must be positive.")

    chunks = []
    for block in blocks:
        remaining = block.text.strip()
        while len(remaining) > max_chars:
            boundary = max(
                remaining.rfind(" ", 0, max_chars + 1),
                remaining.rfind("\n", 0, max_chars + 1),
                remaining.rfind("\t", 0, max_chars + 1),
            )
            if boundary <= 0:
                boundary = max_chars
            chunks.append(SourceBlock(remaining[:boundary].rstrip(), block.location))
            remaining = remaining[boundary:].lstrip()
        if remaining:
            chunks.append(SourceBlock(remaining, block.location))
    return chunks
