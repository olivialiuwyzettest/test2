from __future__ import annotations

import queue
import threading
import traceback
import uuid
from dataclasses import dataclass
from typing import Callable, Optional

from wbr_deck_agent.core import db
from wbr_deck_agent.util.redact import redact_secrets


@dataclass(frozen=True)
class Job:
    id: str
    run_id: str
    kind: str  # e.g. "build"


class JobQueue:
    def __init__(self) -> None:
        self._q: queue.Queue[Job] = queue.Queue()
        self._thread: Optional[threading.Thread] = None
        self._started = threading.Event()

    def start(self, handler: Callable[[Job], None]) -> None:
        if self._thread and self._thread.is_alive():
            return

        def _worker() -> None:
            self._started.set()
            while True:
                job = self._q.get()
                try:
                    handler(job)
                except Exception:
                    tb = redact_secrets(traceback.format_exc())
                    db.update_run(job.run_id, status="failed", stage="failed", message=tb)
                finally:
                    self._q.task_done()

        t = threading.Thread(target=_worker, name="wbr-job-worker", daemon=True)
        t.start()
        self._thread = t
        self._started.wait(timeout=5)

    def enqueue(self, run_id: str, kind: str) -> Job:
        job = Job(id=uuid.uuid4().hex, run_id=run_id, kind=kind)
        self._q.put(job)
        return job


JOB_QUEUE = JobQueue()
