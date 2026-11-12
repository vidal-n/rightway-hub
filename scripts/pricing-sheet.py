# Makes the internal pricing reference workbook (run by hand after the pricing numbers change):
#   python3 scripts/pricing-sheet.py && python3 <xlsx skill>/scripts/recalc.py public/training/pricing/Rightway-Pricing-Reference.xlsx
# Numbers come from public/js/planref.js and public/js/webprice.js through scripts/pricing-data.mjs.
import json, re, subprocess, sys, pathlib
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation

root = pathlib.Path(__file__).resolve().parent.parent
D = json.loads(subprocess.check_output(['node', str(root / 'scripts/pricing-data.mjs')], text=True))
out = root / 'public/training/pricing/Rightway-Pricing-Reference.xlsx'

F = 'Arial'
base = Font(name=F, size=10)
bold = Font(name=F, size=10, bold=True)
title = Font(name=F, size=14, bold=True, color='0F1B17')
inp = Font(name=F, size=10, color='0000FF')
head_fill = PatternFill('solid', fgColor='0F1B17')
head_font = Font(name=F, size=10, bold=True, color='FFFFFF')
in_fill = PatternFill('solid', fgColor='FFF9DB')
sug_fill = PatternFill('solid', fgColor='FDE7D0')
mint = PatternFill('solid', fgColor='E3F7EE')
thin = Side(style='thin', color='DCE6E1')
box = Border(top=thin, bottom=thin, left=thin, right=thin)
USD = '$#,##0;($#,##0);-'
USD2 = '$#,##0.00'

wb = Workbook()

def sheet(name, widths):
    ws = wb.create_sheet(name)
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[chr(64 + i)].width = w
    ws.sheet_view.showGridLines = False
    return ws

def put(ws, ref, v, font=base, fill=None, fmt=None, wrap=False, align=None):
    c = ws[ref]
    c.value = v
    c.font = font
    if fill: c.fill = fill
    if fmt: c.number_format = fmt
    c.alignment = Alignment(wrap_text=wrap, vertical='top', horizontal=align)
    return c

def header(ws, row, labels):
    for i, l in enumerate(labels, 1):
        c = ws.cell(row=row, column=i, value=l)
        c.font = head_font; c.fill = head_fill; c.border = box
        c.alignment = Alignment(wrap_text=True, vertical='center')
    ws.row_dimensions[row].height = 32

# ---------- Read me ----------
ws = wb.active
ws.title = 'Read me'
ws.sheet_view.showGridLines = False
ws.column_dimensions['A'].width = 3
ws.column_dimensions['B'].width = 110
put(ws, 'B2', 'Rightway Growth pricing reference', title)
put(ws, 'B3', 'INTERNAL. Closers and owners only. Never send this to a client or show it on a screen share.', Font(name=F, size=10, bold=True, color='B42318'))
lines = [
    ('How to use it', True),
    ('This is where to START a price so we never over or undercharge. Every client price is still custom: the closer types the buildout and the monthly after discovery.', False),
    ('Light yellow cells with blue text are inputs you can change. Everything else is a formula and updates on its own.', False),
    ('Orange cells are suggested starting points, not numbers V set. Confirm them before quoting.', False),
    ('', False),
    ('The model', True),
    (f"Local SEO comes first. The plans tab is V's pricing chart under our own names. Starter is the entry (loss leader). Every plan above it is the upsell after results.", False),
    (f"Websites are a separate service sold after results. The market floor is ${D['WEB_MIN']}. A 7 to 10 page site is ${D['WEB_TIERS'][2]['build']:,} to build and ${D['CARE_MONTHLY']} a month for hosting and care.", False),
    (f"After {D['OWN_AFTER_MONTHS']} months of care the client owns the site. Hosting still has to be paid wherever it lives. If they want us to keep managing it, it stays ${D['CARE_MONTHLY']} a month.", False),
    ('The build fee is the door. The monthly care and the SEO monthly are the residual income.', False),
    ('', False),
    ('Tabs', True),
    ('Plans: what each plan covers and its monthly price, plus the recommended Yelp and social averages.', False),
    ('Websites: build fee and monthly care by size, with year one and two year totals.', False),
    ('Bundles: SEO plan plus website care as one monthly number, and what the first year adds up to.', False),
    ('Residuals: month by month recurring revenue from websites and SEO clients, so you can see what the model builds.', False),
    ('', False),
    ('Not shown to clients', True),
    ('Clients see the services they signed up for and the one custom price. They never see this sheet, the plan prices or the upsell ladder.', False),
]
r = 5
for t, b in lines:
    put(ws, f'B{r}', t, bold if b else base, wrap=True)
    r += 1

