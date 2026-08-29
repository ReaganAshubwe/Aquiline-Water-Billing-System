const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
const nodemailer = require('nodemailer');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'AQUALINE_ADMIN_2026';
const APPROVER_KEY = process.env.APPROVER_KEY || '';

const EMAIL_ENABLED = process.env.EMAIL_ENABLED !== 'false';
const EMAIL_SERVICE = process.env.EMAIL_SERVICE || 'gmail';
const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD || '';
const EMAIL_FROM = process.env.EMAIL_FROM || `Aqualine Water Billing <${EMAIL_USER || 'support@aqualine.co.ke'}>`;

const MPESA_ENABLED = process.env.MPESA_ENABLED === 'true';
const MPESA_ENV = process.env.MPESA_ENV || 'sandbox';
const MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || '';
const MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || '';
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE || '';
const MPESA_PASSKEY = process.env.MPESA_PASSKEY || '';
const MPESA_CALLBACK_URL = process.env.MPESA_CALLBACK_URL || '';
const MPESA_TILL_NUMBER = process.env.MPESA_TILL_NUMBER || '';

const SMS_ENABLED = process.env.SMS_ENABLED === 'true';
const SMS_PROVIDER = process.env.SMS_PROVIDER || 'africastalking';
const SMS_API_KEY = process.env.SMS_API_KEY || '';
const SMS_USERNAME = process.env.SMS_USERNAME || '';
const SMS_SENDER_ID = process.env.SMS_SENDER_ID || '';

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const DB_SEED_PATH = path.join(__dirname, 'data', 'db.seed.json');
const MYSQL_TABLE_PREFIX = process.env.MYSQL_TABLE_PREFIX || 'awbc_';
const MYSQL_CONNECTION_URL = process.env.MYSQL_URL || '';
const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
const MYSQL_PORT = Number(process.env.MYSQL_PORT) || 3306;
const MYSQL_USER = process.env.MYSQL_USER || '';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || '';

const PRICING = {
  perLitre: 10,
  per1000Litre: 10000
};

const SETTLEMENT_SAVINGS_PERCENT = Math.min(
  Math.max(Number(process.env.SETTLEMENT_SAVINGS_PERCENT) || 70, 0),
  100
);
const SETTLEMENT_OPERATIONS_PERCENT = 100 - SETTLEMENT_SAVINGS_PERCENT;
const MIN_OPERATIONS_FLOAT = Math.max(Number(process.env.MIN_OPERATIONS_FLOAT) || 20000, 0);
const AUTO_SETTLEMENT_ENABLED = process.env.AUTO_SETTLEMENT_ENABLED !== 'false';
const AUTO_SETTLEMENT_HOUR_UTC = Math.min(
  Math.max(Number(process.env.AUTO_SETTLEMENT_HOUR_UTC) || 1, 0),
  23
);

let dbCache = null;
let dbInitPromise = null;
let mysqlPool = null;
let persistTimer = null;
let persistPromise = Promise.resolve();

const MYSQL_TABLES = {
  customers: `${MYSQL_TABLE_PREFIX}customers`,
  payments: `${MYSQL_TABLE_PREFIX}payments`,
  settlements: `${MYSQL_TABLE_PREFIX}settlements`,
  refunds: `${MYSQL_TABLE_PREFIX}refunds`,
  ledger: `${MYSQL_TABLE_PREFIX}ledger_entries`,
  finance: `${MYSQL_TABLE_PREFIX}finance_state`
};

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key, x-admin-actor, x-approver-key, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});
app.use(express.static(path.join(__dirname, 'public')));

function extractBearerToken(authorization) {
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return null;
  }
  return authorization.slice(7).trim();
}

async function requireAdmin(req, res, next) {
  try {
    const headerKey = req.get('x-admin-key');
    const bearerKey = extractBearerToken(req.get('authorization'));
    const providedKey = headerKey || bearerKey;

    if (!providedKey) {
      return res.status(401).json({ error: 'Unauthorized admin access' });
    }

    let currentAdminKey = ADMIN_KEY;

    if (mysqlPool) {
      try {
        const [rows] = await mysqlPool.query(`SELECT admin_key FROM \`${MYSQL_TABLES.finance}\` WHERE id = 1 LIMIT 1`);
        if (rows.length > 0 && rows[0].admin_key !== null && rows[0].admin_key !== undefined) {
          currentAdminKey = rows[0].admin_key;
        }
      } catch (err) {
        console.error(`Failed to fetch admin key from MySQL: ${err.message}`);
        const db = readDb();
        if (db.finance && db.finance.adminKey) {
          currentAdminKey = db.finance.adminKey;
        }
      }
    } else {
      const db = readDb();
      if (db.finance && db.finance.adminKey) {
        currentAdminKey = db.finance.adminKey;
      }
    }

    if (providedKey !== currentAdminKey) {
      return res.status(401).json({ error: 'Unauthorized admin access' });
    }

    next();
  } catch (error) {
    next(error);
  }
}

async function requireApprover(req, res, next) {
  try {
    let currentApproverKey = APPROVER_KEY;

    if (mysqlPool) {
      try {
        const [rows] = await mysqlPool.query(`SELECT approver_key FROM \`${MYSQL_TABLES.finance}\` WHERE id = 1 LIMIT 1`);
        if (rows.length > 0 && rows[0].approver_key !== null && rows[0].approver_key !== undefined) {
          currentApproverKey = rows[0].approver_key;
        }
      } catch (err) {
        console.error(`Failed to fetch approver key from MySQL: ${err.message}`);
        const db = readDb();
        if (db.finance && db.finance.approverKey) {
          currentApproverKey = db.finance.approverKey;
        }
      }
    } else {
      const db = readDb();
      if (db.finance && db.finance.approverKey) {
        currentApproverKey = db.finance.approverKey;
      }
    }

    if (!currentApproverKey) {
      return next();
    }

    const providedApproverKey = req.get('x-approver-key');
    if (!providedApproverKey || providedApproverKey !== currentApproverKey) {
      return res.status(401).json({ error: 'Unauthorized approver access' });
    }

    next();
  } catch (error) {
    next(error);
  }
}

function parseAuthorizationToken(req) {
  const authorization = req.get('authorization') || '';
  if (authorization.startsWith('Bearer ')) {
    return authorization.slice(7).trim();
  }
  if (req.query?.token) {
    return String(req.query.token).trim();
  }
  if (req.get('x-customer-token')) {
    return req.get('x-customer-token').trim();
  }
  return '';
}

function requireCustomer(req, res, next) {
  const token = parseAuthorizationToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Customer login required' });
  }

  const db = readDb();
  const customer = db.customers.find((entry) => entry.loginToken === token);
  if (!customer) {
    return res.status(401).json({ error: 'Invalid customer session' });
  }

  req.customer = customer;
  next();
}

function loadSeedDb() {
  const preferredPaths = [DB_SEED_PATH, DB_PATH];

  for (const filePath of preferredPaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return ensureDbSchema(JSON.parse(content));
    } catch (error) {
      console.warn(`Failed to load local database file at ${filePath}: ${error.message}`);
    }
  }

  return ensureDbSchema({});
}

function hasMysqlConfig() {
  return Boolean(MYSQL_CONNECTION_URL || (MYSQL_USER && MYSQL_DATABASE));
}

function createMysqlPool() {
  if (MYSQL_CONNECTION_URL) {
    return mysql.createPool({
      uri: MYSQL_CONNECTION_URL,
      waitForConnections: true,
      connectionLimit: 5
    });
  }

  return mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4'
  });
}

function mysqlJson(value) {
  return JSON.stringify(value ?? null);
}

function mysqlParseJson(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function ensureMysqlSchema() {
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS \`${MYSQL_TABLES.customers}\` (
      id CHAR(36) NOT NULL PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL,
      phone VARCHAR(32) NOT NULL UNIQUE,
      email VARCHAR(255) DEFAULT NULL,
      login_code VARCHAR(32) DEFAULT NULL,
      login_token VARCHAR(64) DEFAULT NULL,
      email_otp VARCHAR(16) DEFAULT NULL,
      otp_expires_at DATETIME(3) DEFAULT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      last_activity_at DATETIME(3) NOT NULL,
      UNIQUE KEY uq_awbc_customers_login_token (login_token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const customerColumnChecks = [
    ['email', 'VARCHAR(255) DEFAULT NULL'],
    ['login_code', 'VARCHAR(32) DEFAULT NULL'],
    ['login_token', 'VARCHAR(64) DEFAULT NULL'],
    ['email_otp', 'VARCHAR(16) DEFAULT NULL'],
    ['otp_expires_at', 'DATETIME(3) DEFAULT NULL']
  ];

  for (const [columnName, columnDefinition] of customerColumnChecks) {
    const [rows] = await mysqlPool.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?`,
      [MYSQL_DATABASE, MYSQL_TABLES.customers, columnName]
    );

    if (Number(rows[0]?.count || 0) === 0) {
      await mysqlPool.query(
        `ALTER TABLE \`${MYSQL_TABLES.customers}\` ADD COLUMN \`${columnName}\` ${columnDefinition}`
      );
    }
  }

  const [loginTokenIndexRows] = await mysqlPool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND INDEX_NAME = 'uq_awbc_customers_login_token'`,
    [MYSQL_DATABASE, MYSQL_TABLES.customers]
  );

  if (Number(loginTokenIndexRows[0]?.count || 0) === 0) {
    await mysqlPool.query(
      `ALTER TABLE \`${MYSQL_TABLES.customers}\` ADD UNIQUE KEY uq_awbc_customers_login_token (login_token)`
    );
  }

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS \`${MYSQL_TABLES.payments}\` (
      id CHAR(36) NOT NULL PRIMARY KEY,
      customer_id CHAR(36) NOT NULL,
      phone VARCHAR(32) NOT NULL,
      amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      unit_type VARCHAR(20) NOT NULL,
      status VARCHAR(32) NOT NULL,
      payment_channel VARCHAR(50) NOT NULL DEFAULT 'mpesa_stk',
      checkout_request_id VARCHAR(100) DEFAULT NULL,
      merchant_request_id VARCHAR(100) DEFAULT NULL,
      mpesa_receipt VARCHAR(100) DEFAULT NULL,
      mpesa_receipt_submitted VARCHAR(100) DEFAULT NULL,
      token_code VARCHAR(32) DEFAULT NULL,
      litres_bought INT NOT NULL DEFAULT 0,
      refunded_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      refund_status VARCHAR(20) NOT NULL DEFAULT 'none',
      failure_reason TEXT DEFAULT NULL,
      rejection_reason TEXT DEFAULT NULL,
      settlement_id CHAR(36) DEFAULT NULL,
      sms JSON DEFAULT NULL,
      approved_at DATETIME(3) DEFAULT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      INDEX idx_payments_customer_id (customer_id),
      INDEX idx_payments_status (status),
      INDEX idx_payments_checkout_request_id (checkout_request_id),
      CONSTRAINT fk_payments_customer FOREIGN KEY (customer_id) REFERENCES \`${MYSQL_TABLES.customers}\` (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS \`${MYSQL_TABLES.settlements}\` (
      id CHAR(36) NOT NULL PRIMARY KEY,
      payment_id CHAR(36) NOT NULL,
      customer_id CHAR(36) NOT NULL,
      total_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      savings_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      operations_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      INDEX idx_settlements_payment_id (payment_id),
      INDEX idx_settlements_customer_id (customer_id),
      CONSTRAINT fk_settlements_payment FOREIGN KEY (payment_id) REFERENCES \`${MYSQL_TABLES.payments}\` (id) ON DELETE CASCADE,
      CONSTRAINT fk_settlements_customer FOREIGN KEY (customer_id) REFERENCES \`${MYSQL_TABLES.customers}\` (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS \`${MYSQL_TABLES.refunds}\` (
      id CHAR(36) NOT NULL PRIMARY KEY,
      payment_id CHAR(36) NOT NULL,
      customer_id CHAR(36) NOT NULL,
      amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      status VARCHAR(32) NOT NULL,
      requested_by VARCHAR(100) DEFAULT NULL,
      approved_by VARCHAR(100) DEFAULT NULL,
      approved_at DATETIME(3) DEFAULT NULL,
      issued_refund_id CHAR(36) DEFAULT NULL,
      created_by VARCHAR(100) DEFAULT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      INDEX idx_refunds_payment_id (payment_id),
      INDEX idx_refunds_status (status),
      CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES \`${MYSQL_TABLES.payments}\` (id) ON DELETE CASCADE,
      CONSTRAINT fk_refunds_customer FOREIGN KEY (customer_id) REFERENCES \`${MYSQL_TABLES.customers}\` (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS \`${MYSQL_TABLES.ledger}\` (
      id CHAR(36) NOT NULL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      direction VARCHAR(10) NOT NULL,
      account VARCHAR(50) NOT NULL,
      reference_id VARCHAR(100) NOT NULL DEFAULT '',
      note TEXT NOT NULL,
      metadata JSON DEFAULT NULL,
      created_at DATETIME(3) NOT NULL,
      INDEX idx_ledger_reference_id (reference_id),
      INDEX idx_ledger_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS \`${MYSQL_TABLES.finance}\` (
      id TINYINT NOT NULL PRIMARY KEY,
      policy JSON NOT NULL,
      balances JSON NOT NULL,
      last_auto_settlement_date VARCHAR(16) NOT NULL DEFAULT '',
      admin_key VARCHAR(255) DEFAULT NULL,
      approver_key VARCHAR(255) DEFAULT NULL,
      initialized_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Ensure admin_key and approver_key columns exist in finance table (handles updates for existing installs)
  const financeColumns = [
    ['admin_key', 'VARCHAR(255) DEFAULT NULL'],
    ['approver_key', 'VARCHAR(255) DEFAULT NULL']
  ];

  for (const [columnName, columnDefinition] of financeColumns) {
    const [rows] = await mysqlPool.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?`,
      [MYSQL_DATABASE, MYSQL_TABLES.finance, columnName]
    );

    if (Number(rows[0]?.count || 0) === 0) {
      await mysqlPool.query(
        `ALTER TABLE \`${MYSQL_TABLES.finance}\` ADD COLUMN \`${columnName}\` ${columnDefinition}`
      );
    }
  }

  // Backfill admin_key and approver_key from environment variables if they are currently NULL
  await mysqlPool.query(
    `UPDATE \`${MYSQL_TABLES.finance}\`
     SET admin_key = ?
     WHERE id = 1 AND admin_key IS NULL`,
    [ADMIN_KEY]
  );

  await mysqlPool.query(
    `UPDATE \`${MYSQL_TABLES.finance}\`
     SET approver_key = ?
     WHERE id = 1 AND approver_key IS NULL`,
    [APPROVER_KEY || null]
  );
}

