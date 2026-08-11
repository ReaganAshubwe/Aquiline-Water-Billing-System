#!/usr/bin/env python3
"""
Aqualine Water Billing System
Customer Account Statement & Transaction Report Generator (PDF)
"""

import sys
import json
import os
from datetime import datetime

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
except ImportError:
    # Ensure reportlab is available
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "reportlab", "--quiet", "--break-system-packages"])
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

def format_kes(amount):
    try:
        val = float(amount or 0)
        return f"KES {val:,.2f}"
    except Exception:
        return f"KES {amount}"

def format_date(dt_str):
    if not dt_str:
        return "-"
    try:
        dt = datetime.fromisoformat(str(dt_str).replace('Z', '+00:00'))
        return dt.strftime('%d %b %Y, %I:%M %p')
    except Exception:
        return str(dt_str)[:19]

def generate_statement_pdf(data, output_path):
    customer = data.get('customer', {})
    payments = data.get('payments', [])
    refunds = data.get('refunds', [])

    # Calculate statistics
    total_spent = 0.0
    total_litres = 0
    total_paid_count = 0
    total_refunded = 0.0
    active_tokens = []

    for p in payments:
        amt = float(p.get('amount') or 0)
        litres = int(p.get('litresBought') or 0)
        status = p.get('status', '').lower()
        ref_status = p.get('refundStatus', '').lower()
        ref_amt = float(p.get('refundedAmount') or 0)

        if status == 'paid':
            total_spent += amt
            total_litres += litres
            total_paid_count += 1
            if p.get('tokenCode'):
                active_tokens.append(p.get('tokenCode'))
        
        if ref_status == 'refunded' or ref_amt > 0:
            total_refunded += ref_amt

    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()

    # Custom styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=colors.HexColor('#0c4a6e')
    )

    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=colors.HexColor('#475569')
    )

    h2_style = ParagraphStyle(
        'H2_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=15,
        textColor=colors.HexColor('#0369a1'),
        spaceBefore=8,
        spaceAfter=4
    )

    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor('#1e293b')
    )

    body_bold = ParagraphStyle(
        'Body_Bold',
        parent=body_style,
        fontName='Helvetica-Bold'
    )

    table_header_style = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=11,
        textColor=colors.HexColor('#0f172a')
    )

    table_cell_style = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=11,
        textColor=colors.HexColor('#334155')
    )

    table_cell_mono = ParagraphStyle(
        'TableCellMono',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=7.5,
        leading=10,
        textColor=colors.HexColor('#0f172a')
    )

    story = []

    # 1. Header & Organization Banner
    now_str = datetime.now().strftime('%d %b %Y, %I:%M %p')
    header_data = [
        [
            Paragraph("<b>Aqualine Water Billing Company</b><br/><font size=11 color='#0284c7'><b>Customer Account Statement & Transaction Report</b></font>", title_style),
            Paragraph(f"<b>Statement Ref:</b> STMT-{int(datetime.now().timestamp())}<br/><b>Generated:</b> {now_str}<br/><b>System:</b> Live Token Gateway", subtitle_style)
        ]
    ]
    header_table = Table(header_data, colWidths=[350, 190])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(header_table)
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#0284c7'), spaceAfter=8, spaceBefore=4))

    # 2. Customer Profile Details & Summary Table
    cust_name = customer.get('fullName', 'N/A')
    cust_phone = customer.get('phone', 'N/A')
    cust_id = customer.get('id', 'N/A')
    reg_date = format_date(customer.get('createdAt'))
    last_act = format_date(customer.get('lastActivityAt'))

    profile_data = [
        [
            Paragraph("<b>Account Holder:</b>", body_bold), Paragraph(cust_name, body_style),
            Paragraph("<b>Total Spent:</b>", body_bold), Paragraph(f"<b>{format_kes(total_spent)}</b>", body_style)
        ],
        [
            Paragraph("<b>Phone Number:</b>", body_bold), Paragraph(cust_phone, body_style),
            Paragraph("<b>Water Volume:</b>", body_bold), Paragraph(f"<b>{total_litres:,} Litres</b>", body_style)
        ],
        [
            Paragraph("<b>Customer ID:</b>", body_bold), Paragraph(f"<code>{cust_id[:16]}...</code>" if len(cust_id) > 16 else cust_id, table_cell_mono),
            Paragraph("<b>Transactions:</b>", body_bold), Paragraph(f"{total_paid_count} Completed ({len(payments)} Total)", body_style)
        ],
        [
            Paragraph("<b>Member Since:</b>", body_bold), Paragraph(reg_date, body_style),
            Paragraph("<b>Total Refunded:</b>", body_bold), Paragraph(format_kes(total_refunded) if total_refunded > 0 else "KES 0.00", body_style)
        ]
    ]

    profile_table = Table(profile_data, colWidths=[90, 175, 95, 180])
    profile_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f8fafc')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(profile_table)
    story.append(Spacer(1, 6))

    # 3. Transaction History Table
    story.append(Paragraph("Transaction History & Token Registry", h2_style))

    if not payments:
        story.append(Paragraph("<i>No transaction records found for this account.</i>", body_style))
    else:
        table_rows = [
            [
                Paragraph("<b>Date / Time</b>", table_header_style),
                Paragraph("<b>Amount</b>", table_header_style),
                Paragraph("<b>Volume</b>", table_header_style),
                Paragraph("<b>Status</b>", table_header_style),
                Paragraph("<b>Token Code</b>", table_header_style),
                Paragraph("<b>M-Pesa Receipt</b>", table_header_style),
                Paragraph("<b>Channel</b>", table_header_style)
            ]
        ]

        for p in payments:
            dt = format_date(p.get('createdAt'))
            amt = format_kes(p.get('amount'))
            litres = f"{int(p.get('litresBought') or 0):,} L"
            status = p.get('status', 'unknown')
            token = p.get('tokenCode') or '-'
            receipt = p.get('mpesaReceipt') or p.get('mpesaReceiptSubmitted') or '-'
            channel = p.get('paymentChannel', 'mpesa_stk')
            channel_str = 'STK Push' if channel == 'mpesa_stk' else 'Manual'

            # Status pill styling
            if status == 'paid':
                status_color = '#059669'
                status_badge = f"<font color='{status_color}'><b>PAID</b></font>"
            elif status == 'pending' or status == 'pending_manual':
                status_color = '#d97706'
                status_badge = f"<font color='{status_color}'><b>PENDING</b></font>"
            elif status == 'failed':
                status_color = '#dc2626'
                status_badge = f"<font color='{status_color}'><b>FAILED</b></font>"
            else:
                status_badge = f"<b>{status.upper()}</b>"

            if p.get('refundStatus') == 'refunded':
                status_badge += " <font size=6 color='#dc2626'>[REFUNDED]</font>"
            elif p.get('refundStatus') == 'pending':
                status_badge += " <font size=6 color='#d97706'>[REF_PENDING]</font>"

            table_rows.append([
                Paragraph(dt, table_cell_style),
                Paragraph(f"<b>{amt}</b>", table_cell_style),
                Paragraph(litres, table_cell_style),
                Paragraph(status_badge, table_cell_style),
                Paragraph(f"<b>{token}</b>", table_cell_mono),
                Paragraph(receipt, table_cell_mono),
                Paragraph(channel_str, table_cell_style)
            ])

        tx_table = Table(table_rows, colWidths=[95, 75, 50, 70, 75, 115, 60])
        tx_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#e0f2fe')),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('TOPPADDING', (0,0), (-1,-1), 3),
            ('BOTTOMPADDING', (0,0), (-1,-1), 3),
            ('LEFTPADDING', (0,0), (-1,-1), 4),
            ('RIGHTPADDING', (0,0), (-1,-1), 4),
        ]))
        story.append(tx_table)

    story.append(Spacer(1, 6))

    # 4. Refunds / Dispute Section (if applicable)
    cust_refunds = [r for r in refunds if r.get('customerId') == customer.get('id')]
    if cust_refunds:
        story.append(Paragraph("Refunds & Adjustment Log", h2_style))
        ref_rows = [
            [
                Paragraph("<b>Date</b>", table_header_style),
                Paragraph("<b>Amount</b>", table_header_style),
                Paragraph("<b>Reason</b>", table_header_style),
                Paragraph("<b>Status</b>", table_header_style),
                Paragraph("<b>Payment ID</b>", table_header_style)
            ]
        ]
        for r in cust_refunds:
            dt = format_date(r.get('createdAt'))
            amt = format_kes(r.get('amount'))
            reason = r.get('reason', '-')
            st = r.get('status', 'unknown').upper()
            pid = (r.get('paymentId') or '')[:12]
            ref_rows.append([
                Paragraph(dt, table_cell_style),
                Paragraph(amt, table_cell_style),
                Paragraph(reason, table_cell_style),
                Paragraph(f"<b>{st}</b>", table_cell_style),
                Paragraph(pid, table_cell_mono)
            ])
        ref_table = Table(ref_rows, colWidths=[95, 80, 185, 90, 90])
        ref_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#fef3c7')),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('TOPPADDING', (0,0), (-1,-1), 3),
            ('BOTTOMPADDING', (0,0), (-1,-1), 3),
            ('LEFTPADDING', (0,0), (-1,-1), 4),
            ('RIGHTPADDING', (0,0), (-1,-1), 4),
        ]))
        story.append(ref_table)
        story.append(Spacer(1, 6))

    # 5. Footer & Instructions
    footer_text = (
        "<b>Notice:</b> This statement is an official electronic record issued by Aqualine Water Billing Company. "
        "Tokens listed above are valid for water dispensing at any authorized Aqualine station. "
        "For billing inquiries or dispenser support, contact <b>+254 700 000 000</b> or email <b>aqualinesupport@gmail.com</b>."
    )
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#94a3b8'), spaceAfter=4, spaceBefore=6))
    story.append(Paragraph(footer_text, subtitle_style))

    doc.build(story)
    print(f"Statement generated: {output_path}")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 customer_statement_pdf.py <input_json_path> <output_pdf_path>")
        sys.exit(1)

    json_path = sys.argv[1]
    pdf_path = sys.argv[2]

    with open(json_path, 'r', encoding='utf-8') as f:
        payload = json.load(f)

    generate_statement_pdf(payload, pdf_path)
