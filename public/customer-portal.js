const CUSTOMER_TOKEN_STORAGE = 'aqualineCustomerToken';

function api(path, options = {}) {
  const apiBaseUrl = window.APP_CONFIG?.apiBaseUrl || '';
  const requestUrl = apiBaseUrl ? new URL(path, apiBaseUrl).toString() : path;
  return fetch(requestUrl, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  }).then(async (response) => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  });
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('opacity-0');
  toast.classList.toggle('bg-red-600/90', isError);
  toast.classList.toggle('bg-slate-900/90', !isError);
  toast.classList.add('opacity-100');
  setTimeout(() => toast.classList.replace('opacity-100', 'opacity-0'), 2200);
}

function formatMoney(value) {
  return `KES ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function setText(id, text, isError = false) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
    el.classList.remove('text-red-600', 'text-aqua-700');
    el.classList.add(isError ? 'text-red-600' : 'text-aqua-700');
  }
}

function setButtonLoading(button, isLoading, loadingText) {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
    button.classList.add('opacity-70', 'cursor-not-allowed');
    return;
  }

  if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
  }
  button.disabled = false;
  button.classList.remove('opacity-70', 'cursor-not-allowed');
}

async function loadPaymentInstructions() {
  try {
    const result = await api('/api/payment-instructions');
    const message = result.instructions || 'Submit your MPESA receipt code below for admin verification.';
    const el = document.getElementById('manualInstructions');
    if (el) el.textContent = message;
  } catch (error) {
    setText('manualPaymentResult', error.message, true);
  }
}

function renderAccount(customer, payments) {
  document.getElementById('accountPanel').classList.remove('hidden');
  document.querySelectorAll('.account-view').forEach((el) => el.classList.remove('hidden'));
  document.getElementById('customerSummary').textContent = `${customer.fullName} • ${customer.phone}`;

  // Pre-fill phone inputs in payment forms
  document.querySelectorAll('input[name="phone"]').forEach((input) => {
    input.value = customer.phone;
  });

  // Calculate Account Metrics
  let totalSpent = 0;
  let totalLitres = 0;
  let paidTxCount = 0;
  let activeTokens = 0;

  for (const p of payments) {
    if (p.status === 'paid') {
      totalSpent += Number(p.amount || 0);
      totalLitres += Number(p.litresBought || 0);
      paidTxCount++;
      if (p.tokenCode) activeTokens++;
    }
  }

  const statSpentEl = document.getElementById('statTotalSpent');
  const statLitresEl = document.getElementById('statTotalLitres');
  const statTxEl = document.getElementById('statTotalTx');
  const statTokensEl = document.getElementById('statActiveTokens');

  if (statSpentEl) statSpentEl.textContent = formatMoney(totalSpent);
  if (statLitresEl) statLitresEl.textContent = `${totalLitres.toLocaleString()} Litres`;
  if (statTxEl) statTxEl.textContent = `${paidTxCount} Paid (${payments.length} Total)`;
  if (statTokensEl) statTokensEl.textContent = `${activeTokens} Available`;

  const tbody = document.getElementById('paymentsBody');
  tbody.innerHTML = '';
  if (!payments.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-4 text-slate-500">No payments yet.</td></tr>';
    return;
  }

  for (const payment of payments) {
    const refundable = Math.max(Number(payment.amount || 0) - Number(payment.refundedAmount || 0), 0);
    let actionBtn = '<span class="text-slate-400 text-xs">-</span>';
    if (payment.status === 'paid' && refundable > 0) {
      if (payment.refundStatus === 'pending') {
        actionBtn = '<span class="text-amber-600 text-xs font-semibold">Refund Pending</span>';
      } else {
        actionBtn = `<button data-action="request-refund" data-id="${payment.id}" class="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 transition hover:bg-amber-100">Request Refund</button>`;
      }
    } else if (payment.refundStatus === 'refunded') {
      actionBtn = '<span class="text-red-600 text-xs font-semibold">Refunded</span>';
    }

    const row = document.createElement('tr');
    row.className = 'transition hover:bg-aqua-50/50';
    row.innerHTML = `
      <td class="px-4 py-3 text-slate-700 font-medium">${new Date(payment.createdAt).toLocaleString()}</td>
      <td class="px-4 py-3 text-slate-600 font-semibold">${formatMoney(payment.amount)}</td>
      <td class="px-4 py-3">
        <span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          payment.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 
          payment.status === 'pending' || payment.status === 'pending_manual' ? 'bg-amber-100 text-amber-800' : 
          'bg-rose-100 text-rose-800'
        }">${payment.status}</span>
      </td>
      <td class="px-4 py-3 font-mono text-xs text-slate-700 font-bold">${payment.tokenCode || '-'}</td>
      <td class="px-4 py-3 font-mono text-xs text-slate-600">${payment.mpesaReceipt || payment.mpesaReceiptSubmitted || '-'}</td>
      <td class="px-4 py-3 text-right">${actionBtn}</td>
    `;
    tbody.appendChild(row);
  }
}

// Download Customer Statement PDF
document.getElementById('downloadPdfBtn')?.addEventListener('click', async () => {
  const token = sessionStorage.getItem(CUSTOMER_TOKEN_STORAGE);
  if (!token) {
    showToast('Please login to download your statement', true);
    return;
  }

  const btn = document.getElementById('downloadPdfBtn');
  setButtonLoading(btn, true, 'Generating PDF...');
  try {
    const apiBaseUrl = window.APP_CONFIG?.apiBaseUrl || '';
    const url = apiBaseUrl
      ? new URL(`/api/customer/statement/pdf?token=${encodeURIComponent(token)}`, apiBaseUrl).toString()
      : `/api/customer/statement/pdf?token=${encodeURIComponent(token)}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to generate PDF statement');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `Aqualine-Statement-${dateStr}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
    showToast('Statement PDF downloaded successfully!');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
});

