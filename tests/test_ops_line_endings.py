"""Windows checkouts must preserve the Linux ops bind mounts byte-for-byte."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OPS = (
    "deploy/ingest-daily.sh",
    "deploy/backup-daily.sh",
    "deploy/retention-sweep.sh",
    "deploy/ingest-cron.crontab",
    "tests/ops_entrypoint_smoke.sh",
)


class OpsLineEndings(unittest.TestCase):
    def test_ops_bind_mounts_use_lf(self):
        for relative in OPS:
            with self.subTest(path=relative):
                content = (ROOT / relative).read_bytes()
                self.assertNotIn(b"\r", content)
                self.assertTrue(content.endswith(b"\n"))
                result = subprocess.run(
                    ["git", "check-attr", "text", "eol", "--", relative],
                    cwd=ROOT, check=True, capture_output=True, text=True,
                )
                self.assertIn(f"{relative}: text: set", result.stdout)
                self.assertIn(f"{relative}: eol: lf", result.stdout)
