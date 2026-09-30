"""Read-only OOXML extraction for the supplied V24/recommendations documents."""
import json
import sys
import zipfile
from pathlib import Path
from lxml import etree

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
def paragraph(p):
    runs = []
    for r in p.iter(W + 'r'):
        text = ''.join(n.text or '' if n.tag == W + 't' else '\n' if n.tag == W + 'br' else '\t' if n.tag == W + 'tab' else '' for n in r.iter() if n.tag in (W+'t', W+'br', W+'tab'))
        if not text: continue
        highlights = [h.get(W+'val') for h in r.findall('./'+W+'rPr/'+W+'highlight')]
        shading = [h.get(W+'fill') for h in r.findall('./'+W+'rPr/'+W+'shd')]
        runs.append({'text': text, 'highlight': highlights, 'shading': shading})
    return {'text': ''.join(r['text'] for r in runs), 'runs': runs}

def extract(source):
    with zipfile.ZipFile(source) as z:
        root = etree.fromstring(z.read('word/document.xml'))
        blocks=[]
        for child in root.find(W+'body'):
            if child.tag == W+'p': blocks.append({'type':'paragraph', **paragraph(child)})
            elif child.tag == W+'tbl':
                rows=[]
                for row in child.findall(W+'tr'):
                    cells=[]
                    for cell in row.findall(W+'tc'):
                        cells.append([paragraph(p) for p in cell.iter(W+'p')])
                    rows.append(cells)
                blocks.append({'type':'table', 'rows':rows})
        return {'source':str(source), 'blocks':blocks, 'media':[n for n in z.namelist() if n.startswith('word/media/')], 'trackedChanges':len(root.findall('.//'+W+'ins'))+len(root.findall('.//'+W+'del'))}

if __name__ == '__main__':
    data=extract(sys.argv[1])
    if len(sys.argv)>2:
        Path(sys.argv[2]).parent.mkdir(parents=True,exist_ok=True)
        Path(sys.argv[2]).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(data,ensure_ascii=False) if len(sys.argv)==2 else json.dumps({'source':data['source'],'blocks':len(data['blocks']),'tables':sum(b['type']=='table' for b in data['blocks']),'media':len(data['media']),'trackedChanges':data['trackedChanges']},ensure_ascii=False))
