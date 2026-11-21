"""Render the checked-in research paper and measured charts to a portable PDF."""
from pathlib import Path
import re
import json
import html
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Preformatted, KeepTogether
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.shapes import Drawing, String
from reportlab.graphics.charts.barcharts import VerticalBarChart

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'pdf'
OUT.mkdir(parents=True, exist_ok=True)
font_dir = Path('C:/Windows/Fonts')
if (font_dir / 'segoeui.ttf').exists():
    pdfmetrics.registerFont(TTFont('Body', str(font_dir / 'segoeui.ttf')))
    pdfmetrics.registerFont(TTFont('BodyBold', str(font_dir / 'segoeuib.ttf')))
    pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='Body', boldItalic='BodyBold')
else:
    pdfmetrics.registerFontFamily('Body', normal='Helvetica', bold='Helvetica-Bold', italic='Helvetica-Oblique', boldItalic='Helvetica-BoldOblique')
    pdfmetrics.registerFont(pdfmetrics.Font('Body', 'Helvetica', 'WinAnsiEncoding'))
    pdfmetrics.registerFont(pdfmetrics.Font('BodyBold', 'Helvetica-Bold', 'WinAnsiEncoding'))

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='Paper', fontName='Body', fontSize=9.3, leading=14, spaceAfter=7, splitLongWords=True))
styles.add(ParagraphStyle(name='PaperTitle', fontName='BodyBold', fontSize=21, leading=27, textColor=colors.HexColor('#1e2440'), spaceAfter=13))
styles.add(ParagraphStyle(name='Section', fontName='BodyBold', fontSize=13, leading=18, spaceBefore=13, spaceAfter=7, keepWithNext=True, textColor=colors.HexColor('#4338ca')))
styles.add(ParagraphStyle(name='Subsection', fontName='BodyBold', fontSize=10.5, leading=15, spaceBefore=9, spaceAfter=5, keepWithNext=True))
styles.add(ParagraphStyle(name='Cell', fontName='Body', fontSize=7.7, leading=11, splitLongWords=True))
styles.add(ParagraphStyle(name='CodeSmall', fontName='Courier', fontSize=7.7, leading=11, backColor=colors.HexColor('#f3f5fa'), leftIndent=8, rightIndent=8, spaceBefore=5, spaceAfter=8))

def inline(text):
    text = html.escape(text)
    text = re.sub(r'\[([^\]]+)\]\((https?://[^\s)]+)\)', r'<link href="\2" color="#4338ca">\1</link>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', text)
    return re.sub(r'`([^`]+)`', r'<font face="Courier">\1</font>', text)

story=[]
lines=(ROOT/'docs'/'RESEARCH_REPORT.md').read_text(encoding='utf-8').splitlines()
i=0
while i<len(lines):
    line=lines[i].strip()
    if not line:
        i+=1
        continue
    if line.startswith('```'):
        block=[]
        i+=1
        while i<len(lines) and not lines[i].startswith('```'):
            raw=lines[i].replace('→','->').replace('—','-').replace('–','-')
            # Keep diagrams/code inside the available page width.
            while len(raw)>92:
                split=raw.rfind(' ',0,92)
                if split<1:split=92
                block.append(raw[:split]);raw='  '+raw[split:].lstrip()
            block.append(raw);i+=1
        story.append(Preformatted('\n'.join(block),styles['CodeSmall']));i+=1;continue
    if line.startswith('|'):
        rows=[]
        while i<len(lines) and lines[i].strip().startswith('|'):
            cells=[v.strip() for v in lines[i].strip().strip('|').split('|')]
            if not all(re.fullmatch(r'[:\-\s]+',v or '-') for v in cells):
                rows.append([Paragraph(inline(v),styles['Cell']) for v in cells])
            i+=1
        if rows:
            count=max(map(len,rows))
            for row in rows:row.extend([Paragraph('',styles['Cell'])]*(count-len(row)))
            widths=([150]+[(465-150)/(count-1)]*(count-1)) if count>1 else [465]
            table=Table(rows,colWidths=widths,repeatRows=1,hAlign='LEFT')
            table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e9ecfa')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f7f8fc')]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,0),.6,colors.HexColor('#d4d8ec'))]))
            story.extend([table,Spacer(1,9)])
        continue
    if line.startswith('# '):
        story.append(Paragraph(inline(line[2:]),styles['PaperTitle']))
    elif line.startswith('## '):
        story.append(Paragraph(inline(line[3:]),styles['Section']))
    elif line.startswith('### '):
        story.append(Paragraph(inline(line[4:]),styles['Subsection']))
    elif line.startswith('- ') or re.match(r'^\d+\. ',line):
        story.append(Paragraph(inline(line),styles['Paper']))
    else:
        parts=[line]
        while i+1<len(lines) and lines[i+1].strip() and not lines[i+1].lstrip().startswith(('#','|','```','- ')):
            if re.match(r'^\d+\. ',lines[i+1]):break
            i+=1;parts.append(lines[i].strip())
        story.append(Paragraph(inline(' '.join(parts)),styles['Paper']))
    i+=1