async function loadDbFromMysql() {
  const [customerRows] = await mysqlPool.query(`SELECT * FROM \`${MYSQL_TABLES.customers}\``);
  const [paymentRows] = await mysqlPool.query(`SELECT * FROM \`${MYSQL_TABLES.payments}\``);
  const [settlementRows] = await mysqlPool.query(`SELECT * FROM \`${MYSQL_TABLES.settlements}\``);
  const [refundRows] = await mysqlPool.query(`SELECT * FROM \`${MYSQL_TABLES.refunds}\``);
  const [ledgerRows] = await mysqlPool.query(`SELECT * FROM \`${MYSQL_TABLES.ledger}\``);
  const [financeRows] = await mysqlPool.query(`SELECT * FROM \`${MYSQL_TABLES.finance}\` WHERE id = 1 LIMIT 1`);

  return ensureDbSchema({
    customers: customerRows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      email: row.email || '',
      loginCode: row.login_code || '',
      loginToken: row.login_token || '',
      emailOtp: row.email_otp || '',
      otpExpiresAt: row.otp_expires_at instanceof Date ? row.otp_expires_at.toISOString() : (row.otp_expires_at || ''),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
      lastActivityAt: row.last_activity_at instanceof Date ? row.last_activity_at.toISOString() : row.last_activity_at
    })),
    payments: paymentRows.map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      phone: row.phone,
      amount: roundCurrency(row.amount),
      unitType: row.unit_type,
      status: row.status,
      paymentChannel: row.payment_channel,
      checkoutRequestId: row.checkout_request_id || '',
      merchantRequestId: row.merchant_request_id || '',
      mpesaReceipt: row.mpesa_receipt || '',
      mpesaReceiptSubmitted: row.mpesa_receipt_submitted || '',
      tokenCode: row.token_code || '',
      litresBought: Number(row.litres_bought || 0),
      refundedAmount: roundCurrency(row.refunded_amount),
      refundStatus: row.refund_status || 'none',
      failureReason: row.failure_reason || '',
      rejectionReason: row.rejection_reason || '',
      settlementId: row.settlement_id || '',
      sms: mysqlParseJson(row.sms, null),
      approvedAt: row.approved_at instanceof Date ? row.approved_at.toISOString() : row.approved_at || '',
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
    })),
    settlements: settlementRows.map((row) => ({
      id: row.id,
      paymentId: row.payment_id,
      customerId: row.customer_id,
      totalAmount: roundCurrency(row.total_amount),
      savingsAmount: roundCurrency(row.savings_amount),
      operationsAmount: roundCurrency(row.operations_amount),
      status: row.status,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
    })),
    refunds: refundRows.map((row) => ({
      id: row.id,
      paymentId: row.payment_id,
      customerId: row.customer_id,
      amount: roundCurrency(row.amount),
      reason: row.reason,
      status: row.status,
      requestedBy: row.requested_by || '',
      approvedBy: row.approved_by || '',
      approvedAt: row.approved_at instanceof Date ? row.approved_at.toISOString() : row.approved_at || '',
      issuedRefundId: row.issued_refund_id || '',
      createdBy: row.created_by || '',
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
    })),
    ledger: ledgerRows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: roundCurrency(row.amount),
      direction: row.direction,
      account: row.account,
      referenceId: row.reference_id,
      note: row.note,
      metadata: mysqlParseJson(row.metadata, {}),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
    })),
    finance: financeRows.length > 0 ? {
      policy: mysqlParseJson(financeRows[0].policy, defaultFinancePolicy()),
      balances: mysqlParseJson(financeRows[0].balances, { collections: 0, operations: 0, savings: 0 }),
      lastAutoSettlementDate: financeRows[0].last_auto_settlement_date || '',
      adminKey: financeRows[0].admin_key || '',
      approverKey: financeRows[0].approver_key || '',
      initializedAt: financeRows[0].initialized_at instanceof Date ? financeRows[0].initialized_at.toISOString() : financeRows[0].initialized_at,
      updatedAt: financeRows[0].updated_at instanceof Date ? financeRows[0].updated_at.toISOString() : financeRows[0].updated_at
    } : undefined
  });
}

async function persistDbToMysql() {
  if (!mysqlPool || !dbCache) {
    return;
  }

  const db = ensureDbSchema(dbCache);

  await mysqlPool.query('START TRANSACTION');
  try {
    await mysqlPool.query(`DELETE FROM \`${MYSQL_TABLES.ledger}\``);
    await mysqlPool.query(`DELETE FROM \`${MYSQL_TABLES.refunds}\``);
    await mysqlPool.query(`DELETE FROM \`${MYSQL_TABLES.settlements}\``);
    await mysqlPool.query(`DELETE FROM \`${MYSQL_TABLES.payments}\``);
    await mysqlPool.query(`DELETE FROM \`${MYSQL_TABLES.customers}\``);
    await mysqlPool.query(`DELETE FROM \`${MYSQL_TABLES.finance}\``);

    if (db.customers.length > 0) {
      const seenPhones = new Set();
      const uniqueBatch = [];
      for (const customer of db.customers) {
        if (!customer || !customer.phone) continue;
        const validation = validateCustomerPhone(customer.phone);
        const canonical = validation.isValid ? validation.localFormat : normalizePhone(customer.phone);
        customer.phone = canonical;

        if (!seenPhones.has(canonical)) {
          seenPhones.add(canonical);
          uniqueBatch.push(customer);
        }
      }

      if (uniqueBatch.length > 0) {
        await mysqlPool.query(
          `INSERT INTO \`${MYSQL_TABLES.customers}\` (id, full_name, phone, email, login_code, login_token, email_otp, otp_expires_at, created_at, updated_at, last_activity_at)
           VALUES ?
           ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), email = VALUES(email), login_code = VALUES(login_code), login_token = VALUES(login_token), email_otp = VALUES(email_otp), otp_expires_at = VALUES(otp_expires_at), updated_at = VALUES(updated_at), last_activity_at = VALUES(last_activity_at)`,
          [uniqueBatch.map((customer) => [
            customer.id,
            customer.fullName,
            customer.phone,
            customer.email || null,
            customer.loginCode || null,
            customer.loginToken || null,
            customer.emailOtp || null,
            customer.otpExpiresAt ? new Date(customer.otpExpiresAt) : null,
            customer.createdAt ? new Date(customer.createdAt) : new Date(),
            customer.updatedAt ? new Date(customer.updatedAt) : new Date(),
            customer.lastActivityAt ? new Date(customer.lastActivityAt) : new Date()
          ])]
        );
      }
    }

    if (db.payments.length > 0) {
      await mysqlPool.query(
        `INSERT INTO \`${MYSQL_TABLES.payments}\`
         (id, customer_id, phone, amount, unit_type, status, payment_channel, checkout_request_id, merchant_request_id, mpesa_receipt, mpesa_receipt_submitted, token_code, litres_bought, refunded_amount, refund_status, failure_reason, rejection_reason, settlement_id, sms, approved_at, created_at, updated_at)
         VALUES ?`,
        [db.payments.map((payment) => [
          payment.id,
          payment.customerId,
          payment.phone,
          roundCurrency(payment.amount),
          payment.unitType,
          payment.status,
          payment.paymentChannel || 'mpesa_stk',
          payment.checkoutRequestId || null,
          payment.merchantRequestId || null,
          payment.mpesaReceipt || null,
          payment.mpesaReceiptSubmitted || null,
          payment.tokenCode || null,
          Number(payment.litresBought || 0),
          roundCurrency(payment.refundedAmount || 0),
          payment.refundStatus || 'none',
          payment.failureReason || null,
          payment.rejectionReason || null,
          payment.settlementId || null,
          payment.sms ? mysqlJson(payment.sms) : null,
          payment.approvedAt ? new Date(payment.approvedAt) : null,
          payment.createdAt ? new Date(payment.createdAt) : new Date(),
          payment.updatedAt ? new Date(payment.updatedAt) : new Date()
        ])]
      );
    }

    if (db.settlements.length > 0) {
      await mysqlPool.query(
        `INSERT INTO \`${MYSQL_TABLES.settlements}\` (id, payment_id, customer_id, total_amount, savings_amount, operations_amount, status, created_at)
         VALUES ?`,
        [db.settlements.map((settlement) => [
          settlement.id,
          settlement.paymentId,
          settlement.customerId,
          roundCurrency(settlement.totalAmount),
          roundCurrency(settlement.savingsAmount),
          roundCurrency(settlement.operationsAmount),
          settlement.status,
          settlement.createdAt ? new Date(settlement.createdAt) : new Date()
        ])]
      );
    }

    if (db.refunds.length > 0) {
      await mysqlPool.query(
        `INSERT INTO \`${MYSQL_TABLES.refunds}\`
         (id, payment_id, customer_id, amount, reason, status, requested_by, approved_by, approved_at, issued_refund_id, created_by, created_at, updated_at)
         VALUES ?`,
        [db.refunds.map((refund) => [
          refund.id,
          refund.paymentId,
          refund.customerId,
          roundCurrency(refund.amount),
          refund.reason,
          refund.status,
          refund.requestedBy || null,
          refund.approvedBy || null,
          refund.approvedAt ? new Date(refund.approvedAt) : null,
          refund.issuedRefundId || null,
          refund.createdBy || null,
          refund.createdBy || null,
          refund.createdAt ? new Date(refund.createdAt) : new Date(),
          refund.updatedAt ? new Date(refund.updatedAt) : new Date()
        ])]
      );
    }

    if (db.ledger.length > 0) {
      await mysqlPool.query(
        `INSERT INTO \`${MYSQL_TABLES.ledger}\` (id, type, amount, direction, account, reference_id, note, metadata, created_at)
         VALUES ?`,
        [db.ledger.map((entry) => [
          entry.id,
          entry.type,
          roundCurrency(entry.amount),
          entry.direction,
          entry.account,
          entry.referenceId || '',
          entry.note || '',
          entry.metadata ? mysqlJson(entry.metadata) : null,
          entry.createdAt ? new Date(entry.createdAt) : new Date()
        ])]
      );
    }

    if (db.finance) {
      await mysqlPool.query(
        `INSERT INTO \`${MYSQL_TABLES.finance}\` (id, policy, balances, last_auto_settlement_date, admin_key, approver_key, initialized_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE policy = VALUES(policy), balances = VALUES(balances), last_auto_settlement_date = VALUES(last_auto_settlement_date), initialized_at = VALUES(initialized_at), updated_at = VALUES(updated_at)`,
        [
          1,
          mysqlJson(db.finance.policy || defaultFinancePolicy()),
          mysqlJson(db.finance.balances || { collections: 0, operations: 0, savings: 0 }),
          db.finance.lastAutoSettlementDate || '',
          db.finance.adminKey || ADMIN_KEY,
          db.finance.approverKey || APPROVER_KEY,
          db.finance.initializedAt ? new Date(db.finance.initializedAt) : new Date(),
          db.finance.updatedAt ? new Date(db.finance.updatedAt) : new Date()
        ]
      );
    }

    await mysqlPool.query('COMMIT');
  } catch (error) {
    await mysqlPool.query('ROLLBACK');
    throw error;
  }
}

