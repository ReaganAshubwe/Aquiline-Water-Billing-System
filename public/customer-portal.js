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

function renderAccount(customer, payments) {
  document.getElementById('accountPanel').classList.remove('hidden');
  document.getElementById('customerSummary').textContent = `${customer.fullName} • ${customer.phone}`;

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
  showToast('Logged out');
});

loadMe();