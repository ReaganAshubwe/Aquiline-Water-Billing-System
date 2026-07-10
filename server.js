const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'AQUALINE_ADMIN_2026';
const APPROVER_KEY = process.env.APPROVER_KEY || '';

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

function requireAdmin(req, res, next) {
  const headerKey = req.get('x-admin-key');
  const bearerKey = extractBearerToken(req.get('authorization'));
  const providedKey = headerKey || bearerKey;

  if (!providedKey || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized admin access' });
  }

  next();
}

function requireApprover(req, res, next) {
  if (!APPROVER_KEY) {
    return next();
  }

  const providedApproverKey = req.get('x-approver-key');
  if (!providedApproverKey || providedApproverKey !== APPROVER_KEY) {
    return res.status(401).json({ error: 'Unauthorized approver access' });
  }

  next();
}

function readDb() {
  const content = fs.readFileSync(DB_PATH, 'utf-8');
  const data = JSON.parse(content);
  return ensureDbSchema(data);
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
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
  return String(phone || '').replace(/\s+/g, '');
}

function normalizeKenyanPhone(phone) {
  const cleaned = normalizePhone(phone).replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+254')) return cleaned.slice(1);
  if (cleaned.startsWith('254')) return cleaned;
  if (cleaned.startsWith('0')) return `254${cleaned.slice(1)}`;
  return cleaned;
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

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error('Failed to get MPESA access token');
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

  const data = await response.json();
  if (!response.ok) {
    return {
      success: false,
      mode: 'live',
      pending: false,
      error: data.errorMessage || 'MPESA STK push failed'
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
  form.set('username', SMS_USERNAME);
  form.set('to', normalizeKenyanPhone(phone));
  form.set('message', message);
  if (SMS_SENDER_ID) {
    form.set('from', SMS_SENDER_ID);
  }

  const response = await fetch('https://api.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      apiKey: SMS_API_KEY
    },
    body: form.toString()
  });

  const data = await response.json();
  if (!response.ok) {
    return {
      success: false,
      mode: 'live',
      provider: SMS_PROVIDER,
      error: data?.SMSMessageData?.Message || 'SMS sending failed'
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
  return db.customers.find((customer) => customer.phone === phone);
}

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

app.post('/api/customers/register', (req, res) => {
  const { fullName, phone } = req.body;
  const cleanedPhone = normalizePhone(phone);

  if (!fullName || !cleanedPhone) {
    return res.status(400).json({ error: 'fullName and phone are required' });
  }

  const db = readDb();
  let customer = findCustomerByPhone(db, cleanedPhone);

  if (!customer) {
    customer = {
      id: crypto.randomUUID(),
      fullName,
      phone: cleanedPhone,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastActivityAt: nowIso()
    };
    db.customers.push(customer);
  } else {
    customer.fullName = fullName;
    customer.updatedAt = nowIso();
    customer.lastActivityAt = nowIso();
  }

  writeDb(db);
  res.status(201).json({ message: 'Customer registered successfully', customer });
});

app.post('/api/payments/mpesa', async (req, res) => {
  const { phone, amount, unitType } = req.body;
  const cleanedPhone = normalizePhone(phone);
  const paymentAmount = Number(amount);

  if (!cleanedPhone || Number.isNaN(paymentAmount) || paymentAmount <= 0) {
    return res.status(400).json({ error: 'Valid phone and amount are required' });
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

app.listen(PORT, () => {
  console.log(`Aqualine server running at http://localhost:${PORT}`);
});

if (AUTO_SETTLEMENT_ENABLED) {
  // Hourly check; executes only on configured UTC hour and once per UTC date.
  setInterval(runAutoSettlementSweep, 60 * 60 * 1000);
  runAutoSettlementSweep();
}
