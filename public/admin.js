const ADMIN_KEY_STORAGE = 'aqualineAdminKey';
const THEME_STORAGE = 'aqualineTheme';
let adminKey = sessionStorage.getItem(ADMIN_KEY_STORAGE) || '';

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark-mode', isDark);

  const mainToggle = document.getElementById('themeToggle');
  const mobileToggle = document.getElementById('themeToggleMobile');
  const label = isDark ? 'Light Mode' : 'Dark Mode';
  const icon = isDark ? '☀️' : '🌙';

  if (mainToggle) {
    mainToggle.innerHTML = `<span class="theme-icon" aria-hidden="true">${icon}</span><span class="theme-label">${label}</span>`;
  }
  if (mobileToggle) {
    mobileToggle.innerHTML = `<span class="theme-icon" aria-hidden="true">${icon}</span><span class="theme-label">${label}</span>`;
  }
}

function initThemeToggle() {
  const savedTheme = localStorage.getItem(THEME_STORAGE);
  const preferredTheme =
    savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(preferredTheme);

  const toggleTheme = () => {
    const currentTheme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_STORAGE, nextTheme);
    applyTheme(nextTheme);
  };

  document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
  document.getElementById('themeToggleMobile')?.addEventListener('click', toggleTheme);
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('opacity-0', 'translate-y-2', 'bg-slate-900/90', 'bg-red-600/90');
  toast.classList.add('opacity-100', 'translate-y-0', isError ? 'bg-red-600/90' : 'bg-slate-900/90');

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', 'translate-y-2');
  }, 2200);
}

function setText(id, text, isError = false) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.remove('text-red-600', 'text-aqua-700');
  el.classList.add(isError ? 'text-red-600' : 'text-aqua-700');
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

function initMobileMenu() {
  const menuButton = document.getElementById('mobileMenuButton');
  const mobileMenu = document.getElementById('mobileMenu');
  const openIcon = document.getElementById('menuIconOpen');
  const closeIcon = document.getElementById('menuIconClose');

  if (!menuButton || !mobileMenu || !openIcon || !closeIcon) {
    return;
  }

  const closeMenu = () => {
    mobileMenu.classList.add('hidden');
    menuButton.setAttribute('aria-expanded', 'false');
    openIcon.classList.remove('hidden');
    closeIcon.classList.add('hidden');
  };

  const openMenu = () => {
    mobileMenu.classList.remove('hidden');
    menuButton.setAttribute('aria-expanded', 'true');
    openIcon.classList.add('hidden');
    closeIcon.classList.remove('hidden');
  };

  menuButton.addEventListener('click', () => {
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    if (isOpen) {
      closeMenu();
      return;
    }
    openMenu();
  });

  document.querySelectorAll('.mobile-nav-link').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) {
      closeMenu();
    }
  });
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function adminApi(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': adminKey
    },
    ...options
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function setAdminPanelVisibility(isVisible) {
  const panel = document.getElementById('adminPanel');
  panel.classList.toggle('hidden', !isVisible);
}

function renderIntegrationStatus(status) {
  const mpesaMode = document.getElementById('mpesaStatusMode');
  const mpesaDetails = document.getElementById('mpesaStatusDetails');
  const smsMode = document.getElementById('smsStatusMode');
  const smsDetails = document.getElementById('smsStatusDetails');

  if (!status) {
    mpesaMode.textContent = '-';
    mpesaDetails.textContent = 'Waiting for admin authentication...';
    smsMode.textContent = '-';
    smsDetails.textContent = 'Waiting for admin authentication...';
    return;
  }

  const mpesaLabel = status.mpesa.mode === 'live' ? 'Live' : 'Simulation';
  const smsLabel = status.sms.mode === 'live' ? 'Live' : 'Simulation';

  mpesaMode.textContent = mpesaLabel;
  mpesaMode.classList.toggle('text-emerald-600', status.mpesa.mode === 'live');
  mpesaMode.classList.toggle('text-amber-600', status.mpesa.mode !== 'live');
  mpesaDetails.textContent = `Env: ${status.mpesa.environment}. Configured: ${status.mpesa.configured ? 'Yes' : 'No'}. Callback URL: ${status.mpesa.callbackUrlSet ? 'Set' : 'Missing'}.`;

  smsMode.textContent = smsLabel;
  smsMode.classList.toggle('text-emerald-600', status.sms.mode === 'live');
  smsMode.classList.toggle('text-amber-600', status.sms.mode !== 'live');
  smsDetails.textContent = `Provider: ${status.sms.provider}. Configured: ${status.sms.configured ? 'Yes' : 'No'}. Sender ID: ${status.sms.senderIdSet ? 'Set' : 'Not set'}.`;
}

