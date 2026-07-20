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

  const tbody = document.getElementById('paymentsBody');
  tbody.innerHTML = '';
  if (!payments.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-4 text-slate-500">No payments yet.</td></tr>';
    return;
  }

  for (const payment of payments) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="px-4 py-3">${new Date(payment.createdAt).toLocaleString()}</td>
      <td class="px-4 py-3">${formatMoney(payment.amount)}</td>
      <td class="px-4 py-3">${payment.status}</td>
      <td class="px-4 py-3">${payment.tokenCode || '-'}</td>
      <td class="px-4 py-3">${payment.mpesaReceipt || payment.mpesaReceiptSubmitted || '-'}</td>
    `;
    tbody.appendChild(row);
  }
}

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