# ---------- Plans ----------
ws = sheet('Plans', [22, 12, 12, 12, 12, 12, 14, 14, 12, 16, 10, 14, 14])
put(ws, 'A1', 'Plan guide (internal)', title)
put(ws, 'A2', "V's pricing chart under our names. The price column is where to start, never what the client sees.", base)
header(ws, 4, ['Plan', 'Monthly', 'Google posts', 'Photo uploads', 'Yelp posts', 'Social posts', 'Citation cleanup', 'Review requests', 'Reporting', 'Citation building and linking', 'Schema', 'Website management (chart)', 'Website overhaul (chart)'])
def has(plan, key): return any(i['key'] == key for i in plan['items'])
def num(plan, key, rx, g=1):
    for i in plan['items']:
        if i['key'] == key:
            m = re.search(rx, i['detail'])
            return int(m.group(g)) if m else None
    return None
for n, k in enumerate(D['PLAN_KEYS']):
    p = D['PLAN_REF'][k]; row = 5 + n
    put(ws, f'A{row}', p['name'] + ('  (entry, loss leader)' if k == 'starter' else ''), bold)
    put(ws, f'B{row}', p['monthly'], inp, in_fill, USD)
    put(ws, f'C{row}', num(p, 'gbp', r'(\d+) posts'), inp, in_fill)
    put(ws, f'D{row}', num(p, 'gbp', r'(\d+) photo'), inp, in_fill)
    put(ws, f'E{row}', num(p, 'yelp', r'(\d+) posts'), inp, in_fill)
    put(ws, f'F{row}', num(p, 'social', r'(\d+) posts'), inp, in_fill)
    for col, key in zip('GHIJKLM', ['cleanup', 'reviews', 'reporting', 'links', 'schema', 'site', 'overhaul']):
        put(ws, f'{col}{row}', 'Yes' if has(p, key) else '', base, align='center')
    for col in 'ABCDEFGHIJKLM': ws[f'{col}{row}'].border = box
put(ws, 'A10', 'Also on the higher plans', bold)
extras = ['Authority adds Q&A and review replies on the Google profile.', 'Market Leader adds a monthly Google profile audit.']
for i, t in enumerate(extras): put(ws, f'A{11 + i}', t, base)
put(ws, 'A14', 'Included on every plan', bold)
for i, x in enumerate(D['INCLUDED_ALL']): put(ws, f'A{15 + i}', f"{x['name']}: {x['what']}", base)
put(ws, 'A19', 'Upsell ladder', bold)
ladder = ['Start where the research puts the scope. If they push back, Starter is the entry: the foundation only.',
          'After results, move up a plan, or add the services sold separately: website, website SEO, Google Ads, Meta ads, more social, more content.',
          'Recommended averages by plan (Yelp / social posts a month): Starter 4 / 0, Growth 6 / 12, Authority 8 / 16, Market Leader 12 / 20.']
for i, t in enumerate(ladder): put(ws, f'A{20 + i}', t, base)
put(ws, 'A24', 'Yelp and social only go on a client\'s work when they are checked off in the client\'s scope of work.', base)
ws.freeze_panes = 'B5'