summary_file = ROOT / 'eval/output/v3/ablation/summary.json'
if not summary_file.exists():
    summary_file = ROOT / 'eval/output/v3/summary.json'
if summary_file.exists():
    summary=json.loads(summary_file.read_text(encoding='utf-8'))
    chart_names = {
        'raw_bm25': 'Raw BM25', 'midterm': 'Midterm TurnTrace',
        'turntrace2': 'Lexical hybrid', 'turntrace2_full': 'Full hybrid',
        'rerank_fixed': 'Fixed reranking', 'rerank_adaptive': 'Adaptive reranking',
    }
    systems = [system for system in summary.get('systems', []) if system['id'] in chart_names]
    if systems:
        chart_heading = Paragraph('Measured retrieval comparison', styles['Section'])
        chart_caption = Paragraph('Macro-averages on the inherited TEST judgments. Missing judgments limit interpretation.', styles['Paper'])
        drawing=Drawing(465,230)
        chart=VerticalBarChart();chart.x=45;chart.y=55;chart.width=390;chart.height=145
        metrics=['ndcg10','p10','knownRecall20']
        chart.data=[[float(s.get('metrics',{}).get(metric,0) or 0) for metric in metrics] for s in systems]
        chart.categoryAxis.categoryNames=['nDCG@10','Precision@10','Known Recall@20']
        chart.categoryAxis.labels.fontName='Body';chart.categoryAxis.labels.fontSize=9
        chart.valueAxis.valueMin=0;chart.valueAxis.valueMax=1;chart.valueAxis.valueStep=.2
        chart.valueAxis.labels.fontName='Body';chart.valueAxis.labels.fontSize=8
        palette=['#6b778d','#6d60b8','#3c2e8a','#397179','#177054','#ad541b']
        for n in range(len(systems)):chart.bars[n].fillColor=colors.HexColor(palette[n%len(palette)])
        chart.groupSpacing=13;chart.barSpacing=2;drawing.add(chart)
        for n, system in enumerate(systems):
            x = 45 + (n // 3) * 162
            y = 31 - (n % 3) * 12
            drawing.add(String(x, y, chart_names[system['id']], fontName='BodyBold', fontSize=8,
                               fillColor=colors.HexColor(palette[n])))
        story.append(KeepTogether([chart_heading, chart_caption, drawing]))

def chrome(canvas,doc):
    canvas.saveState();canvas.setFont('Body',8);canvas.setFillColor(colors.HexColor('#64748b'))
    canvas.drawString(65,32,'TurnTrace 2 | CSD358 Information Retrieval | Course project')
    canvas.drawRightString(530,32,str(doc.page));canvas.restoreState()

file=OUT/'TurnTrace2_Report.pdf'
SimpleDocTemplate(str(file),pagesize=(595.28,841.89),rightMargin=65,leftMargin=65,topMargin=48,bottomMargin=53,title='TurnTrace 2 - Inspectable Conversational Search',author='TurnTrace Team').build(story,onFirstPage=chrome,onLaterPages=chrome)
print(file)

if '--preview' in __import__('sys').argv:
    import pdfplumber
    preview=ROOT/'tmp/pdfs';preview.mkdir(parents=True,exist_ok=True)
    with pdfplumber.open(file) as document:
        for number,page in enumerate(document.pages):
            page.to_image(resolution=100).save(preview/f'page-{number+1:02d}.png')
        print(f'Rendered {len(document.pages)} pages into {preview}')