function scheduleDbPersist() {
  if (!mysqlPool || !dbCache) {
    return;
  }

  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistPromise = persistPromise
      .catch(() => { })
      .then(() => persistDbToMysql())
      .catch((error) => {
        console.error(`Failed to persist database to MySQL: ${error.message}`);
      });
  }, 50);
}

async function initializeDatabase() {
  if (dbInitPromise) {
    return dbInitPromise;
  }

  dbInitPromise = (async () => {
    const seedDb = loadSeedDb();

    if (!hasMysqlConfig()) {
      console.warn('MYSQL_* configuration is missing. Falling back to local file storage.');
      dbCache = seedDb;
      return dbCache;
    }

    mysqlPool = createMysqlPool();

    try {
      await ensureMysqlSchema();
      const [customerCountRows] = await mysqlPool.query(`SELECT COUNT(*) AS count FROM \`${MYSQL_TABLES.customers}\``);

      if (Number(customerCountRows[0].count || 0) === 0) {
        dbCache = seedDb;
        await persistDbToMysql();
      } else {
        dbCache = await loadDbFromMysql();
      }

      return dbCache;
    } catch (error) {
      console.warn(`MySQL initialization failed, falling back to local file storage: ${error.message}`);
      mysqlPool = null;
      dbCache = seedDb;
      return dbCache;
    }
  })();

  return dbInitPromise;
}

function readDb() {
  if (!dbCache) {
    dbCache = loadSeedDb();
  }

  return dbCache;
}

function writeDb(data) {
  dbCache = ensureDbSchema(data);
  scheduleDbPersist();
}

function nowIso() {
  return new Date().toISOString();
}

function currentUtcDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function getActor(req, fallback = 'admin') {
  const actor = String(req.get('x-admin-actor') || req.body?.actor || '').trim();
  return actor || fallback;
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function asPositiveNumber(value) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return roundCurrency(parsed);
}

function defaultFinancePolicy() {
  return {
    savingsPercent: SETTLEMENT_SAVINGS_PERCENT,
    operationsPercent: SETTLEMENT_OPERATIONS_PERCENT,
    minOperationsFloat: MIN_OPERATIONS_FLOAT,
    settlementMode: 'per_payment'
  };
}

function createLedgerEntry({ type, amount, direction, account, referenceId, note, metadata }) {
  return {
    id: crypto.randomUUID(),
    type,
    amount: roundCurrency(amount),
    direction,
    account,
    referenceId: referenceId || '',
    note: note || '',
    metadata: metadata || {},
    createdAt: nowIso()
  };
}

function ensureDbSchema(db) {
  if (!Array.isArray(db.customers)) {
    db.customers = [];
  } else {
    const uniqueCustomers = [];
    const phoneToPrimaryId = new Map();
    const oldIdToPrimaryId = new Map();

    for (const c of db.customers) {
      if (!c || !c.phone) continue;
      const validation = validateCustomerPhone(c.phone);
      const canonicalPhone = validation.isValid ? validation.localFormat : normalizePhone(c.phone);
      c.phone = canonicalPhone;

      if (!phoneToPrimaryId.has(canonicalPhone)) {
        phoneToPrimaryId.set(canonicalPhone, c.id);
        uniqueCustomers.push(c);
      } else {
        const primaryId = phoneToPrimaryId.get(canonicalPhone);
        oldIdToPrimaryId.set(c.id, primaryId);
        const primaryCust = uniqueCustomers.find((u) => u.id === primaryId);
        if (primaryCust) {
          if (c.fullName && !primaryCust.fullName) primaryCust.fullName = c.fullName;
          if (c.loginCode && !primaryCust.loginCode) primaryCust.loginCode = c.loginCode;
          if (c.loginToken && !primaryCust.loginToken) primaryCust.loginToken = c.loginToken;
        }
      }
    }

    db.customers = uniqueCustomers;

    if (oldIdToPrimaryId.size > 0) {
      if (Array.isArray(db.payments)) {
        for (const p of db.payments) {
          if (oldIdToPrimaryId.has(p.customerId)) p.customerId = oldIdToPrimaryId.get(p.customerId);
        }
      }
      if (Array.isArray(db.refunds)) {
        for (const r of db.refunds) {
          if (oldIdToPrimaryId.has(r.customerId)) r.customerId = oldIdToPrimaryId.get(r.customerId);
        }
      }
      if (Array.isArray(db.settlements)) {
        for (const s of db.settlements) {
          if (oldIdToPrimaryId.has(s.customerId)) s.customerId = oldIdToPrimaryId.get(s.customerId);
        }
      }
    }
  }

  if (!Array.isArray(db.payments)) {
    db.payments = [];
  }
  if (!Array.isArray(db.settlements)) {
    db.settlements = [];
  }
  if (!Array.isArray(db.refunds)) {
    db.refunds = [];
  }
  if (!Array.isArray(db.ledger)) {
    db.ledger = [];
  }

  if (!db.finance) {
    const paidTotal = roundCurrency(
      db.payments
        .filter((payment) => payment.status === 'paid')
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    );

    db.finance = {
      policy: defaultFinancePolicy(),
      balances: {
        collections: paidTotal,
        operations: 0,
        savings: 0
      },
      initializedAt: nowIso(),
      updatedAt: nowIso()
    };

    if (paidTotal > 0) {
      db.ledger.push(
        createLedgerEntry({
          type: 'opening_balance',
          amount: paidTotal,
          direction: 'in',
          account: 'collections',
          referenceId: 'migration',
          note: 'Backfilled opening collections balance from existing paid payments'
        })
      );
    }
  }

  if (!db.finance.policy) {
    db.finance.policy = defaultFinancePolicy();
  }

  if (!db.finance.adminKey) {
    db.finance.adminKey = ADMIN_KEY;
  }

  if (!db.finance.approverKey) {
    db.finance.approverKey = APPROVER_KEY;
  }

  if (!db.finance.lastAutoSettlementDate) {
    db.finance.lastAutoSettlementDate = '';
  }

  if (!db.finance.balances) {
    db.finance.balances = { collections: 0, operations: 0, savings: 0 };
  }

  db.finance.balances.collections = roundCurrency(db.finance.balances.collections || 0);
  db.finance.balances.operations = roundCurrency(db.finance.balances.operations || 0);
  db.finance.balances.savings = roundCurrency(db.finance.balances.savings || 0);

  for (const payment of db.payments) {
    if (typeof payment.refundedAmount !== 'number') {
      payment.refundedAmount = 0;
    }
    if (typeof payment.updatedAt !== 'string') {
      payment.updatedAt = payment.createdAt || nowIso();
    }
    if (typeof payment.customerLoginToken !== 'string') {
      payment.customerLoginToken = '';
    }
  }

  for (const customer of db.customers) {
    if (typeof customer.loginCode !== 'string') {
      customer.loginCode = '';
    }
    if (typeof customer.loginToken !== 'string') {
      customer.loginToken = '';
    }
    if (typeof customer.updatedAt !== 'string') {
      customer.updatedAt = customer.createdAt || nowIso();
    }
  }

  return db;
}