document.getElementById('paymentsBody').addEventListener('click', async (event) => {
  const refundBtn = event.target.closest('button[data-action="request-refund"]');
  if (!refundBtn) return;

  const paymentId = refundBtn.dataset.id;
  const reason = prompt('Please enter the reason for your refund request:');
  if (reason === null) return;

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    showToast('Refund reason is required', true);
    return;
  }

  try {
    refundBtn.disabled = true;
    refundBtn.textContent = 'Requesting...';
    const token = sessionStorage.getItem(CUSTOMER_TOKEN_STORAGE);
    
    const response = await api('/api/customer/refunds', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify({ paymentId, reason: trimmedReason })
    });

    showToast(response.message);
    await loadMe();
  } catch (error) {
    showToast(error.message, true);
    refundBtn.disabled = false;
    refundBtn.textContent = 'Request Refund';
  }
});

async function loadMe() {
  const token = sessionStorage.getItem(CUSTOMER_TOKEN_STORAGE);
  if (!token) return;
  try {
    const result = await api('/api/customer/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    renderAccount(result.customer, result.payments || []);
  } catch {
    sessionStorage.removeItem(CUSTOMER_TOKEN_STORAGE);
    document.querySelectorAll('.account-view').forEach((el) => el.classList.add('hidden'));
  }
}

// Login Tab Switching
document.getElementById('tabOtpBtn')?.addEventListener('click', () => {
  document.getElementById('otpLoginFormWrap')?.classList.remove('hidden');
  document.getElementById('customerLoginForm')?.classList.add('hidden');
  document.getElementById('tabOtpBtn').className = 'flex-1 rounded-lg bg-white py-2 text-xs font-bold text-aqua-900 shadow-sm transition';
  document.getElementById('tabDirectBtn').className = 'flex-1 rounded-lg py-2 text-xs font-semibold text-slate-600 transition hover:text-aqua-900';
});

document.getElementById('tabDirectBtn')?.addEventListener('click', () => {
  document.getElementById('otpLoginFormWrap')?.classList.add('hidden');
  document.getElementById('customerLoginForm')?.classList.remove('hidden');
  document.getElementById('tabDirectBtn').className = 'flex-1 rounded-lg bg-white py-2 text-xs font-bold text-aqua-900 shadow-sm transition';
  document.getElementById('tabOtpBtn').className = 'flex-1 rounded-lg py-2 text-xs font-semibold text-slate-600 transition hover:text-aqua-900';
});

// Gmail OTP Authentication Handlers
let currentOtpIdentifier = '';

async function handleSendOtp() {
  const input = document.getElementById('otpIdentifierInput');
  const identifier = input ? input.value.trim() : '';
  const btn = document.getElementById('sendOtpBtn');
  const resultEl = document.getElementById('otpLoginResult');

  if (!identifier) {
    showToast('Please enter your registered email or phone', true);
    if (resultEl) {
      resultEl.textContent = 'Please enter your registered email or phone';
      resultEl.className = 'min-h-6 text-sm font-semibold text-rose-600';
    }
    return;
  }

  try {
    setButtonLoading(btn, true, 'Sending OTP Code...');
    const res = await api('/api/customer/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ identifier })
    });

    currentOtpIdentifier = identifier;
    document.getElementById('otpStep1')?.classList.add('hidden');
    document.getElementById('otpStep2')?.classList.remove('hidden');
    const notice = document.getElementById('otpSentNotice');
    if (notice) notice.textContent = `A 6-digit OTP code has been sent to ${res.email}. Check your Gmail inbox.`;

    const devBox = document.getElementById('devOtpBox');
    const devVal = document.getElementById('devOtpVal');
    if (res.devOtp) {
      if (devBox) devBox.classList.remove('hidden');
      if (devVal) devVal.textContent = res.devOtp;
    } else {
      if (devBox) devBox.classList.add('hidden');
    }

    if (resultEl) {
      resultEl.textContent = res.devOtp ? `Verification code: ${res.devOtp}` : res.message;
      resultEl.className = 'min-h-6 text-sm font-semibold text-emerald-600';
    }
    showToast('OTP code sent to your email!');
    document.getElementById('otpCodeInput')?.focus();
  } catch (error) {
    if (resultEl) {
      resultEl.textContent = error.message;
      resultEl.className = 'min-h-6 text-sm font-semibold text-rose-600';
    }
    showToast(error.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
}

document.getElementById('devAutoFillBtn')?.addEventListener('click', () => {
  const devVal = document.getElementById('devOtpVal')?.textContent;
  const input = document.getElementById('otpCodeInput');
  if (devVal && input) {
    input.value = devVal.trim();
    document.getElementById('verifyOtpBtn')?.click();
  }
});

document.getElementById('sendOtpBtn')?.addEventListener('click', handleSendOtp);
document.getElementById('resendOtpBtn')?.addEventListener('click', handleSendOtp);

document.getElementById('changeIdentifierBtn')?.addEventListener('click', () => {
  document.getElementById('otpStep2')?.classList.add('hidden');
  document.getElementById('otpStep1')?.classList.remove('hidden');
  document.getElementById('devOtpBox')?.classList.add('hidden');
  const resultEl = document.getElementById('otpLoginResult');
  if (resultEl) resultEl.textContent = '';
});

document.getElementById('verifyOtpBtn')?.addEventListener('click', async () => {
  const otpInput = document.getElementById('otpCodeInput');
  const otp = otpInput ? otpInput.value.trim() : '';
  const btn = document.getElementById('verifyOtpBtn');
  const resultEl = document.getElementById('otpLoginResult');

  if (!otp || otp.length < 6) {
    showToast('Please enter the 6-digit verification code', true);
    return;
  }

  try {
    setButtonLoading(btn, true, 'Verifying Code...');
    const result = await api('/api/customer/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ identifier: currentOtpIdentifier, otp })
    });

    sessionStorage.setItem(CUSTOMER_TOKEN_STORAGE, result.customer.loginToken);
    showToast('Login successful!');
    if (resultEl) {
      resultEl.textContent = 'Authenticated successfully!';
      resultEl.className = 'min-h-6 text-sm font-semibold text-emerald-600';
    }
    await loadMe();
  } catch (error) {
    if (resultEl) {
      resultEl.textContent = error.message;
      resultEl.className = 'min-h-6 text-sm font-semibold text-rose-600';
    }
    showToast(error.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
});

document.getElementById('customerLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target);
  try {
    const result = await api('/api/customer/login', {
      method: 'POST',
      body: JSON.stringify({
        fullName: formData.get('fullName'),
        phone: formData.get('phone')
      })
    });
    sessionStorage.setItem(CUSTOMER_TOKEN_STORAGE, result.customer.loginToken);
    document.getElementById('loginResult').textContent = result.message;
    showToast('Customer logged in');
    await loadMe();
  } catch (error) {
    document.getElementById('loginResult').textContent = error.message;
    showToast(error.message, true);
  }
});

document.getElementById('logoutButton').addEventListener('click', () => {
  sessionStorage.removeItem(CUSTOMER_TOKEN_STORAGE);
  document.getElementById('accountPanel').classList.add('hidden');
  document.querySelectorAll('.account-view').forEach((el) => el.classList.add('hidden'));
  showToast('Logged out');
});

document.getElementById('paymentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitBtn = event.target.querySelector('button[type="submit"]');
  const formData = new FormData(event.target);
  const payload = {
    phone: formData.get('phone'),
    amount: Number(formData.get('amount')),
    unitType: formData.get('unitType')
  };

  try {
    setButtonLoading(submitBtn, true, 'Processing Payment...');
    const result = await api('/api/payments/mpesa', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (result.payment?.status === 'pending') {
      setText('paymentResult', result.message || 'MPESA prompt sent. Complete payment on phone.');
      showToast('MPESA prompt sent to phone');
    } else {
      setText(
        'paymentResult',
        `Success! Token ${result.payment.tokenCode}, litres ${result.payment.litresBought}, receipt ${result.payment.mpesaReceipt}.`
      );
      showToast('Payment successful and token generated');
      await loadMe();
    }
    event.target.querySelector('input[name="amount"]').value = '';
  } catch (error) {
    setText('paymentResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

document.getElementById('manualPaymentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitBtn = event.target.querySelector('button[type="submit"]');
  const formData = new FormData(event.target);
  const payload = {
    phone: formData.get('phone'),
    amount: Number(formData.get('amount')),
    unitType: formData.get('unitType'),
    mpesaReceipt: formData.get('mpesaReceipt')
  };

  try {
    setButtonLoading(submitBtn, true, 'Submitting...');
    const result = await api('/api/payments/manual-submit', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setText('manualPaymentResult', result.message);
    showToast('Manual payment submitted for admin verification');
    await loadMe();
    event.target.querySelector('input[name="amount"]').value = '';
    event.target.querySelector('input[name="mpesaReceipt"]').value = '';
  } catch (error) {
    setText('manualPaymentResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

loadMe();
loadPaymentInstructions();