# ---------- Websites ----------
ws = sheet('Websites', [24, 11, 11, 14, 16, 16, 16, 14, 14, 60])
put(ws, 'A1', 'Website pricing', title)
put(ws, 'A2', 'Sold after local SEO shows results, as the next step. Low build fee brings more buyers. The monthly care is the residual.', base)
put(ws, 'A3', 'Market floor (never go under)', bold); put(ws, 'B3', D['WEB_MIN'], inp, in_fill, USD)
put(ws, 'A4', 'Hosting and care per month', bold); put(ws, 'B4', D['CARE_MONTHLY'], inp, in_fill, USD)
put(ws, 'A5', 'Months of care before they own it', bold); put(ws, 'B5', D['OWN_AFTER_MONTHS'], inp, in_fill)
put(ws, 'A6', 'Hosting only after that (type yours)', bold); put(ws, 'B6', None, inp, in_fill, USD)
put(ws, 'C6', 'Left blank on purpose. Hosting is required wherever the site lives. Managing it stays at the care price.', base)
header(ws, 8, ['Size', 'Pages from', 'Pages to', 'Build fee', 'Care per month', 'Year one total', 'Two year total', 'Build is V\'s number', 'Care is V\'s number', 'Notes'])
for n, t in enumerate(D['WEB_TIERS']):
    row = 9 + n
    put(ws, f'A{row}', t['label'], bold)
    put(ws, f'B{row}', t['pages'][0], base); put(ws, f'C{row}', t['pages'][1], base)
    put(ws, f'D{row}', t['build'], inp, in_fill if t['given']['build'] else sug_fill, USD)
    put(ws, f'E{row}', '=$B$4', base, None if t['given']['care'] else sug_fill, USD)
    put(ws, f'F{row}', f'=D{row}+E{row}*12', base, None, USD)
    put(ws, f'G{row}', f'=D{row}+E{row}*24', base, None, USD)
    put(ws, f'H{row}', 'Yes' if t['given']['build'] else 'Suggested', base, align='center')
    put(ws, f'I{row}', 'Yes' if t['given']['care'] else 'Suggested', base, align='center')
    put(ws, f'J{row}', t['note'], base, wrap=True)
    for col in 'ABCDEFGHIJ': ws[f'{col}{row}'].border = box
put(ws, 'A14', 'More than 15 pages or custom features: type your own price, starting above the 11 to 15 page price.', base)
put(ws, 'A16', 'Ownership', bold)
put(ws, 'A17', '=\"After \"&B5&\" months of paid hosting and care the client owns the site. Hosting must stay paid wherever it lives. If they want us to keep managing it, it stays \"&TEXT(B4,\"$#,##0\")&\" a month.\"', base)
put(ws, 'A19', 'Orange = a suggested starting point, not a number V set.', base)
ws.freeze_panes = 'A9'

# ---------- Bundles ----------
ws = sheet('Bundles', [28, 16, 16, 16, 16, 16, 18])
put(ws, 'A1', 'Bundles: SEO plus website care', title)
put(ws, 'A2', 'No discount is built in. The closer types the price. This shows what the numbers add up to.', base)
put(ws, 'A3', 'Website size', bold)
put(ws, 'B3', D['WEB_TIERS'][2]['label'], inp, in_fill)
dv = DataValidation(type='list', formula1='=Websites!$A$9:$A$12', allow_blank=False)
ws.add_data_validation(dv); dv.add('B3')
put(ws, 'A4', 'Build fee for that size', bold)
put(ws, 'B4', '=INDEX(Websites!$D$9:$D$12,MATCH($B$3,Websites!$A$9:$A$12,0))', base, None, USD)
header(ws, 6, ['Plan', 'SEO monthly', 'Website care', 'Bundle monthly', 'Bundle annual', 'Website build', 'First year total'])
for n, k in enumerate(D['PLAN_KEYS']):
    row = 7 + n; pr = 5 + n
    put(ws, f'A{row}', f'=Plans!A{pr}', bold)
    put(ws, f'B{row}', f'=Plans!B{pr}', base, None, USD)
    put(ws, f'C{row}', '=Websites!$B$4', base, None, USD)
    put(ws, f'D{row}', f'=B{row}+C{row}', base, mint, USD)
    put(ws, f'E{row}', f'=D{row}*12', base, None, USD)
    put(ws, f'F{row}', '=$B$4', base, None, USD)
    put(ws, f'G{row}', f'=F{row}+E{row}', bold, None, USD)
    for col in 'ABCDEFG': ws[f'{col}{row}'].border = box
