#!/usr/bin/env python3
"""Synchronize the local graph JSON into the standalone HTML."""

import json
import os
import re
import tempfile
from pathlib import Path

directory = Path(__file__).resolve().parent
data = json.loads((directory / 'mainline.graph.json').read_text(encoding='utf-8'))
if not isinstance(data, dict) or data.get('formatVersion') != 'wiselink.graph-navigation/1':
    raise ValueError('Invalid graph data format')
path = directory / 'WiseLink_Mainline.html'
html = path.read_text(encoding='utf-8')
opening = re.compile(r'<script\b[^>]*\bid\s*=\s*["\']graph-data["\'][^>]*>', re.I)
starts = list(opening.finditer(html))
if len(starts) != 1 or not re.search(r'\btype\s*=\s*["\']application/json["\']', starts[0].group(), re.I):
    raise ValueError('Expected exactly one application/json graph-data script')
end = re.search(r'</script\s*>', html[starts[0].end():], re.I)
if end is None:
    raise ValueError('Missing graph-data closing script tag')
serialized = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
result = html[:starts[0].end()] + serialized + html[starts[0].end() + end.start():]
mode = path.stat().st_mode
temporary = None
try:
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=directory, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(result)
    os.chmod(temporary, mode)
    os.replace(temporary, path)
finally:
    if temporary is not None:
        temporary.unlink(missing_ok=True)
print('Synchronized mainline.graph.json into WiseLink_Mainline.html')
