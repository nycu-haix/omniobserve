import base64
import csv
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Any


HEADER_KEYS = {"id", "item", "title", "name", "label", "label_zh", "label_en", "description", "description_zh"}
NS = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def parse_spreadsheet_task_items(filename: str, content_base64: str) -> list[dict[str, Any]]:
    raw_bytes = base64.b64decode(content_base64)
    normalized_filename = filename.lower()
    if normalized_filename.endswith(".xlsx"):
        rows = _parse_xlsx_rows(raw_bytes)
    else:
        text = raw_bytes.decode("utf-8-sig")
        first_line = text.splitlines()[0] if text.splitlines() else ""
        delimiter = "\t" if "\t" in first_line else ","
        rows = [row for row in csv.reader(io.StringIO(text), delimiter=delimiter) if any(cell.strip() for cell in row)]
    return rows_to_task_items(rows)


def rows_to_task_items(rows: list[list[str]]) -> list[dict[str, Any]]:
    if not rows:
        return []
    first_row = [cell.strip().lower() for cell in rows[0]]
    headers = first_row if any(cell in HEADER_KEYS for cell in first_row) else []
    data_rows = rows[1:]
    id_column = _find_column(headers, "id")
    label_column = _find_column(headers, "item", "title", "name", "label", "label_zh", "label_en")
    description_column = _find_column(headers, "description", "description_zh")
    seen_ids: set[str] = set()
    items: list[dict[str, Any]] = []
    for index, row in enumerate(data_rows, start=1):
        label = _cell(row, label_column if label_column >= 0 else 0)
        if not label:
            continue
        raw_id = _cell(row, id_column) if id_column >= 0 else label
        item_id = _unique_id(_slugify(raw_id, f"capstone_item_{index}"), seen_ids)
        description = _cell(row, description_column) if description_column >= 0 else _cell(row, 1)
        items.append(
            {
                "id": item_id,
                "label": label,
                "label_zh": label,
                "label_en": label,
                "description_zh": description,
                "aliases": [],
                "image_title": label,
                "image_bg": "#f8fafc",
                "image_fg": "#334155",
                "image_mark": str(len(items) + 1),
            }
        )
    return items


def _parse_xlsx_rows(raw_bytes: bytes) -> list[list[str]]:
    with zipfile.ZipFile(io.BytesIO(raw_bytes)) as archive:
        shared_strings = _read_shared_strings(archive)
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        first_sheet = workbook.find(".//main:sheets/main:sheet", NS)
        if first_sheet is None:
            return []
        rel_id = first_sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        sheet_path = "xl/worksheets/sheet1.xml"
        if rel_id:
            rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            for rel in rels:
                if rel.attrib.get("Id") == rel_id:
                    target = rel.attrib.get("Target", "worksheets/sheet1.xml").lstrip("/")
                    sheet_path = target if target.startswith("xl/") else f"xl/{target}"
                    break
        sheet = ET.fromstring(archive.read(sheet_path))
        rows: list[list[str]] = []
        for row in sheet.findall(".//main:sheetData/main:row", NS):
            values: list[str] = []
            for cell in row.findall("main:c", NS):
                values.append(_read_xlsx_cell(cell, shared_strings))
            if any(value.strip() for value in values):
                rows.append(values)
        return rows


def _read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(text.itertext()) for text in root.findall("main:si", NS)]


def _read_xlsx_cell(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    value = cell.find("main:v", NS)
    if cell_type == "inlineStr":
        inline = cell.find("main:is", NS)
        return "".join(inline.itertext()).strip() if inline is not None else ""
    if value is None or value.text is None:
        return ""
    raw_value = value.text
    if cell_type == "s":
        try:
            return shared_strings[int(raw_value)].strip()
        except (IndexError, ValueError):
            return ""
    return raw_value.strip()


def _find_column(headers: list[str], *keys: str) -> int:
    return next((index for index, header in enumerate(headers) if header in keys), -1)


def _cell(row: list[str], index: int) -> str:
    return row[index].strip() if 0 <= index < len(row) else ""


def _slugify(value: str, fallback: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", value.strip().lower()).strip("_") or fallback


def _unique_id(base_id: str, seen_ids: set[str]) -> str:
    item_id = base_id
    suffix = 2
    while item_id in seen_ids:
        item_id = f"{base_id}_{suffix}"
        suffix += 1
    seen_ids.add(item_id)
    return item_id