function applySettlementForPayment(db, paymentRecord) {
  if (paymentRecord.status !== 'paid') {
    return null;
  }

  if (paymentRecord.settlementId) {
    return db.settlements.find((entry) => entry.id === paymentRecord.settlementId) || null;
  }

  const amount = roundCurrency(paymentRecord.amount);
  if (amount <= 0) {
    return null;
  }

  const savingsShare = roundCurrency(
    amount * (Number(db.finance.policy.savingsPercent || SETTLEMENT_SAVINGS_PERCENT) / 100)
  );
  const operationsShare = roundCurrency(amount - savingsShare);

  db.finance.balances.collections = roundCurrency(db.finance.balances.collections + amount);
  db.ledger.push(
    createLedgerEntry({
      type: 'payment_confirmed',
      amount,
      direction: 'in',
      account: 'collections',
      referenceId: paymentRecord.id,
      note: 'Confirmed customer payment moved into collections',
      metadata: { customerId: paymentRecord.customerId }
    })
  );

  db.finance.balances.collections = roundCurrency(db.finance.balances.collections - amount);
  db.finance.balances.savings = roundCurrency(db.finance.balances.savings + savingsShare);
  db.finance.balances.operations = roundCurrency(db.finance.balances.operations + operationsShare);

  if (savingsShare > 0) {
    db.ledger.push(
      createLedgerEntry({
        type: 'settlement_transfer',
        amount: savingsShare,
        direction: 'out',
        account: 'collections',
        referenceId: paymentRecord.id,
        note: 'Auto settlement to savings bucket',
        metadata: { toAccount: 'savings' }
      })
    );
  }

  if (operationsShare > 0) {
    db.ledger.push(
      createLedgerEntry({
        type: 'settlement_transfer',
        amount: operationsShare,
        direction: 'out',
        account: 'collections',
        referenceId: paymentRecord.id,
        note: 'Auto settlement to operations bucket',
        metadata: { toAccount: 'operations' }
      })
    );
  }

  const settlement = {
    id: crypto.randomUUID(),
    paymentId: paymentRecord.id,
    customerId: paymentRecord.customerId,
    totalAmount: amount,
    savingsAmount: savingsShare,
    operationsAmount: operationsShare,
    status: 'settled',
    createdAt: nowIso()
  };

  db.settlements.push(settlement);
  paymentRecord.settlementId = settlement.id;
  db.finance.updatedAt = nowIso();

  return settlement;
}

function settleUnsettledPayments(db) {
  const unsettled = db.payments.filter(
    (payment) => payment.status === 'paid' && !payment.settlementId
  );

  const applied = [];
  for (const payment of unsettled) {
    const settlement = applySettlementForPayment(db, payment);
    if (settlement) {
      applied.push(settlement);
    }
  }

  return applied;
}

function issueRefund(db, { paymentRecord, amount, reason, createdBy }) {
  const refundAmount = roundCurrency(amount);
  const alreadyRefunded = roundCurrency(paymentRecord.refundedAmount || 0);
  const maxRefundable = roundCurrency(paymentRecord.amount - alreadyRefunded);

  if (refundAmount <= 0) {
    throw new Error('Refund amount must be greater than 0');
  }
  if (refundAmount > maxRefundable) {
    throw new Error('Refund amount exceeds refundable balance for this payment');
  }
  if (refundAmount > db.finance.balances.operations) {
    throw new Error('Insufficient operations balance. Top up operations first.');
  }

  db.finance.balances.operations = roundCurrency(db.finance.balances.operations - refundAmount);
  db.finance.updatedAt = nowIso();

  const refund = {
    id: crypto.randomUUID(),
    paymentId: paymentRecord.id,
    customerId: paymentRecord.customerId,
    amount: refundAmount,
    reason: reason || 'Customer refund',
    status: 'issued',
    createdBy: createdBy || 'admin',
    createdAt: nowIso()
  };

  paymentRecord.refundedAmount = roundCurrency(alreadyRefunded + refundAmount);
  paymentRecord.refundStatus = paymentRecord.refundedAmount >= paymentRecord.amount
    ? 'full'
    : 'partial';
  paymentRecord.updatedAt = nowIso();

  db.refunds.push(refund);
  db.ledger.push(
    createLedgerEntry({
      type: 'refund_issued',
      amount: refundAmount,
      direction: 'out',
      account: 'operations',
      referenceId: paymentRecord.id,
      note: refund.reason,
      metadata: { refundId: refund.id }
    })
  );

  return refund;
}

function approveRefundRequest(db, { refundRequest, approver }) {
  if (refundRequest.status !== 'pending_approval') {
    throw new Error('Only pending refund requests can be approved');
  }

  const paymentRecord = db.payments.find((payment) => payment.id === refundRequest.paymentId);
  if (!paymentRecord) {
    throw new Error('Payment not found for refund request');
  }

  if (paymentRecord.status !== 'paid') {
    throw new Error('Only paid transactions can be refunded');
  }

  if (refundRequest.requestedBy && approver === refundRequest.requestedBy) {
    throw new Error('Maker-checker rule violated: approver must differ from requester');
  }

  const issued = issueRefund(db, {
    paymentRecord,
    amount: refundRequest.amount,
    reason: refundRequest.reason,
    createdBy: approver
  });

  refundRequest.status = 'approved';
  refundRequest.approvedBy = approver;
  refundRequest.approvedAt = nowIso();
  refundRequest.issuedRefundId = issued.id;

  return issued;
}

function runAutoSettlementSweep() {
  if (!AUTO_SETTLEMENT_ENABLED) {
    return;
  }

  const now = new Date();
  if (now.getUTCHours() !== AUTO_SETTLEMENT_HOUR_UTC) {
    return;
  }

  const db = readDb();
  const todayStamp = currentUtcDateStamp();
  if (db.finance.lastAutoSettlementDate === todayStamp) {
    return;
  }

  const applied = settleUnsettledPayments(db);
  db.finance.lastAutoSettlementDate = todayStamp;

  db.ledger.push(
    createLedgerEntry({
      type: 'auto_settlement_sweep',
      amount: 0,
      direction: 'in',
      account: 'collections',
      referenceId: todayStamp,
      note: `Auto sweep applied settlement to ${applied.length} payment(s).`,
      metadata: { appliedCount: applied.length, hourUtc: AUTO_SETTLEMENT_HOUR_UTC }
    })
  );

  writeDb(db);
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[\s\-\(\)\.]/g, '');
}

function validateCustomerPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { isValid: false, error: 'Phone number is required.' };
  }

  const cleaned = rawPhone.trim().replace(/[\s\-\(\)\.]/g, '');

  if (!/^\+?\d+$/.test(cleaned)) {
    return { isValid: false, error: 'Phone number must only contain numbers (e.g. 07XXXXXXXX or 01XXXXXXXX).' };
  }

  const digits = cleaned.replace(/^\+/, '');

  let core = '';
  if (digits.startsWith('254') && digits.length === 12) {
    core = digits.slice(3);
  } else if (digits.startsWith('0') && digits.length === 10) {
    core = digits.slice(1);
  } else if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('1'))) {
    core = digits;
  } else {
    return {
      isValid: false,
      error: 'Invalid phone number length or prefix. Enter a valid 10-digit Kenyan mobile number (e.g. 07XXXXXXXX or 01XXXXXXXX).'
    };
  }

  // Ensure prefix starts with 7 or 1 (Safaricom / Airtel / Telkom / Faiba)
  if (!/^[17]\d{8}$/.test(core)) {
    return {
      isValid: false,
      error: 'Invalid mobile prefix. Kenyan mobile numbers must begin with 07 or 01.'
    };
  }

  // Anti-dummy checks:
  // 1. All identical repeated digits (e.g. 0000000000, 0777777777, 0700000000)
  const fullLocal = `0${core}`;
  if (/^(\d)\1+$/.test(fullLocal) || /^(\d)\1+$/.test(core)) {
    return {
      isValid: false,
      error: 'Invalid phone number. Repeated dummy numbers (such as 0000000000) are not permitted.'
    };
  }

  // 2. Insufficient unique digits (e.g. 0700000000, 0711111111, 0100000000)
  const uniqueDigits = new Set(core.split(''));
  if (uniqueDigits.size < 3) {
    return {
      isValid: false,
      error: 'Invalid phone number. Please enter a genuine active mobile phone number.'
    };
  }

  // 3. Obvious dummy sequences
  const dummySequences = ['123456789', '987654321', '012345678', '712345678', '798765432', '700000000', '100000000'];
  if (dummySequences.includes(core)) {
    return {
      isValid: false,
      error: 'Invalid phone number. Dummy or sequential test numbers are not permitted.'
    };
  }

  return {
    isValid: true,
    localFormat: `0${core}`,
    intlFormat: `254${core}`,
    coreDigits: core
  };
}

function normalizeKenyanPhone(phone) {
  const validation = validateCustomerPhone(phone);
  if (validation.isValid) {
    return validation.intlFormat;
  }
  const cleaned = normalizePhone(phone).replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+254')) return cleaned.slice(1);
  if (cleaned.startsWith('254')) return cleaned;
  if (cleaned.startsWith('0')) return `254${cleaned.slice(1)}`;
  return cleaned;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateCustomerEmail(rawEmail, isRequired = false) {
  if (!rawEmail || typeof rawEmail !== 'string') {
    if (isRequired) return { isValid: false, error: 'Email address is required.' };
    return { isValid: true, normalizedEmail: '' };
  }
  const cleaned = normalizeEmail(rawEmail);
  if (!cleaned) {
    if (isRequired) return { isValid: false, error: 'Email address is required.' };
    return { isValid: true, normalizedEmail: '' };
  }
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(cleaned)) {
    return { isValid: false, error: 'Please enter a valid email address (e.g. name@gmail.com).' };
  }
  return { isValid: true, normalizedEmail: cleaned };
}

function getEmailTransporter() {
  const user = (process.env.EMAIL_USER || '').trim();
  const pass = (process.env.EMAIL_APP_PASSWORD || '').replace(/[\s"']/g, '');

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user,
      pass
    }
  });
}

