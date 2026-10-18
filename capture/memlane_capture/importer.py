"""Bulk import of incidents from CSV (Atlos "Bulk import"), parsing and validation only (no DB).

One row per incident. Column names are case-insensitive, in Vietnamese or English; only `description`
is required. Multi-value cells use "|" (";" also works). Status and sensitivity accept the codes or the
labels shown in the UI, in either language. A project's custom attributes are columns named after them.

    description | mô tả            required
    status | trạng thái          to_do … cancelled, or "Cần làm", "In Progress", …
    sensitive | nhạy cảm         not_sensitive, personal_info, … or their labels
    tags | chủ đề
    date | event_date | ngày     YYYY-MM-DD
    place | địa điểm
    lat | vĩ độ, lng | kinh độ
    precision | geo_precision | độ chính xác   exact / vicinity / locality
    urls | source_urls | liên kết               source material, separated by "|" or whitespace
    <custom attribute name>
"""

import csv
import io
import re
from datetime import date

MAX_ROWS = 500

STATUS_LABELS = {
    "to_do": ["to do", "todo", "cần làm"], "in_progress": ["in progress", "đang làm"],
    "help_needed": ["help needed", "cần hỗ trợ"], "ready_for_review": ["ready for review", "chờ duyệt"],
    "completed": ["completed", "hoàn tất"], "cancelled": ["cancelled", "canceled", "đã huỷ", "đã hủy"],
}
SENSITIVE_LABELS = {
    "not_sensitive": ["not sensitive", "không nhạy cảm"],
    "personal_info": ["personal information visible", "lộ thông tin cá nhân"],
    "graphic_violence": ["graphic violence", "bạo lực / hình ảnh gây sốc", "bạo lực"],
    "deleted_by_source": ["deleted by source", "đã bị nguồn xoá", "đã bị nguồn xóa"],
    "deceptive": ["deceptive or misleading", "sai lệch / gây hiểu lầm", "sai lệch"],
}
COLUMNS = {
    "description": ["description", "mô tả", "mo ta"], "status": ["status", "trạng thái"],
    "sensitive": ["sensitive", "sensitivity", "nhạy cảm", "mức độ nhạy cảm"], "tags": ["tags", "chủ đề"],
    "event_date": ["date", "event_date", "ngày"], "place": ["place", "địa điểm", "gần địa điểm", "reported near"],
    "lat": ["lat", "latitude", "vĩ độ"], "lng": ["lng", "lon", "longitude", "kinh độ"],
    "geo_precision": ["precision", "geo_precision", "độ chính xác"],
    "urls": ["urls", "source_urls", "source material", "liên kết", "tư liệu nguồn"],
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _lookup(value: str, table: dict[str, list[str]]) -> str | None:
    v = _norm(value).replace("-", "_")
    if v in table:
        return v
    for code, labels in table.items():
        if _norm(value) in labels:
            return code
    return None


def _split(cell: str) -> list[str]:
    return [x.strip() for x in re.split(r"[|;]", cell or "") if x.strip()]


def parse(text: str, attributes: list[dict]) -> tuple[list[dict], list[str]]:
    """Returns (rows, file_errors). Each row: {"line", "values" (PATCH-ready), "urls", "errors"}."""
    text = text.lstrip("﻿")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    try:
        header = next(reader)
    except StopIteration:
        return [], ["the file is empty"]
    by_name = {_norm(a["name"]): a for a in attributes}
    colmap: dict[int, tuple[str, dict | None]] = {}
    unknown = []
    for i, h in enumerate(header):
        n = _norm(h)
        field = next((f for f, names in COLUMNS.items() if n in names), None)
        if field:
            colmap[i] = (field, None)
        elif n in by_name:
            colmap[i] = ("custom", by_name[n])
        elif n:
            unknown.append(h.strip())
    file_errors = [f"unknown column(s), ignored: {', '.join(unknown)}"] if unknown else []
    if not any(f == "description" for f, _ in colmap.values()):
        return [], file_errors + ["a 'description' (mô tả) column is required"]

    rows = []
    for line_no, cells in enumerate(reader, start=2):
        if not any(c.strip() for c in cells):
            continue
        if len(rows) >= MAX_ROWS:
            file_errors.append(f"only the first {MAX_ROWS} rows are imported")
            break
        values: dict = {"custom": {}}
        urls: list[str] = []
        errors: list[str] = []
        for i, cell in enumerate(cells):
            if i not in colmap or not cell.strip():
                continue
            field, attr = colmap[i]
            cell = cell.strip()
            if field == "description":
                values["description"] = cell[:1000]
            elif field == "status":
                code = _lookup(cell, STATUS_LABELS)
                (values.__setitem__("status", code) if code else errors.append(f"unknown status '{cell}'"))
            elif field == "sensitive":
                codes = [_lookup(x, SENSITIVE_LABELS) for x in _split(cell)]
                if None in codes:
                    errors.append(f"unknown sensitivity in '{cell}'")
                else:
                    values["sensitive"] = codes
            elif field == "tags":
                values["tags"] = _split(cell)
            elif field == "event_date":
                try:
                    values["event_date"] = date.fromisoformat(cell).isoformat()
                except ValueError:
                    errors.append(f"date '{cell}' is not YYYY-MM-DD")
            elif field == "place":
                values["place"] = cell[:300]
            elif field in ("lat", "lng"):
                try:
                    v = float(cell.replace(",", "."))
                    if not (-90 <= v <= 90 if field == "lat" else -180 <= v <= 180):
                        raise ValueError
                    values[field] = v
                except ValueError:
                    errors.append(f"{field} '{cell}' is not a valid coordinate")
            elif field == "geo_precision":
                p = _norm(cell)
                (values.__setitem__("geo_precision", p) if p in ("exact", "vicinity", "locality")
                 else errors.append(f"precision '{cell}' must be exact, vicinity or locality"))
            elif field == "urls":
                urls = [u for u in re.split(r"[|;\s]+", cell) if u.lower().startswith(("http://", "https://"))]
            elif field == "custom":
                if attr["type"] == "multi_select":
                    vals = _split(cell)
                    bad = [v for v in vals if attr["options"] and v not in attr["options"]]
                    (errors.append(f"{attr['name']}: not an option: {', '.join(bad)}") if bad
                     else values["custom"].__setitem__(attr["id"], vals))
                elif attr["type"] == "select":
                    (errors.append(f"{attr['name']}: '{cell}' is not an option")
                     if attr["options"] and cell not in attr["options"] else values["custom"].__setitem__(attr["id"], cell))
                elif attr["type"] == "date":
                    try:
                        values["custom"][attr["id"]] = date.fromisoformat(cell).isoformat()
                    except ValueError:
                        errors.append(f"{attr['name']}: '{cell}' is not YYYY-MM-DD")
                else:
                    values["custom"][attr["id"]] = cell[:4000]
        if not values.get("description"):
            errors.append("description is empty")
        if ("lat" in values) != ("lng" in values):
            errors.append("lat and lng must both be given")
        if not values["custom"]:
            values.pop("custom")
        rows.append({"line": line_no, "values": values, "urls": urls, "errors": errors})
    if not rows and not file_errors:
        file_errors.append("no rows")
    return rows, file_errors
