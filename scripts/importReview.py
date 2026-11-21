"""Convert an adjudicated TurnTrace review sheet into the evaluation input."""

import argparse
import csv
import json
from pathlib import Path


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("sheet", type=Path, help="Adjudicated CSV from the blind review pool")
parser.add_argument("output", type=Path, help="Destination JSON file")
args = parser.parse_args()

grades = {}
seen = set()
with args.sheet.open(encoding="utf-8-sig", newline="") as sheet:
    reader = csv.DictReader(sheet)
    if not {"queryId", "docId", "relevanceGrade"}.issubset(reader.fieldnames or []):
        parser.error("The CSV must include queryId, docId, and relevanceGrade columns.")
    for row in reader:
        pair = row["queryId"], row["docId"]
        if not all(pair) or pair in seen:
            parser.error(f"Missing or duplicate passage pair near line {reader.line_num}.")
        seen.add(pair)
        grade = (row["relevanceGrade"] or "").strip()
        if not grade:
            continue
        if grade not in {"0", "1", "2"}:
            parser.error(f"Grade near line {reader.line_num} must be 0, 1, or 2.")
        grades.setdefault(pair[0], {})[pair[1]] = int(grade)

try:
    with args.output.open("x", encoding="utf-8") as target:
        json.dump(grades, target, indent=2)
        target.write("\n")
except FileExistsError:
    parser.error(f"Output already exists: {args.output}")

print(f"Imported {sum(map(len, grades.values()))} graded pairs from {len(seen)} rows.")
