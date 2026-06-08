"""merge transcript and poster migration heads

Revision ID: 20260607_0011
Revises: 20260602_0008, 20260606_0010
Create Date: 2026-06-07
"""

from collections.abc import Sequence
from typing import Union


revision: str = "20260607_0011"
down_revision: Union[str, tuple[str, str], None] = ("20260602_0008", "20260606_0010")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