put(ws, 'A12', 'Social posts and Yelp where they fit', bold)
put(ws, 'A13', 'Growth and up already carry social posts in the chart (12, 16, 20 a month). Starter can add social as a separate check-off service when the business needs it.', base)
put(ws, 'A14', 'Website care is its own line (hosting, backups, updates, small edits). It is checked off in the client scope as Website hosting and care.', base)

# ---------- Residuals ----------
ws = sheet('Residuals', [30, 14, 14, 16, 16, 16, 16, 16, 18])
put(ws, 'A1', 'Residuals: what the model builds', title)
put(ws, 'A2', 'Change the yellow cells. Month by month recurring revenue from website care and SEO clients.', base)
rows_in = [
    ('Websites sold per month', 2, None),
    ('Build fee per website', f"=Websites!D{9 + 2}", USD),
    ('Care per month', '=Websites!B4', USD),
    ('Share that keep care', 1, '0%'),
    ('New SEO clients per month', 2, None),
    ('SEO monthly (typical deal)', '=Plans!B6', USD),
    ('Monthly churn', 0, '0%'),
]
for i, (lab, val, fmt) in enumerate(rows_in):
    r_ = 3 + i
    put(ws, f'A{r_}', lab, bold)
    put(ws, f'B{r_}', val, inp, in_fill, fmt)
put(ws, 'C4', 'Defaults to the 7 to 10 page build fee.', base)
put(ws, 'C8', 'Defaults to the Growth plan.', base)
header(ws, 11, ['Month', 'Care clients', 'SEO clients', 'Website builds', 'Care revenue', 'SEO revenue', 'Monthly recurring', 'Total this month', 'Cumulative'])
for m in range(1, 25):
    r_ = 11 + m
    put(ws, f'A{r_}', m, base, align='center')
    prev = f'B{r_ - 1}' if m > 1 else None
    put(ws, f'B{r_}', f'={prev}*(1-$B$9)+$B$3*$B$6' if m > 1 else '=$B$3*$B$6', base, None, '#,##0.0')
    prevs = f'C{r_ - 1}' if m > 1 else None
    put(ws, f'C{r_}', f'={prevs}*(1-$B$9)+$B$7' if m > 1 else '=$B$7', base, None, '#,##0.0')
    put(ws, f'D{r_}', '=$B$3*$B$4', base, None, USD)
    put(ws, f'E{r_}', f'=B{r_}*$B$5', base, None, USD)
    put(ws, f'F{r_}', f'=C{r_}*$B$8', base, None, USD)
    put(ws, f'G{r_}', f'=E{r_}+F{r_}', base, mint, USD)
    put(ws, f'H{r_}', f'=D{r_}+G{r_}', base, None, USD)
    put(ws, f'I{r_}', f'=H{r_}' if m == 1 else f'=I{r_ - 1}+H{r_}', bold, None, USD)
    for col in 'ABCDEFGHI': ws[f'{col}{r_}'].border = box
put(ws, 'A37', 'Monthly recurring at month 12', bold); put(ws, 'B37', '=G23', bold, mint, USD)
put(ws, 'A38', 'Monthly recurring at month 24', bold); put(ws, 'B38', '=G35', bold, mint, USD)
ws.freeze_panes = 'A12'

out.parent.mkdir(parents=True, exist_ok=True)
wb.save(out)
print('saved', out)