async function sendCustomerEmailOtp(email, customerName, otpCode, type = 'login') {
  const isRegistration = type === 'register';
  const subject = isRegistration 
    ? `Welcome to Aqualine - Your Account Verification Code: ${otpCode}`
    : `Aqualine Water Login Code: ${otpCode}`;

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #1e293b;">
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; border-radius: 12px; background: linear-gradient(135deg, #0284c7, #0369a1); color: #ffffff; font-size: 22px;">
          💧
        </div>
        <h2 style="margin: 10px 0 2px; color: #0f172a; font-size: 19px; font-weight: 800;">Aqualine Water Billing</h2>
        <p style="margin: 0; color: #64748b; font-size: 12px;">Customer Verification & Token Gateway</p>
      </div>

      <div style="background-color: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #e2e8f0;">
        <p style="margin: 0 0 10px; font-size: 14px; color: #334155;">Hello <b>${customerName || 'Customer'}</b>,</p>
        <p style="margin: 0 0 16px; font-size: 13px; color: #475569; line-height: 1.5;">
          ${isRegistration ? 'Your registration is complete! Use the one-time code below to verify your email and access your account:' : 'Here is your one-time verification code (OTP) to securely log in to your Aqualine account:'}
        </p>

        <div style="text-align: center; margin: 20px 0;">
          <span style="display: inline-block; font-size: 30px; font-weight: 900; letter-spacing: 6px; color: #0284c7; background: #e0f2fe; padding: 10px 24px; border-radius: 12px; border: 2px dashed #38bdf8; font-family: monospace;">
            ${otpCode}
          </span>
        </div>

        <p style="margin: 0; font-size: 12px; color: #64748b; text-align: center;">
          ⏱ This code will expire in <b>10 minutes</b>.
        </p>
      </div>

      <p style="margin: 0 0 12px; font-size: 11px; color: #94a3b8; line-height: 1.4;">
        If you did not request this OTP code, please ignore this email or contact <a href="mailto:aqualinesupport@gmail.com" style="color: #0284c7;">aqualinesupport@gmail.com</a>.
      </p>

      <div style="border-top: 1px solid #f1f5f9; padding-top: 12px; font-size: 11px; color: #94a3b8; text-align: center;">
        © 2026 Aqualine Water Billing Company. Nairobi, Kenya.
      </div>
    </div>
  `;

  const transporter = getEmailTransporter();
  if (!transporter || !EMAIL_ENABLED) {
    console.log('\n============================================================');
    console.log(`📧 [AQUALINE GMAIL OTP] Verification Code: ${otpCode}`);
    console.log(`👤 Recipient Email: ${email}`);
    console.log(`⏱  Validity: 10 minutes (Type: ${type})`);
    console.log('💡 Note: Set EMAIL_USER & EMAIL_APP_PASSWORD in .env for live inbox delivery.');
    console.log('============================================================\n');
    return {
      success: true,
      mode: 'simulated',
      email,
      otpCode,
      message: `Simulated OTP dispatched to ${email}. Verification code is: ${otpCode}`
    };
  }

  try {
    const info = await transporter.sendMail({
      from: EMAIL_FROM,
      to: email,
      subject,
      html: htmlContent
    });

    console.log(`[Live Gmail Sent] MessageId: ${info.messageId} to ${email}`);
    return {
      success: true,
      mode: 'live',
      email,
      messageId: info.messageId,
      message: `OTP email successfully sent to ${email}`
    };
  } catch (error) {
    console.error(`[Gmail Send Error] Failed to send email to ${email}:`, error.message);
    return {
      success: false,
      mode: 'live',
      email,
      error: error.message
    };
  }
}

async function sendWaterTokenEmail(email, customerName, tokenCode, litresBought, amount, receipt) {
  if (!email) return null;

  const subject = `Aqualine Water Token: ${tokenCode} (${litresBought} Litres)`;
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #1e293b;">
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; border-radius: 12px; background: linear-gradient(135deg, #0284c7, #0369a1); color: #ffffff; font-size: 22px;">
          💧
        </div>
        <h2 style="margin: 10px 0 2px; color: #0f172a; font-size: 19px; font-weight: 800;">Payment & Water Token Receipt</h2>
        <p style="margin: 0; color: #64748b; font-size: 12px;">Aqualine Automated Dispenser PIN</p>
      </div>

      <div style="background-color: #f0fdf4; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #bbf7d0;">
        <p style="margin: 0 0 10px; font-size: 14px; color: #166534;">Payment Successful! Thank you <b>${customerName || 'Customer'}</b>.</p>
        
        <div style="text-align: center; margin: 18px 0;">
          <div style="font-size: 12px; color: #15803d; font-weight: 700; text-transform: uppercase;">Your Dispenser Token PIN</div>
          <span style="display: inline-block; font-size: 32px; font-weight: 900; letter-spacing: 5px; color: #047857; background: #ffffff; padding: 10px 24px; border-radius: 12px; border: 2px solid #86efac; font-family: monospace; margin-top: 6px;">
            ${tokenCode}
          </span>
        </div>

        <table style="width: 100%; font-size: 12px; border-collapse: collapse; margin-top: 14px;">
          <tr><td style="padding: 4px 0; color: #4b5563;">Water Amount:</td><td style="padding: 4px 0; font-weight: bold; text-align: right; color: #111827;">${litresBought} Litres</td></tr>
          <tr><td style="padding: 4px 0; color: #4b5563;">Amount Paid:</td><td style="padding: 4px 0; font-weight: bold; text-align: right; color: #111827;">KES ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>
          <tr><td style="padding: 4px 0; color: #4b5563;">M-Pesa Receipt:</td><td style="padding: 4px 0; font-weight: bold; text-align: right; font-family: monospace; color: #111827;">${receipt || '-'}</td></tr>
        </table>
      </div>

      <p style="margin: 0; font-size: 12px; color: #64748b; line-height: 1.4; text-align: center;">
        Type your 8-digit token PIN on any Aqualine water dispenser keypad and press <b>#</b> to release water.
      </p>
    </div>
  `;

  const transporter = getEmailTransporter();
  if (!transporter || !EMAIL_ENABLED) {
    console.log(`[Simulated Token Email] To: ${email} | Token: ${tokenCode}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: email,
      subject,
      html: htmlContent
    });
    console.log(`[Token Email Sent] To: ${email}`);
  } catch (err) {
    console.warn(`[Token Email Failed] To: ${email}:`, err.message);
  }
}

function normalizeFullName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function validateCustomerFullName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return { isValid: false, error: 'Full name is required.' };
  }
  const cleaned = normalizeFullName(fullName);
  if (cleaned.length < 3) {
    return { isValid: false, error: 'Full name must be at least 3 characters long.' };
  }
  if (!/[a-zA-Z]/.test(cleaned)) {
    return { isValid: false, error: 'Full name must contain alphabetical characters.' };
  }
  return { isValid: true, normalizedName: cleaned };
}

function fullNamesMatch(storedName, providedName) {
  return (
    normalizeFullName(storedName).toLowerCase() === normalizeFullName(providedName).toLowerCase()
  );
}

function generateCustomerToken() {
  return crypto.randomUUID();
}

function findCustomerByLoginToken(db, token) {
  return db.customers.find((customer) => customer.loginToken === token);
}

function mpesaBaseUrl() {
  return MPESA_ENV === 'live' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
}

function generateTokenCode() {
  return crypto.randomInt(100000000, 999999999).toString();
}

function hasMpesaConfig() {
  return Boolean(
    MPESA_CONSUMER_KEY &&
    MPESA_CONSUMER_SECRET &&
    MPESA_SHORTCODE &&
    MPESA_PASSKEY &&
    MPESA_CALLBACK_URL
  );
}

function hasSmsConfig() {
  if (SMS_PROVIDER !== 'africastalking') {
    return false;
  }
  return Boolean(SMS_API_KEY && SMS_USERNAME);
}

async function getMpesaAccessToken() {
  const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
  const response = await fetch(`${mpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`
    }
  });

  const responseText = await response.text();
  let data = null;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    throw new Error(`Failed to get MPESA access token: ${responseText || 'Invalid response format'}`);
  }

  if (!response.ok || !data?.access_token) {
    throw new Error(`Failed to get MPESA access token: ${data?.errorMessage || 'Invalid credentials'}`);
  }

  return data.access_token;
}

async function processMpesaPayment(phone, amount) {
  if (!MPESA_ENABLED || !hasMpesaConfig()) {
    return {
      success: true,
      mode: 'simulated',
      pending: false,
      mpesaReceipt: `MP${Date.now()}`,
      phone,
      amount
    };
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');
  const accessToken = await getMpesaAccessToken();
  const normalizedPhone = normalizeKenyanPhone(phone);

  const stkPayload = {
    BusinessShortCode: MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: normalizedPhone,
    PartyB: MPESA_SHORTCODE,
    PhoneNumber: normalizedPhone,
    CallBackURL: MPESA_CALLBACK_URL,
    AccountReference: `AQUALINE-${Date.now()}`,
    TransactionDesc: 'Aqualine Water Tokens'
  };

  const response = await fetch(`${mpesaBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(stkPayload)
  });

  const responseText = await response.text();
  let data = null;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    return {
      success: false,
      mode: 'live',
      pending: false,
      error: responseText || 'MPESA STK push failed (invalid response format)'
    };
  }

  if (!response.ok) {
    return {
      success: false,
      mode: 'live',
      pending: false,
      error: data?.errorMessage || responseText || 'MPESA STK push failed'
    };
  }

  if (data.ResponseCode !== '0') {
    return {
      success: false,
      mode: 'live',
      pending: false,
      error: data.ResponseDescription || 'MPESA request rejected'
    };
  }

  return {
    success: true,
    mode: 'live',
    pending: true,
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID,
    customerMessage: data.CustomerMessage || 'Complete payment on your phone.'
  };
}

async function sendTokenSms(phone, message) {
  if (!SMS_ENABLED || !hasSmsConfig()) {
    return {
      success: true,
      mode: 'simulated',
      phone,
      message,
      provider: 'simulated-sms'
    };
  }

  if (SMS_PROVIDER !== 'africastalking') {
    return {
      success: false,
      mode: 'live',
      provider: SMS_PROVIDER,
      error: 'Unsupported SMS provider'
    };
  }

  const form = new URLSearchParams();
  const e164Phone = '+' + normalizeKenyanPhone(phone);
  form.set('username', SMS_USERNAME);
  form.set('to', e164Phone);
  form.set('message', message);
  if (SMS_SENDER_ID) {
    form.set('from', SMS_SENDER_ID);
  }

  const atBaseUrl = SMS_USERNAME === 'sandbox' 
    ? 'https://api.sandbox.africastalking.com/version1/messaging' 
    : 'https://api.africastalking.com/version1/messaging';

  const response = await fetch(atBaseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      apiKey: SMS_API_KEY
    },
    body: form.toString()
  });

  const responseText = await response.text();
  let data = null;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    return {
      success: false,
      mode: 'live',
      provider: SMS_PROVIDER,
      error: responseText || 'SMS sending failed (invalid response format)'
    };
  }

  if (!response.ok) {
    return {
      success: false,
      mode: 'live',
      provider: SMS_PROVIDER,
      error: data?.SMSMessageData?.Message || responseText || 'SMS sending failed'
    };
  }

  return {
    success: true,
    mode: 'live',
    provider: SMS_PROVIDER,
    response: data
  };
}

function getStkMetadataValue(metadataItems, name) {
  const item = metadataItems.find((entry) => entry.Name === name);
  return item?.Value;
}

async function finalizeSuccessfulPayment(db, paymentRecord, mpesaReceipt) {
  const wasAlreadyPaid = paymentRecord.status === 'paid';

  paymentRecord.status = 'paid';
  paymentRecord.mpesaReceipt = mpesaReceipt || paymentRecord.mpesaReceipt || `MP${Date.now()}`;
  paymentRecord.litresBought = calculateLitres(paymentRecord.amount, paymentRecord.unitType);
  delete paymentRecord.unitsBought;
  paymentRecord.tokenCode = paymentRecord.tokenCode || generateTokenCode();
  paymentRecord.updatedAt = nowIso();

  const customer = db.customers.find((entry) => entry.id === paymentRecord.customerId);
  if (customer) {
    customer.lastActivityAt = nowIso();
    customer.updatedAt = nowIso();
  }

  const smsText = `Aqualine: Payment confirmed. Token ${paymentRecord.tokenCode}. Water bought: ${paymentRecord.litresBought} litres.`;
  paymentRecord.sms = await sendTokenSms(paymentRecord.phone, smsText);

  // Settlement must run once per payment record to avoid duplicate accounting entries.
  if (!wasAlreadyPaid) {
    applySettlementForPayment(db, paymentRecord);
  }
}

function calculateLitres(amount, unitType) {
  if (unitType === '1000_litre') {
    const bundles = Math.floor(amount / PRICING.per1000Litre);
    return bundles * 1000;
  }

  return Math.floor(amount / PRICING.perLitre);
}

function findCustomerByPhone(db, phone) {
  if (!phone) return null;
  const validation = validateCustomerPhone(phone);
  if (validation.isValid) {
    const local = validation.localFormat;
    const intl = validation.intlFormat;
    return db.customers.find((c) => {
      const cVal = validateCustomerPhone(c.phone);
      if (cVal.isValid) {
        return cVal.localFormat === local || cVal.intlFormat === intl;
      }
      return c.phone === phone || c.phone === local || c.phone === intl;
    });
  }
  const norm = normalizePhone(phone);
  return db.customers.find((c) => normalizePhone(c.phone) === norm);
}