async function loadIntegrationStatus() {
  const status = await adminApi('/api/admin/integration-status');
  renderIntegrationStatus(status);
}

async function validateAdminKey() {
  const result = await adminApi('/api/admin/auth-check');
  return Boolean(result);
}

async function loadCustomers() {
  const result = await adminApi('/api/admin/customers');
  const tbody = document.querySelector('#customersTable tbody');
  tbody.innerHTML = '';

  for (const customer of result.customers) {
    const tr = document.createElement('tr');
    tr.className = 'transition hover:bg-aqua-50/70';
    tr.innerHTML = `
      <td class="px-4 py-3 font-medium text-slate-700">${escapeHtml(customer.fullName)}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(customer.phone)}</td>
      <td class="px-4 py-3 text-slate-600">${customer.transactionCount}</td>
      <td class="px-4 py-3 text-slate-600">KES ${customer.totalSpent}</td>
      <td class="px-4 py-3 text-slate-600">${formatDate(customer.lastActivityAt)}</td>
    `;
    tbody.appendChild(tr);
  }

  setText('adminResult', `Loaded ${result.customers.length} customer(s).`);
  showToast('Customers loaded');
}

async function loadPendingManualPayments() {
  const result = await adminApi('/api/admin/payments/pending-manual');
  const tbody = document.querySelector('#pendingManualTable tbody');
  tbody.innerHTML = '';

  if (!result.pendingPayments.length) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="px-4 py-4 text-slate-500" colspan="6">No pending manual payments.</td>';
    tbody.appendChild(tr);
    setText('adminResult', 'No pending manual payments.');
    return;
  }

  for (const payment of result.pendingPayments) {
    const tr = document.createElement('tr');
    tr.className = 'transition hover:bg-aqua-50/70';
    tr.innerHTML = `
      <td class="px-4 py-3 font-medium text-slate-700">${escapeHtml(payment.customerName || 'Unknown')}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(payment.phone)}</td>
      <td class="px-4 py-3 text-slate-600">KES ${payment.amount}</td>
      <td class="px-4 py-3 font-mono text-xs text-slate-700">${escapeHtml(payment.mpesaReceiptSubmitted || payment.mpesaReceipt || '-')}</td>
      <td class="px-4 py-3 text-slate-600">${formatDate(payment.createdAt)}</td>
      <td class="px-4 py-3">
        <div class="flex flex-wrap gap-2">
          <button data-action="approve" data-id="${escapeHtml(payment.id)}" class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500">Approve</button>
          <button data-action="reject" data-id="${escapeHtml(payment.id)}" class="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500">Reject</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  setText('adminResult', `Loaded ${result.pendingPayments.length} pending manual payment(s).`);
}

async function approvePendingManualPayment(paymentId) {
  await adminApi(`/api/admin/payments/${paymentId}/manual-approve`, { method: 'POST' });
  showToast('Manual payment approved');
  await loadPendingManualPayments();
  await loadCustomers();
}

async function rejectPendingManualPayment(paymentId) {
  const reason = window.prompt('Reason for rejection:', 'Verification failed');
  if (reason === null) {
    return;
  }

  await adminApi(`/api/admin/payments/${paymentId}/manual-reject`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason.trim() || 'Verification failed' })
  });

  showToast('Manual payment rejected');
  await loadPendingManualPayments();
}

document.getElementById('adminLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const loginButton = document.getElementById('loginButton');
  const enteredKey = document.getElementById('adminKey').value.trim();

  if (!enteredKey) {
    setText('authResult', 'Admin key is required', true);
    return;
  }

  try {
    setButtonLoading(loginButton, true, 'Authenticating...');
    adminKey = enteredKey;
    await validateAdminKey();
    sessionStorage.setItem(ADMIN_KEY_STORAGE, enteredKey);
    setText('authResult', 'Authenticated successfully');
    setAdminPanelVisibility(true);
    await loadIntegrationStatus();
    await loadCustomers();
    await loadPendingManualPayments();
    showToast('Admin login successful');
  } catch (error) {
    adminKey = '';
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    setAdminPanelVisibility(false);
    setText('authResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(loginButton, false);
  }
});

document.getElementById('loadCustomers').addEventListener('click', async () => {
  const button = document.getElementById('loadCustomers');
  try {
    setButtonLoading(button, true, 'Loading...');
    await loadCustomers();
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(button, false);
  }
});

document.getElementById('refreshStatus').addEventListener('click', async () => {
  const button = document.getElementById('refreshStatus');
  try {
    setButtonLoading(button, true, 'Refreshing...');
    await loadIntegrationStatus();
    showToast('Integration status refreshed');
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(button, false);
  }
});

document.getElementById('loadPendingManual').addEventListener('click', async () => {
  const button = document.getElementById('loadPendingManual');
  try {
    setButtonLoading(button, true, 'Loading...');
    await loadPendingManualPayments();
    showToast('Pending manual payments loaded');
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(button, false);
  }
});

document.querySelector('#pendingManualTable tbody').addEventListener('click', async (event) => {
  const actionButton = event.target.closest('button[data-action]');
  if (!actionButton) {
    return;
  }

  const { action, id } = actionButton.dataset;
  if (!action || !id) {
    return;
  }

  try {
    setButtonLoading(actionButton, true, action === 'approve' ? 'Approving...' : 'Rejecting...');
    if (action === 'approve') {
      await approvePendingManualPayment(id);
    } else if (action === 'reject') {
      await rejectPendingManualPayment(id);
    }
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(actionButton, false);
  }
});

document.getElementById('removeInactive').addEventListener('click', async () => {
  const button = document.getElementById('removeInactive');
  try {
    setButtonLoading(button, true, 'Dissolving...');
    const result = await adminApi('/api/admin/customers/inactive?years=2', {
      method: 'DELETE'
    });
    setText('adminResult', result.message);
    showToast(result.message);
    await loadCustomers();
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(button, false);
  }
});

document.getElementById('logoutButton').addEventListener('click', () => {
  adminKey = '';
  sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  document.getElementById('adminKey').value = '';
  setText('authResult', 'Logged out');
  setText('adminResult', '');
  document.querySelector('#customersTable tbody').innerHTML = '';
  document.querySelector('#pendingManualTable tbody').innerHTML = '';
  renderIntegrationStatus(null);
  setAdminPanelVisibility(false);
  showToast('Logged out');
});

(async function restoreAdminSession() {
  if (!adminKey) {
    setAdminPanelVisibility(false);
    return;
  }

  try {
    await validateAdminKey();
    setText('authResult', 'Authenticated from active session');
    setAdminPanelVisibility(true);
    await loadIntegrationStatus();
    await loadCustomers();
    await loadPendingManualPayments();
  } catch {
    adminKey = '';
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    renderIntegrationStatus(null);
    setAdminPanelVisibility(false);
  }
})();

initMobileMenu();
initThemeToggle();
