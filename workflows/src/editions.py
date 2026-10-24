"""Wersje LITE/PRO z jednego źródła (opis znaczników: tools/editions.js, który robi to samo w JS).

W repozytorium źródłowym węzły Code mają znaczniki wersji – build.py składa z nich workflow PRO, a do kontroli
słownika czyta też widok LITE. W wydanej wersji znaczników już nie ma (eksport zostawia tylko kod tej wersji).
"""
import re

EDITION_MARKS = {
    "pro_start": re.compile(r"^\s*// @pro\s*$"),
    "lite_start": re.compile(r"^\s*// @lite\s*$"),
    "end": re.compile(r"^\s*// @end\s*$"),
    "lite_line": re.compile(r"^(\s*)// @lite: (.*)$"),
    "trailing_pro": re.compile(r"^(.*\S)\s+// @pro\s*$"),
    "lite_content": re.compile(r"^(\s*)//(?: (.*))?$"),
    "stray": re.compile(r"(^|\s)//\s*@(pro|lite|end)\b", re.I),
}


def edition_view(text, edition, where=""):
    m = EDITION_MARKS
    out, block = [], None
    for i, line in enumerate(text.split("\n"), 1):
        if block is None and (m["pro_start"].match(line) or m["lite_start"].match(line)):
            block = "pro" if m["pro_start"].match(line) else "lite"
            continue
        if block and m["end"].match(line):
            block = None
            continue
        assert not (block and m["stray"].search(line)), f"{where}:{i}: version marker inside a @{block} block"
        if block == "pro":
            if edition == "pro":
                out.append(line)
            continue
        if block == "lite":
            c = m["lite_content"].match(line)
            assert c or not line.strip(), f"{where}:{i}: every line in a @lite block must be a comment"
            if edition == "lite":
                out.append((c.group(1) + (c.group(2) or "")) if c else "")
            continue
        lite = m["lite_line"].match(line)
        if lite:
            if edition == "lite":
                out.append(lite.group(1) + lite.group(2))
            continue
        pro = m["trailing_pro"].match(line)
        if pro:
            if edition == "pro":
                out.append(pro.group(1))
            continue
        assert not m["stray"].search(line), f"{where}:{i}: unknown version marker: {line.strip()[:80]}"
        out.append(line)
    assert block is None, f"{where}: unclosed @{block} block"
    return "\n".join(out)
