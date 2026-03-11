const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'AQUALINE_ADMIN_2026';

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

app.use(express.json());
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

function readDb() {
  const content = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(content);
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function nowIso() {
  return new Date().toISOString();
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