function findCustomerByEmail(db, email) {
  if (!email) return null;
  const norm = normalizeEmail(email);
  return db.customers.find((c) => normalizeEmail(c.email) === norm);
}

function findCustomerByPhoneOrEmail(db, identifier) {
  if (!identifier) return null;
  const norm = String(identifier).trim();
  if (norm.includes('@')) {
    return findCustomerByEmail(db, norm);
  }
  return findCustomerByPhone(db, norm);
}

app.get('/customer.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer.html'));
});

// Send Email OTP Code
app.post('/api/customer/auth/send-otp', async (req, res) => {
  const { identifier, email, phone } = req.body || {};
  const target = identifier || email || phone;

  if (!target) {
    return res.status(400).json({ error: 'Please provide your registered Email address or Phone number.' });
  }

  const db = readDb();
  const customer = findCustomerByPhoneOrEmail(db, target);

  if (!customer) {
    return res.status(404).json({ error: 'No customer account found with that email/phone. Please register first.' });
  }

  if (!customer.email) {
    return res.status(400).json({ error: 'This account does not have an email registered. Please use name and phone login or update your email.' });
  }

  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  customer.emailOtp = otpCode;
  customer.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  customer.updatedAt = nowIso();
  writeDb(db);

  const emailResult = await sendCustomerEmailOtp(customer.email, customer.fullName, otpCode, 'login');

  return res.json({
    ok: true,
    message: emailResult.success
      ? `Verification code sent to ${customer.email}`
      : `Email delivery encountered an issue (${emailResult.error}). Use the code on screen to proceed.`,
    email: customer.email,
    mode: emailResult.mode,
    devOtp: (!emailResult.success || emailResult.mode === 'simulated') ? otpCode : undefined
  });
});

// Verify Email OTP Code & Login
app.post('/api/customer/auth/verify-otp', (req, res) => {
  const { identifier, email, phone, otp } = req.body || {};
  const target = identifier || email || phone;
  const providedOtp = String(otp || '').trim();

  if (!target || !providedOtp) {
    return res.status(400).json({ error: 'Email/Phone and 6-digit OTP code are required.' });
  }

  const db = readDb();
  const customer = findCustomerByPhoneOrEmail(db, target);

  if (!customer) {
    return res.status(404).json({ error: 'Customer account not found.' });
  }

  if (!customer.emailOtp || !customer.otpExpiresAt) {
    return res.status(400).json({ error: 'No active OTP found. Please request a new code.' });
  }

  if (new Date(customer.otpExpiresAt).getTime() < Date.now()) {
    return res.status(400).json({ error: 'The OTP code has expired. Please request a new code.' });
  }

  if (customer.emailOtp !== providedOtp && providedOtp !== customer.loginCode) {
    return res.status(401).json({ error: 'Invalid verification code. Please check your email and try again.' });
  }

  customer.emailOtp = null;
  customer.otpExpiresAt = null;
  customer.loginToken = generateCustomerToken();
  customer.lastActivityAt = nowIso();
  customer.updatedAt = nowIso();
  writeDb(db);

  return res.json({
    message: 'Login successful via Gmail OTP',
    customer: {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone,
      email: customer.email || '',
      loginToken: customer.loginToken
    },
    token: customer.loginToken
  });
});

app.post('/api/customer/login', (req, res) => {
  const { fullName, phone, email, otp } = req.body || {};

  // If OTP is provided, route to OTP verification
  if (otp && (email || phone)) {
    const db = readDb();
    const customer = findCustomerByPhoneOrEmail(db, email || phone);
    if (!customer) {
      return res.status(404).json({ error: 'Customer account not found.' });
    }
    if ((customer.emailOtp === String(otp).trim() || customer.loginCode === String(otp).trim()) &&
        (!customer.otpExpiresAt || new Date(customer.otpExpiresAt).getTime() >= Date.now())) {
      customer.emailOtp = null;
      customer.otpExpiresAt = null;
      customer.loginToken = generateCustomerToken();
      customer.lastActivityAt = nowIso();
      customer.updatedAt = nowIso();
      writeDb(db);
      return res.json({
        message: 'Customer login successful via OTP code',
        customer: {
          id: customer.id,
          fullName: customer.fullName,
          phone: customer.phone,
          email: customer.email || '',
          loginToken: customer.loginToken
        }
      });
    }
  }

  const nameValidation = validateCustomerFullName(fullName);
  if (!nameValidation.isValid) {
    return res.status(400).json({ error: nameValidation.error });
  }

  const phoneValidation = validateCustomerPhone(phone);
  if (!phoneValidation.isValid) {
    return res.status(400).json({ error: phoneValidation.error });
  }

  const validFullName = nameValidation.normalizedName;
  const canonicalPhone = phoneValidation.localFormat;

  const db = readDb();
  const customer = findCustomerByPhone(db, canonicalPhone);
  if (!customer || !fullNamesMatch(customer.fullName, fullName)) {
    return res.status(401).json({ error: 'Invalid name or phone number. Please check your details or register first.' });
  }

  customer.loginToken = generateCustomerToken();
  customer.lastActivityAt = nowIso();
  customer.updatedAt = nowIso();
  writeDb(db);

  return res.json({
    message: 'Customer login successful',
    customer: {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone,
      email: customer.email || '',
      loginToken: customer.loginToken
    }
  });
});

app.get('/api/customer/me', requireCustomer, (req, res) => {
  const db = readDb();
  const customer = db.customers.find((entry) => entry.id === req.customer.id);

  const customerPayments = db.payments
    .filter((payment) => payment.customerId === customer.id)
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({
    customer: {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone,
      email: customer.email || '',
      createdAt: customer.createdAt,
      lastActivityAt: customer.lastActivityAt
    },
    payments: customerPayments
  });
});

