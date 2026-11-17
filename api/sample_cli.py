import argparse
from pathlib import Path
from uuid import UUID

from documents import DocumentError
from rag import RagError, Settings, answer_question, index_sample, list_samples


def main() -> None:
    parser = argparse.ArgumentParser(description="Index and query public sample documents.")
    commands = parser.add_subparsers(dest="command", required=True)
    index = commands.add_parser("index")
    index.add_argument("files", type=Path, nargs="+")
    commands.add_parser("list")
    ask = commands.add_parser("ask")
    ask.add_argument("question")
    ask.add_argument("document_ids", type=UUID, nargs="+")
    args = parser.parse_args()
    try:
        settings = Settings.load()
        if args.command == "index":
            for path in args.files:
                print(index_sample(settings, path), path.name)
        elif args.command == "list":
            for sample in list_samples(settings):
                print(sample["id"], sample["filename"])
        else:
            result = answer_question(settings, args.question, args.document_ids)
            print(result.model_dump_json(indent=2))
    except (DocumentError, RagError, OSError) as exc:
        parser.exit(1, f"{exc}\n")


if __name__ == "__main__":
    main()
