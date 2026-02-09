import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.db import SessionLocal, engine
from app.models import Base
from app.services.intelligence import run_full_ingestion


def main() -> None:
    settings = get_settings()
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        stats = run_full_ingestion(db, settings)

    print(
        "Refresh complete:",
        f"inserted={stats.inserted}",
        f"updated={stats.updated}",
        f"skipped={stats.skipped}",
        f"deleted_old={stats.deleted_old}",
        f"errors={stats.errors}",
    )


if __name__ == "__main__":
    main()