async function generateCustomerStatementPdfBuffer(customer, payments, refunds = []) {
  const tempDir = path.join(__dirname, 'data', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const fileId = crypto.randomUUID();
  const jsonPath = path.join(tempDir, `stmt_${fileId}.json`);
  const pdfPath = path.join(tempDir, `stmt_${fileId}.pdf`);

  const payload = {
    customer,
    payments,
    refunds
  };

  fs.writeFileSync(jsonPath, JSON.stringify(payload), 'utf-8');

  try {
    const scriptPath = path.join(__dirname, 'customer_statement_pdf.py');
    await execFilePromise('python3', [scriptPath, jsonPath, pdfPath]);

    const pdfBuffer = fs.readFileSync(pdfPath);
    return pdfBuffer;
  } finally {
    try { if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath); } catch {}
    try { if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch {}
  }
}

app.get('/api/customer/statement/pdf', requireCustomer, async (req, res) => {
  try {
    const db = readDb();
    const customer = db.customers.find((entry) => entry.id === req.customer.id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const payments = db.payments
      .filter((p) => p.customerId === customer.id)
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const refunds = (db.refunds || []).filter((r) => r.customerId === customer.id);

    const pdfBuffer = await generateCustomerStatementPdfBuffer(customer, payments, refunds);

    const safePhone = (customer.phone || 'customer').replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Aqualine-Statement-${safePhone}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Failed to generate customer statement PDF:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate PDF statement' });
  }
});

app.get('/api/admin/customers/:customerId/statement/pdf', requireAdmin, async (req, res) => {
  try {
    const { customerId } = req.params;
    const db = readDb();
    const customer = db.customers.find((entry) => entry.id === customerId);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const payments = db.payments
      .filter((p) => p.customerId === customer.id)
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const refunds = (db.refunds || []).filter((r) => r.customerId === customer.id);

    const pdfBuffer = await generateCustomerStatementPdfBuffer(customer, payments, refunds);

    const safePhone = (customer.phone || 'customer').replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Aqualine-Statement-${safePhone}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Failed to generate admin customer statement PDF:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate PDF statement' });
  }
});

app.post('/api/customer/refunds', requireCustomer, (req, res) => {
  const { paymentId, reason } = req.body;
  const refundReason = String(reason || 'Customer requested refund via portal').trim();

  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId is required' });
  }

  const db = readDb();
  const paymentRecord = db.payments.find((p) => p.id === paymentId);

  if (!paymentRecord) {
    return res.status(404).json({ error: 'Payment not found' });
  }

  if (paymentRecord.customerId !== req.customer.id) {
    return res.status(403).json({ error: 'You are not authorized to request a refund for this payment' });
  }

  if (paymentRecord.status !== 'paid') {
    return res.status(400).json({ error: 'Refunds can only be requested for completed (paid) payments' });
  }

  const alreadyRefunded = roundCurrency(paymentRecord.refundedAmount || 0);
  const maxRefundable = roundCurrency(paymentRecord.amount - alreadyRefunded);

  if (maxRefundable <= 0) {
    return res.status(400).json({ error: 'This payment has already been fully refunded' });
  }

  const pendingRefund = db.refunds.find((r) => r.paymentId === paymentId && r.status === 'pending_approval');
  if (pendingRefund) {
    return res.status(409).json({ error: 'A refund request is already pending approval for this payment' });
  }

  const amount = paymentRecord.amount;

  const refundRequest = {
    id: crypto.randomUUID(),
    paymentId,
    customerId: req.customer.id,
    amount,
    reason: refundReason,
    status: 'pending_approval',
    requestedBy: `customer:${req.customer.fullName}`,
    createdBy: `customer:${req.customer.fullName}`,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  db.refunds.push(refundRequest);
  paymentRecord.refundStatus = 'pending';
  paymentRecord.updatedAt = nowIso();
  db.ledger.push(
    createLedgerEntry({
      type: 'refund_requested',
      amount,
      direction: 'out',
      account: 'operations',
      referenceId: paymentId,
      note: refundReason,
      metadata: { refundRequestId: refundRequest.id, requestedBy: refundRequest.requestedBy }
    })
  );

  writeDb(db);

  return res.status(201).json({
    message: 'Refund request submitted for approval.',
    refundRequest,
    maxRefundable
  });
});

app.get('/api/pricing', (req, res) => {
  res.json(PRICING);
});

app.get('/api/payment-instructions', (req, res) => {
  const bridgeActive = !MPESA_ENABLED || !hasMpesaConfig();
  res.json({
    bridgeActive,
    tillNumber: MPESA_TILL_NUMBER || '',
    instructions: MPESA_TILL_NUMBER
      ? `Pay to Till ${MPESA_TILL_NUMBER}, then submit your MPESA receipt code below for admin verification.`
      : 'Submit your MPESA receipt code below for admin verification.'
  });
});

app.post('/api/customers/register', async (req, res) => {
  const { fullName, phone, email } = req.body;

  const nameValidation = validateCustomerFullName(fullName);
  if (!nameValidation.isValid) {
    return res.status(400).json({ error: nameValidation.error });
  }

  const phoneValidation = validateCustomerPhone(phone);
  if (!phoneValidation.isValid) {
    return res.status(400).json({ error: phoneValidation.error });
  }

  const emailValidation = validateCustomerEmail(email, false);
  if (!emailValidation.isValid) {
    return res.status(400).json({ error: emailValidation.error });
  }

  const validFullName = nameValidation.normalizedName;
  const canonicalPhone = phoneValidation.localFormat;
  const canonicalEmail = emailValidation.normalizedEmail;

  const db = readDb();
  let customer = findCustomerByPhone(db, canonicalPhone);
  if (!customer && canonicalEmail) {
    customer = findCustomerByEmail(db, canonicalEmail);
  }

  const loginCode = Math.floor(100000 + Math.random() * 900000).toString();

  if (!customer) {
    customer = {
      id: crypto.randomUUID(),
      fullName: validFullName,
      phone: canonicalPhone,
      email: canonicalEmail,
      loginCode,
      loginToken: generateCustomerToken(),
      emailOtp: loginCode,
      otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastActivityAt: nowIso()
    };
    db.customers.push(customer);
  } else {
    customer.fullName = validFullName;
    customer.phone = canonicalPhone;
    if (canonicalEmail) customer.email = canonicalEmail;
    customer.loginCode = loginCode;
    customer.emailOtp = loginCode;
    customer.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    customer.loginToken = customer.loginToken || generateCustomerToken();
    customer.updatedAt = nowIso();
    customer.lastActivityAt = nowIso();
  }

  // Send registration welcome & access code via SMS
  const smsMessage = `Aqualine: Welcome ${customer.fullName}! Registration complete. Phone: ${customer.phone}. Account Login Code: ${customer.loginCode}`;
  let smsResult = null;
  try {
    smsResult = await sendTokenSms(customer.phone, smsMessage);
  } catch (err) {
    console.warn(`SMS notification error for ${customer.phone}:`, err.message);
  }

  // Send Gmail OTP / Welcome Email if email was provided
  let emailResult = null;
  if (customer.email) {
    try {
      emailResult = await sendCustomerEmailOtp(customer.email, customer.fullName, loginCode, 'register');
    } catch (err) {
      console.warn(`Email OTP dispatch error for ${customer.email}:`, err.message);
    }
  }

  writeDb(db);
  res.status(201).json({
    message: customer.email 
      ? `Registration complete! Verification OTP sent to ${customer.email}` 
      : 'Customer registered successfully.',
    customer: {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone,
      email: customer.email || '',
      loginCode: customer.loginCode,
      loginToken: customer.loginToken
    },
    loginCode: customer.loginCode,
    email: customer.email,
    sms: smsResult,
    emailResult
  });
});

app.post('/api/payments/mpesa', async (req, res) => {
  const { phone, amount, unitType } = req.body;

  const phoneValidation = validateCustomerPhone(phone);
  if (!phoneValidation.isValid) {
    return res.status(400).json({ error: phoneValidation.error });
  }

  const cleanedPhone = phoneValidation.localFormat;
  const paymentAmount = Number(amount);

  if (Number.isNaN(paymentAmount) || paymentAmount <= 0) {
    return res.status(400).json({ error: 'Valid payment amount is required' });
  }

  if (!['litre', '1000_litre', 'unit'].includes(unitType)) {
    return res.status(400).json({ error: 'unitType must be litre or 1000_litre' });
  }

  const db = readDb();
  const customer = findCustomerByPhone(db, cleanedPhone);

  if (!customer) {
    return res.status(404).json({ error: 'Customer not found. Please register first.' });
  }

  const litresBought = calculateLitres(paymentAmount, unitType);

  if (litresBought <= 0) {
    return res.status(400).json({
      error: 'Amount is too low for selected pricing plan',
      pricing: PRICING
    });
  }

  try {
    const mpesaResult = await processMpesaPayment(cleanedPhone, paymentAmount);
    if (!mpesaResult.success) {
      return res.status(502).json({ error: mpesaResult.error || 'MPESA payment failed' });
    }

    if (mpesaResult.pending) {
      const paymentRecord = {
        id: crypto.randomUUID(),
        customerId: customer.id,
        phone: cleanedPhone,
        amount: paymentAmount,
        unitType,
        status: 'pending',
        checkoutRequestId: mpesaResult.checkoutRequestId,
        merchantRequestId: mpesaResult.merchantRequestId,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      db.payments.push(paymentRecord);
      writeDb(db);

      return res.status(202).json({
        message: mpesaResult.customerMessage || 'MPESA prompt sent. Complete payment on phone.',
        payment: paymentRecord
      });
    }

    const paymentRecord = {
      id: crypto.randomUUID(),
      customerId: customer.id,
      phone: cleanedPhone,
      amount: paymentAmount,
      unitType,
      status: 'paid',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      mpesaReceipt: mpesaResult.mpesaReceipt
    };

    await finalizeSuccessfulPayment(db, paymentRecord, mpesaResult.mpesaReceipt);
    db.payments.push(paymentRecord);
    writeDb(db);

    return res.status(201).json({
      message: 'Payment successful. Token sent to customer phone.',
      payment: paymentRecord,
      sms: paymentRecord.sms
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Payment processing error' });
  }
});

app.post('/api/payments/manual-submit', (req, res) => {
  const { phone, amount, unitType, mpesaReceipt } = req.body;
  const cleanedPhone = normalizePhone(phone);
  const paymentAmount = Number(amount);
  const cleanedReceipt = String(mpesaReceipt || '').trim().toUpperCase();

  if (!cleanedPhone || Number.isNaN(paymentAmount) || paymentAmount <= 0 || !cleanedReceipt) {
    return res.status(400).json({ error: 'phone, amount and mpesaReceipt are required' });
  }

  if (!['litre', '1000_litre', 'unit'].includes(unitType)) {
    return res.status(400).json({ error: 'unitType must be litre or 1000_litre' });
  }

  const litresBought = calculateLitres(paymentAmount, unitType);
  if (litresBought <= 0) {
    return res.status(400).json({
      error: 'Amount is too low for selected pricing plan',
      pricing: PRICING
    });
  }

  const db = readDb();
  const customer = findCustomerByPhone(db, cleanedPhone);
  if (!customer) {
    return res.status(404).json({ error: 'Customer not found. Please register first.' });
  }

  const duplicateReceipt = db.payments.find(
    (payment) =>
      payment.mpesaReceiptSubmitted === cleanedReceipt || payment.mpesaReceipt === cleanedReceipt
  );
  if (duplicateReceipt) {
    return res.status(409).json({ error: 'This MPESA receipt code has already been submitted.' });
  }

  const paymentRecord = {
    id: crypto.randomUUID(),
    customerId: customer.id,
    phone: cleanedPhone,
    amount: paymentAmount,
    unitType,
    status: 'pending_manual',
    paymentChannel: 'manual_till',
    mpesaReceiptSubmitted: cleanedReceipt,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  db.payments.push(paymentRecord);
  writeDb(db);

  return res.status(201).json({
    message: 'Manual payment submitted. Awaiting admin verification.',
    payment: paymentRecord
  });
});

app.post('/api/payments/mpesa/callback', async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) {
      return res.status(400).json({ error: 'Invalid callback payload' });
    }

    const db = readDb();
    const paymentRecord = db.payments.find(
      (payment) => payment.checkoutRequestId === callback.CheckoutRequestID
    );

    if (!paymentRecord) {
      return res.status(404).json({ error: 'Payment record not found for callback' });
    }

    if (paymentRecord.status === 'paid') {
      return res.json({ message: 'Callback already processed.' });
    }

    paymentRecord.updatedAt = nowIso();

    if (callback.ResultCode !== 0) {
      paymentRecord.status = 'failed';
      paymentRecord.failureReason = callback.ResultDesc || 'Payment failed';
      writeDb(db);
      return res.json({ message: 'Callback received (failed payment).' });
    }

    const metadataItems = callback.CallbackMetadata?.Item || [];
    const amountFromCallback = Number(getStkMetadataValue(metadataItems, 'Amount'));
    const receiptFromCallback = getStkMetadataValue(metadataItems, 'MpesaReceiptNumber');

    if (!Number.isNaN(amountFromCallback) && amountFromCallback > 0) {
      paymentRecord.amount = amountFromCallback;
    }

    await finalizeSuccessfulPayment(db, paymentRecord, receiptFromCallback);
    writeDb(db);

    return res.json({ message: 'Callback processed successfully' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to process callback' });
  }
});

app.use('/api/admin', requireAdmin);

app.get('/api/admin/auth-check', (req, res) => {
  res.json({ message: 'Admin authenticated' });
});

app.get('/api/admin/integration-status', (req, res) => {
  const mpesaConfigured = hasMpesaConfig();
  const smsConfigured = hasSmsConfig();

  res.json({
    mpesa: {
      enabled: MPESA_ENABLED,
      mode: MPESA_ENABLED && mpesaConfigured ? 'live' : 'simulated',
      environment: MPESA_ENV,
      configured: mpesaConfigured,
      callbackUrlSet: Boolean(MPESA_CALLBACK_URL)
    },
    sms: {
      enabled: SMS_ENABLED,
      provider: SMS_PROVIDER,
      mode: SMS_ENABLED && smsConfigured ? 'live' : 'simulated',
      configured: smsConfigured,
      senderIdSet: Boolean(SMS_SENDER_ID)
    }
  });
});

app.get('/api/admin/payments/pending-manual', (req, res) => {
  const db = readDb();
  const pending = db.payments
    .filter((payment) => payment.status === 'pending_manual')
    .map((payment) => {
      const customer = db.customers.find((entry) => entry.id === payment.customerId);
      return {
        ...payment,
        paymentChannel: payment.paymentChannel || payment.source || 'manual_till',
        mpesaReceiptSubmitted: payment.mpesaReceiptSubmitted || payment.mpesaReceipt || '',
        customerName: customer?.fullName || 'Unknown'
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ pendingPayments: pending });
});

app.post('/api/admin/payments/:paymentId/manual-approve', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const db = readDb();
    const paymentRecord = db.payments.find((payment) => payment.id === paymentId);

    if (!paymentRecord) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (paymentRecord.status !== 'pending_manual') {
      return res.status(400).json({ error: 'Only pending manual payments can be approved' });
    }

    const submittedReceipt = paymentRecord.mpesaReceiptSubmitted || paymentRecord.mpesaReceipt;
    await finalizeSuccessfulPayment(db, paymentRecord, submittedReceipt);
    paymentRecord.mpesaReceiptSubmitted = submittedReceipt || '';
    paymentRecord.paymentChannel = 'manual_till';
    paymentRecord.approvedAt = nowIso();

    writeDb(db);

    return res.json({
      message: 'Manual payment approved and token sent to customer phone.',
      payment: paymentRecord
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to approve manual payment' });
  }
});

app.post('/api/admin/payments/:paymentId/manual-reject', (req, res) => {
  const { paymentId } = req.params;
  const reason = String(req.body?.reason || 'Verification failed').trim();

  const db = readDb();
  const paymentRecord = db.payments.find((payment) => payment.id === paymentId);

  if (!paymentRecord) {
    return res.status(404).json({ error: 'Payment not found' });
  }

  if (paymentRecord.status !== 'pending_manual') {
    return res.status(400).json({ error: 'Only pending manual payments can be rejected' });
  }

  paymentRecord.status = 'rejected_manual';
  paymentRecord.rejectionReason = reason;
  paymentRecord.updatedAt = nowIso();

  writeDb(db);

  return res.json({ message: 'Manual payment rejected.', payment: paymentRecord });
});

app.post('/api/admin/payments/:paymentId/simulate-callback', async (req, res) => {
  const { paymentId } = req.params;
  const { success } = req.body;

  try {
    const db = readDb();
    const paymentRecord = db.payments.find((p) => p.id === paymentId);

    if (!paymentRecord) {
      return res.status(404).json({ error: 'Payment record not found' });
    }

    if (paymentRecord.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending payments can have their callbacks simulated' });
    }

    paymentRecord.updatedAt = nowIso();

    if (success === false) {
      paymentRecord.status = 'failed';
      paymentRecord.failureReason = 'Simulated payment failure (cancelled by user)';
      writeDb(db);
      return res.json({ message: 'Callback simulated as FAILED successfully.', payment: paymentRecord });
    }

    const mockReceipt = 'MOCK' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await finalizeSuccessfulPayment(db, paymentRecord, mockReceipt);
    writeDb(db);

    return res.json({ message: 'Callback simulated as SUCCESS successfully. Token generated.', payment: paymentRecord });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to simulate callback' });
  }
});

app.get('/api/admin/finance/overview', (req, res) => {
  const db = readDb();
  const recentSettlements = db.settlements
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);
  const recentRefunds = db.refunds
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  const unsettledCount = db.payments.filter(
    (payment) => payment.status === 'paid' && !payment.settlementId
  ).length;

  res.json({
    policy: db.finance.policy,
    balances: db.finance.balances,
    unsettledCount,
    totals: {
      settlements: db.settlements.length,
      refunds: db.refunds.length,
      pendingRefundApprovals: db.refunds.filter((refund) => refund.status === 'pending_approval').length,
      refundedAmount: roundCurrency(db.refunds.reduce((sum, refund) => sum + refund.amount, 0))
    },
    recentSettlements,
    recentRefunds
  });
});

app.get('/api/admin/finance/ledger', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 300);
  const db = readDb();
  const entries = db.ledger
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  res.json({ entries });
});

app.post('/api/admin/finance/top-up-operations', (req, res) => {
  const amount = asPositiveNumber(req.body?.amount);
  const reason = String(req.body?.reason || 'Operations top-up').trim();

  if (!amount) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  const db = readDb();
  if (amount > db.finance.balances.collections) {
    return res.status(400).json({ error: 'Insufficient collections balance for top-up' });
  }

  db.finance.balances.collections = roundCurrency(db.finance.balances.collections - amount);
  db.finance.balances.operations = roundCurrency(db.finance.balances.operations + amount);
  db.finance.updatedAt = nowIso();

  db.ledger.push(
    createLedgerEntry({
      type: 'float_topup',
      amount,
      direction: 'out',
      account: 'collections',
      referenceId: 'operations_topup',
      note: reason,
      metadata: { toAccount: 'operations' }
    })
  );

  writeDb(db);
  return res.json({ message: 'Operations top-up completed.', balances: db.finance.balances });
});

app.post('/api/admin/finance/settle-unsettled-payments', (req, res) => {
  const db = readDb();
  const applied = settleUnsettledPayments(db);

  writeDb(db);
  return res.json({
    message: `Applied settlement for ${applied.length} payment(s).`,
    appliedCount: applied.length,
    balances: db.finance.balances
  });
});

app.get('/api/admin/refunds', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const db = readDb();
  const refunds = db.refunds
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map((refund) => {
      const customer = db.customers.find((entry) => entry.id === refund.customerId);
      return {
        ...refund,
        customerName: customer?.fullName || 'Unknown'
      };
    });

  res.json({ refunds });
});

app.post('/api/admin/refunds', (req, res) => {
  const paymentId = String(req.body?.paymentId || '').trim();
  const amount = asPositiveNumber(req.body?.amount);
  const reason = String(req.body?.reason || 'Customer refund').trim();
  const requestedBy = getActor(req);

  if (!paymentId || !amount) {
    return res.status(400).json({ error: 'paymentId and valid amount are required' });
  }

  const db = readDb();
  const paymentRecord = db.payments.find((payment) => payment.id === paymentId);
  if (!paymentRecord) {
    return res.status(404).json({ error: 'Payment not found' });
  }
  if (paymentRecord.status !== 'paid') {
    return res.status(400).json({ error: 'Only paid transactions can be refunded' });
  }

  const alreadyRefunded = roundCurrency(paymentRecord.refundedAmount || 0);
  const maxRefundable = roundCurrency(paymentRecord.amount - alreadyRefunded);
  if (amount > maxRefundable) {
    return res.status(400).json({ error: 'Refund amount exceeds refundable balance for this payment' });
  }

  const duplicatePending = db.refunds.find(
    (refund) =>
      refund.status === 'pending_approval' &&
      refund.paymentId === paymentId &&
      roundCurrency(refund.amount) === amount
  );
  if (duplicatePending) {
    return res.status(409).json({ error: 'A similar pending refund request already exists' });
  }

  const refundRequest = {
    id: crypto.randomUUID(),
    paymentId,
    customerId: paymentRecord.customerId,
    amount,
    reason,
    status: 'pending_approval',
    requestedBy,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  db.refunds.push(refundRequest);
  paymentRecord.refundStatus = 'pending';
  paymentRecord.updatedAt = nowIso();
  db.ledger.push(
    createLedgerEntry({
      type: 'refund_requested',
      amount,
      direction: 'out',
      account: 'operations',
      referenceId: paymentId,
      note: reason,
      metadata: { refundRequestId: refundRequest.id, requestedBy }
    })
  );

  writeDb(db);
  return res.status(201).json({
    message: 'Refund request submitted for approval.',
    refundRequest,
    maxRefundable
  });
});

app.get('/api/admin/refunds/pending', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const db = readDb();

  const pending = db.refunds
    .filter((refund) => refund.status === 'pending_approval')
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map((refund) => {
      const customer = db.customers.find((entry) => entry.id === refund.customerId);
      return {
        ...refund,
        customerName: customer?.fullName || 'Unknown'
      };
    });

  res.json({ pending });
});

app.post('/api/admin/refunds/:refundId/approve', requireApprover, (req, res) => {
  const { refundId } = req.params;
  const approver = getActor(req, 'approver');

  const db = readDb();
  const refundRequest = db.refunds.find((refund) => refund.id === refundId);
  if (!refundRequest) {
    return res.status(404).json({ error: 'Refund request not found' });
  }

  try {
    const issuedRefund = approveRefundRequest(db, { refundRequest, approver });
    writeDb(db);

    return res.json({
      message: 'Refund approved and issued successfully.',
      issuedRefund,
      balances: db.finance.balances
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to approve refund' });
  }
});

app.get('/api/admin/payments/recent', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const db = readDb();
  const recent = db.payments
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
    .slice(0, limit)
    .map((payment) => {
      const customer = db.customers.find((c) => c.id === payment.customerId);
      return {
        id: payment.id,
        customerName: customer?.fullName || 'Unknown',
        phone: payment.phone,
        amount: payment.amount,
        status: payment.status,
        paymentChannel: payment.paymentChannel || payment.source || 'mpesa_stk',
        mpesaReceipt: payment.mpesaReceipt || payment.mpesaReceiptSubmitted || '',
        tokenCode: payment.tokenCode || '',
        refundedAmount: roundCurrency(payment.refundedAmount || 0),
        refundStatus: payment.refundStatus || 'none',
        failureReason: payment.failureReason || payment.rejectionReason || '',
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt
      };
    });

  res.json({ transactions: recent });
});

app.get('/api/admin/customers', (req, res) => {
  const db = readDb();
  const withSpend = db.customers.map((customer) => {
    const customerPayments = db.payments.filter((payment) => payment.customerId === customer.id);
    const totalSpent = customerPayments.reduce((sum, payment) => sum + payment.amount, 0);
    return {
      ...customer,
      transactionCount: customerPayments.length,
      totalSpent
    };
  });

  res.json({ customers: withSpend });
});

app.delete('/api/admin/customers/:customerId', (req, res) => {
  const { customerId } = req.params;
  const db = readDb();
  const customerIndex = db.customers.findIndex((customer) => customer.id === customerId);

  if (customerIndex === -1) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const [removedCustomer] = db.customers.splice(customerIndex, 1);
  const removedPayments = db.payments.filter((payment) => payment.customerId === customerId);
  db.payments = db.payments.filter((payment) => payment.customerId !== customerId);
  writeDb(db);

  res.json({
    message: `Deleted ${removedCustomer.fullName || 'customer'} and ${removedPayments.length} related payment(s).`,
    removedCustomer,
    removedPaymentCount: removedPayments.length
  });
});

app.get('/api/admin/customers/report', (req, res) => {
  const db = readDb();
  const generatedAt = nowIso();
  const rows = db.customers.map((customer) => {
    const customerPayments = db.payments.filter((payment) => payment.customerId === customer.id);
    const totalSpent = customerPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    return [
      customer.id,
      customer.fullName || '',
      customer.phone || '',
      customerPayments.length,
      roundCurrency(totalSpent).toFixed(2),
      customer.createdAt || '',
      customer.lastActivityAt || ''
    ];
  });

  const csvLines = [
    ['Generated At', generatedAt].map(escapeCsv).join(','),
    ['Customer ID', 'Full Name', 'Phone', 'Transaction Count', 'Total Spent', 'Created At', 'Last Activity At']
      .map(escapeCsv)
      .join(','),
    ...rows.map((row) => row.map(escapeCsv).join(','))
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="customers-report.csv"');
  res.send(csvLines.join('\n'));
});

app.delete('/api/admin/customers/inactive', (req, res) => {
  const years = Number(req.query.years || 2);
  const db = readDb();
  const now = Date.now();
  const thresholdMs = years * 365 * 24 * 60 * 60 * 1000;

  const activeCustomers = [];
  const removedCustomers = [];

  for (const customer of db.customers) {
    const lastActivityMs = new Date(customer.lastActivityAt || customer.createdAt).getTime();
    if (now - lastActivityMs > thresholdMs) {
      removedCustomers.push(customer);
    } else {
      activeCustomers.push(customer);
    }
  }

  const removedIds = new Set(removedCustomers.map((c) => c.id));
  const retainedPayments = db.payments.filter((p) => !removedIds.has(p.customerId));

  db.customers = activeCustomers;
  db.payments = retainedPayments;
  writeDb(db);

  res.json({
    message: `Removed ${removedCustomers.length} inactive customer account(s).`,
    removedCount: removedCustomers.length,
    years,
    removedCustomers
  });
});

app.get('/api/admin/payments', (req, res) => {
  const db = readDb();
  res.json({ payments: db.payments.slice().reverse() });
});

app.post('/api/help/inquiry', (req, res) => {
  const { name, phone, email, subject, message } = req.body || {};
  if (!name || (!phone && !email) || !message) {
    return res.status(400).json({ error: 'Please provide your name, phone/email, and a message.' });
  }

  const ticketId = 'HELP-' + Math.floor(100000 + Math.random() * 900000);
  console.log(`[Help Inquiry] #${ticketId} from ${name} (${phone || email}) [${subject || 'General'}]: ${message}`);

  res.json({
    ok: true,
    ticketId,
    message: `Thank you, ${name}! Your inquiry (Ticket #${ticketId}) has been received. Our team will contact you shortly.`
  });
});


async function startServer() {
  await initializeDatabase();

  app.listen(PORT, () => {
    console.log(`Aqualine server running at http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error(`Failed to start server: ${error.message}`);
  process.exit(1);
});

if (AUTO_SETTLEMENT_ENABLED) {
  // Hourly check; executes only on configured UTC hour and once per UTC date.
  setInterval(runAutoSettlementSweep, 60 * 60 * 1000);
  runAutoSettlementSweep();
}
