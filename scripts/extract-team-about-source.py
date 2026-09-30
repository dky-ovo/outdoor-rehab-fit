"""Extract the approved bilingual roster as a test fixture without modifying Word."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from lxml import etree

EXPECTED = "7748E292FB25556B73EF5425C171BD89533DBA990F5119497E06F78334DFE4F0"
parser = argparse.ArgumentParser()
parser.add_argument("source")
parser.add_argument("output")
args = parser.parse_args()
source = Path(args.source)
digest = hashlib.sha256(source.read_bytes()).hexdigest().upper()
if digest != EXPECTED:
    raise ValueError("Unexpected Word revision; review before replacing the roster")
document = Document(source)
ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
with ZipFile(source) as archive:
    xml = etree.fromstring(archive.read("word/document.xml"))
    changes = len(xml.xpath("//w:ins|//w:del", namespaces=ns))
    comments = len(etree.fromstring(archive.read("word/comments.xml")).findall("w:comment", ns)) if "word/comments.xml" in archive.namelist() else 0
    media = sum(name.startswith("word/media/") for name in archive.namelist())
if changes or comments or media:
    raise ValueError("Tracked changes, comments or images require manual review")
blocks = []
for element in document.element.body:
    if element.tag == f"{{{ns['w']}}}p":
        paragraph = Paragraph(element, document)
        if paragraph.text.strip():
            blocks.append({"type": "paragraph", "text": paragraph.text})
    elif element.tag == f"{{{ns['w']}}}tbl":
        table = Table(element, document)
        blocks.append({"type": "table", "rows": [[cell.text for cell in row.cells] for row in table.rows]})
fixture = {"sourceSha256": digest, "trackedChanges": changes, "comments": comments, "media": media, "blocks": blocks}
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"sourceSha256": digest, "blocks": len(blocks), "tables": len(document.tables)}))
