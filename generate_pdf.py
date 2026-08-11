#!/usr/bin/env python3
"""
Generate Aqualine_MySQL_Connector_Guide.pdf
"""
import os
import sys
import subprocess

def ensure_package():
    try:
        import reportlab
        return
    except ImportError:
        pass
    
    try:
        import fpdf
        return
    except ImportError:
        pass

    # Try installing reportlab or fpdf2
    print("Installing reportlab for PDF generation...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "reportlab", "--quiet", "--break-system-packages"])

ensure_package()

from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Preformatted, KeepTogether, HRFlowable
)

def build_pdf(filename):
    doc = SimpleDocTemplate(
        filename,
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
        fontSize=20,
        leading=24,
        textColor=colors.HexColor('#0f172a'),
        alignment=0
    )

    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=colors.HexColor('#475569')
    )

    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=17,
        textColor=colors.HexColor('#0284c7'),
        spaceBefore=10,
        spaceAfter=4
    )

    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13.5,
        textColor=colors.HexColor('#334155')
    )

    bold_body_style = ParagraphStyle(
        'BoldBody_Custom',
        parent=body_style,
        fontName='Helvetica-Bold'
    )

    code_block_style = ParagraphStyle(
        'CodeBlock',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=8,
        leading=10.5,
        textColor=colors.HexColor('#0f172a')
    )

    story = []

    # Title & Subtitle Header Banner
    header_data = [
        [
            Paragraph("<b>Aqualine Water Billing System</b><br/><font size=12 color='#0284c7'><b>MySQL Database Connector Guide</b></font>", title_style),
            Paragraph("<b>Architecture & Integration Doc</b><br/>App: <code>Aquiline-Water-Billing</code><br/>Driver: <code>mysql2/promise</code>", subtitle_style)
        ]
    ]
    header_table = Table(header_data, colWidths=[360, 180])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(header_table)
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#0284c7'), spaceAfter=10, spaceBefore=4))

    # Executive Summary
    summary_text = (
        "This guide explains how the <b>Aqualine Water Billing System</b> connects to, manages, "
        "and synchronizes data with a <b>MySQL database</b>. It details the connection configuration, "
        "pooling mechanism, automatic schema migrations, and real-time data persistence strategy."
    )
    story.append(Paragraph(summary_text, body_style))
    story.append(Spacer(1, 8))

    # Section 1: Configuration (.env)
    story.append(Paragraph("1. Configuration & Credentials (.env)", h1_style))
    env_desc = "The application uses <code>dotenv</code> to load MySQL credentials from the environment file (<code>.env</code>):"
    story.append(Paragraph(env_desc, body_style))
    story.append(Spacer(1, 4))

    env_code = (
        "MYSQL_HOST=127.0.0.1          # Database server host\n"
        "MYSQL_PORT=3306               # Port (default 3306)\n"
        "MYSQL_USER=root               # MySQL username\n"
        "MYSQL_PASSWORD=               # MySQL user password\n"
        "MYSQL_DATABASE=my_db          # Target schema/database name\n"
        "MYSQL_TABLE_PREFIX=awbc_      # Prefix applied to all system tables\n"
        "# Or via single URI string: MYSQL_URL=mysql://root:password@127.0.0.1:3306/my_db"
    )
    code_table = Table([[Preformatted(env_code, code_block_style)]], colWidths=[540])
    code_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f1f5f9')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(code_table)
    story.append(Spacer(1, 8))

    # Section 2: Connection Pool Creation
    story.append(Paragraph("2. Connection Pool Creation (server.js)", h1_style))
    pool_desc = (
        "The connection is initialized via <code>createMysqlPool()</code> using the high-performance "
        "<b><code>mysql2/promise</code></b> driver. It maintains a pool of up to 5 concurrent connections "
        "with automatic connection queuing and UTF-8 encoding support:"
    )
    story.append(Paragraph(pool_desc, body_style))
    story.append(Spacer(1, 4))

    pool_code = (
        "function createMysqlPool() {\n"
        "  if (MYSQL_CONNECTION_URL) {\n"
        "    return mysql.createPool({ uri: MYSQL_CONNECTION_URL, waitForConnections: true, connectionLimit: 5 });\n"
        "  }\n"
        "  return mysql.createPool({\n"
        "    host: MYSQL_HOST, port: MYSQL_PORT, user: MYSQL_USER, password: MYSQL_PASSWORD,\n"
        "    database: MYSQL_DATABASE, waitForConnections: true, connectionLimit: 5, charset: 'utf8mb4'\n"
        "  });\n"
        "}"
    )
    pool_table = Table([[Preformatted(pool_code, code_block_style)]], colWidths=[540])
    pool_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f1f5f9')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(pool_table)
    story.append(Spacer(1, 8))

    # Section 3: Automatic Schema Management & Tables
    story.append(Paragraph("3. Managed Database Tables (Schema Auto-Generation)", h1_style))
    schema_desc = (
        "On server startup, <code>initializeDatabase()</code> executes <code>ensureMysqlSchema()</code>, "
        "automatically creating all required relational tables with proper types, keys, and indexes if they do not exist:"
    )
    story.append(Paragraph(schema_desc, body_style))
    story.append(Spacer(1, 4))

    table_info = [
        [Paragraph("<b>Table Name</b>", bold_body_style), Paragraph("<b>Description & Contents</b>", bold_body_style), Paragraph("<b>Key Columns</b>", bold_body_style)],
        [Paragraph("<code>awbc_customers</code>", code_block_style), Paragraph("Customer accounts, phones, auth tokens, session state", body_style), Paragraph("<code>id, phone, login_code, login_token</code>", code_block_style)],
        [Paragraph("<code>awbc_payments</code>", code_block_style), Paragraph("M-Pesa STK & manual water purchases, receipts, tokens", body_style), Paragraph("<code>id, amount, mpesa_receipt, token_code</code>", code_block_style)],
        [Paragraph("<code>awbc_settlements</code>", code_block_style), Paragraph("Automated revenue split (Savings 70% / Operations 30%)", body_style), Paragraph("<code>id, payment_id, savings_amount</code>", code_block_style)],
        [Paragraph("<code>awbc_refunds</code>", code_block_style), Paragraph("Refund requests, dual-step approval, issued adjustments", body_style), Paragraph("<code>id, payment_id, amount, status</code>", code_block_style)],
        [Paragraph("<code>awbc_ledger_entries</code>", code_block_style), Paragraph("Double-entry accounting journal for all cash flows", body_style), Paragraph("<code>id, type, direction, account, amount</code>", code_block_style)],
        [Paragraph("<code>awbc_finance_state</code>", code_block_style), Paragraph("System balance states, float thresholds, and policies", body_style), Paragraph("<code>id, policy, balances, last_auto_settlement</code>", code_block_style)],
    ]
    schema_table = Table(table_info, colWidths=[120, 240, 180])
    schema_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#e2e8f0')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 3.5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3.5),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(schema_table)
    story.append(Spacer(1, 8))

    # Section 4: Data Flow & In-Memory Synchronization
    story.append(Paragraph("4. Data Synchronization & Persistence Architecture", h1_style))
    flow_desc = (
        "The app implements a high-speed <b>In-Memory Cache + Asynchronous Write-Through</b> architecture:<br/>"
        "• <b>Fast Reads:</b> High-frequency read queries are served instantaneously from <code>dbCache</code> (memory).<br/>"
        "• <b>Debounced Writes:</b> Updates trigger <code>scheduleDbPersist()</code> which debounces writes by 50ms.<br/>"
        "• <b>ACID Transactions:</b> Writes execute inside MySQL transactions (<code>START TRANSACTION ... COMMIT</code>) "
        "to guarantee zero partial state updates or corruption."
    )
    story.append(Paragraph(flow_desc, body_style))
    story.append(Spacer(1, 8))

    # Section 5: Fault-Tolerant Fallback
    story.append(Paragraph("5. Automatic Fallback Protection", h1_style))
    fallback_desc = (
        "If MySQL is unreachable (e.g. server down, invalid password, or missing config), the application does <b>not crash</b>. "
        "It logs a descriptive warning and automatically falls back to local JSON file storage (<code>data/db.json</code>). "
        "When MySQL becomes available, data can be migrated seamlessly."
    )
    story.append(Paragraph(fallback_desc, body_style))
    story.append(Spacer(1, 8))

    # Section 6: Verification Checklist
    story.append(Paragraph("6. Quick Verification & Testing Checklist", h1_style))
    check_data = [
        [Paragraph("<b>Step</b>", bold_body_style), Paragraph("<b>Action</b>", bold_body_style), Paragraph("<b>Expected Result</b>", bold_body_style)],
        [Paragraph("1. Check MySQL", body_style), Paragraph("Ensure MySQL service is active and database exists (<code>CREATE DATABASE my_db;</code>)", body_style), Paragraph("Database is ready to accept connections.", body_style)],
        [Paragraph("2. Configure .env", body_style), Paragraph("Set <code>MYSQL_USER</code>, <code>MYSQL_PASSWORD</code>, <code>MYSQL_DATABASE</code> in <code>.env</code>", body_style), Paragraph("App picks up credentials at startup.", body_style)],
        [Paragraph("3. Start Server", body_style), Paragraph("Run <code>npm start</code>", body_style), Paragraph("Log: <code>Aqualine server running at http://localhost:3000</code>", body_style)],
        [Paragraph("4. Check Tables", body_style), Paragraph("In MySQL console, run <code>SHOW TABLES;</code>", body_style), Paragraph("Lists <code>awbc_customers, awbc_payments...</code>", body_style)],
    ]
    check_table = Table(check_data, colWidths=[90, 240, 210])
    check_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#e2e8f0')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 3.5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3.5),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(check_table)

    doc.build(story)
    print(f"PDF successfully generated at: {filename}")

if __name__ == '__main__':
    out_pdf = os.path.abspath(os.path.join(os.path.dirname(__file__), 'Aqualine_MySQL_Connector_Guide.pdf'))
    build_pdf(out_pdf)
