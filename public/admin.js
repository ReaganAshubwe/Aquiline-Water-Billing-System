const ADMIN_KEY_STORAGE = 'aqualineAdminKey';
const ADMIN_ACTOR_STORAGE = 'aqualineAdminActor';
const APPROVER_KEY_STORAGE = 'aqualineApproverKey';
const THEME_STORAGE = 'aqualineTheme';
let adminKey = sessionStorage.getItem(ADMIN_KEY_STORAGE) || '';
let adminActor = sessionStorage.getItem(ADMIN_ACTOR_STORAGE) || 'admin';
let approverKey = sessionStorage.getItem(APPROVER_KEY_STORAGE) || '';

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

function formatMoney(value) {
  const amount = Number(value || 0);
  return `KES ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAdminHeaders(extraHeaders = {}) {
  return {
    'Content-Type': 'application/json',
    'x-admin-key': adminKey,
    'x-admin-actor': adminActor,
    ...(approverKey ? { 'x-approver-key': approverKey } : {}),
    ...extraHeaders
  };
}

function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

async function adminApi(path, options = {}) {
  const apiBaseUrl = window.APP_CONFIG?.apiBaseUrl || '';
  const requestUrl = apiBaseUrl ? new URL(path, apiBaseUrl).toString() : path;

  const response = await fetch(requestUrl, {
    headers: buildAdminHeaders(options.headers || {}),
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

function renderFinanceOverview(overview) {
  document.getElementById('balanceCollections').textContent = formatMoney(overview.balances.collections);
  document.getElementById('balanceOperations').textContent = formatMoney(overview.balances.operations);
  document.getElementById('balanceSavings').textContent = formatMoney(overview.balances.savings);

  document.getElementById('financePolicyText').textContent =
    `Split: ${overview.policy.savingsPercent}% savings / ${overview.policy.operationsPercent}% operations. Minimum operations float: ${formatMoney(overview.policy.minOperationsFloat)}.`;
  document.getElementById('financeMetaText').textContent =
    `Unsettled paid tx: ${overview.unsettledCount}. Pending refund approvals: ${overview.totals.pendingRefundApprovals}. Total settlements: ${overview.totals.settlements}. Total refunds: ${overview.totals.refunds} (${formatMoney(overview.totals.refundedAmount)}).`;

  const settlementsBody = document.querySelector('#settlementsTable tbody');
  settlementsBody.innerHTML = '';
  if (!overview.recentSettlements.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="px-4 py-4 text-slate-500" colspan="5">No settlements recorded yet.</td>';
    settlementsBody.appendChild(tr);
  } else {
    for (const settlement of overview.recentSettlements) {
      const tr = document.createElement('tr');
      tr.className = 'transition hover:bg-aqua-50/70';
      tr.innerHTML = `
        <td class="px-4 py-3 font-mono text-xs text-slate-700">${escapeHtml(settlement.paymentId)}</td>
        <td class="px-4 py-3 text-slate-600">${formatMoney(settlement.totalAmount)}</td>
        <td class="px-4 py-3 text-slate-600">${formatMoney(settlement.savingsAmount)}</td>
        <td class="px-4 py-3 text-slate-600">${formatMoney(settlement.operationsAmount)}</td>
        <td class="px-4 py-3 text-slate-600">${formatDate(settlement.createdAt)}</td>
      `;
      settlementsBody.appendChild(tr);
    }
  }

  const refundsBody = document.querySelector('#refundsTable tbody');
  refundsBody.innerHTML = '';
  if (!overview.recentRefunds.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="px-4 py-4 text-slate-500" colspan="6">No refunds recorded yet.</td>';
    refundsBody.appendChild(tr);
  } else {
    for (const refund of overview.recentRefunds) {
      const tr = document.createElement('tr');
      tr.className = 'transition hover:bg-aqua-50/70';
      tr.innerHTML = `
        <td class="px-4 py-3 font-medium text-slate-700">${escapeHtml(refund.customerName || 'Unknown')}</td>
        <td class="px-4 py-3 font-mono text-xs text-slate-700">${escapeHtml(refund.paymentId)}</td>
        <td class="px-4 py-3 text-slate-600">${formatMoney(refund.amount)}</td>
        <td class="px-4 py-3 text-slate-600">${escapeHtml(refund.status || '-')}</td>
        <td class="px-4 py-3 text-slate-600">${escapeHtml(refund.reason || '-')}</td>
        <td class="px-4 py-3 text-slate-600">${formatDate(refund.createdAt)}</td>
      `;
      refundsBody.appendChild(tr);
    }
  }
}

async function loadFinanceOverview() {
  const overview = await adminApi('/api/admin/finance/overview');
  renderFinanceOverview(overview);
}

async function loadRefunds() {
  const result = await adminApi('/api/admin/refunds?limit=30');
  const tbody = document.querySelector('#refundsTable tbody');
  tbody.innerHTML = '';

  if (!result.refunds.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="px-4 py-4 text-slate-500" colspan="6">No refunds recorded yet.</td>';
    tbody.appendChild(tr);
    setText('adminResult', 'No refunds found.');
    return;
  }

  for (const refund of result.refunds) {
    const tr = document.createElement('tr');
    tr.className = 'transition hover:bg-aqua-50/70';
    tr.innerHTML = `
      <td class="px-4 py-3 font-medium text-slate-700">${escapeHtml(refund.customerName || 'Unknown')}</td>
      <td class="px-4 py-3 font-mono text-xs text-slate-700">${escapeHtml(refund.paymentId)}</td>
      <td class="px-4 py-3 text-slate-600">${formatMoney(refund.amount)}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(refund.status || '-')}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(refund.reason || '-')}</td>
      <td class="px-4 py-3 text-slate-600">${formatDate(refund.createdAt)}</td>
    `;
    tbody.appendChild(tr);
  }

  setText('adminResult', `Loaded ${result.refunds.length} refund(s).`);
}

async function requestRefund(paymentId, maxRefundable) {
  const suggested = Number(maxRefundable || 0).toFixed(2);
  const amountInput = window.prompt(`Refund amount (max ${suggested}):`, suggested);
  if (amountInput === null) {
    return;
  }
  const amount = Number(amountInput);
  if (Number.isNaN(amount) || amount <= 0) {
    throw new Error('Enter a valid refund amount');
  }

  const reasonInput = window.prompt('Reason for refund:', 'Customer refund');
  if (reasonInput === null) {
    return;
  }

  const result = await adminApi('/api/admin/refunds', {
    method: 'POST',
    body: JSON.stringify({
      paymentId,
      amount,
      reason: reasonInput.trim() || 'Customer refund'
    })
  });

  showToast(result.message || 'Refund request created');
  await loadFinanceOverview();
  await loadRecentTransactions();
  await loadPendingRefundApprovals();
}

async function loadPendingRefundApprovals() {
  const result = await adminApi('/api/admin/refunds/pending?limit=30');
  const tbody = document.querySelector('#pendingRefundApprovalsTable tbody');
  tbody.innerHTML = '';

  if (!result.pending.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="px-4 py-4 text-slate-500" colspan="7">No pending refund approvals.</td>';
    tbody.appendChild(tr);
    setText('adminResult', 'No pending refund approvals.');
    return;
  }

  for (const request of result.pending) {
    const tr = document.createElement('tr');
    tr.className = 'transition hover:bg-aqua-50/70';
    tr.innerHTML = `
      <td class="px-4 py-3 font-medium text-slate-700">${escapeHtml(request.customerName || 'Unknown')}</td>
      <td class="px-4 py-3 font-mono text-xs text-slate-700">${escapeHtml(request.paymentId)}</td>
      <td class="px-4 py-3 text-slate-600">${formatMoney(request.amount)}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(request.requestedBy || '-')}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(request.reason || '-')}</td>
      <td class="px-4 py-3 text-slate-600">${formatDate(request.createdAt)}</td>
      <td class="px-4 py-3">
        <button data-action="approve-refund" data-id="${escapeHtml(request.id)}" class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500">Approve</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  setText('adminResult', `Loaded ${result.pending.length} pending refund approval(s).`);
}

async function approveRefundRequest(refundId) {
  const approverActor = window.prompt('Approver actor name (must differ from requester):', adminActor === 'admin' ? 'supervisor' : 'admin');
  if (approverActor === null) {
    return;
  }

  const approverValue = approverActor.trim() || 'approver';
  const approverKeyInput = window.prompt('Approver key (leave blank if not configured on server):', approverKey || '');
  if (approverKeyInput === null) {
    return;
  }

  const trimmedKey = approverKeyInput.trim();
  if (trimmedKey) {
    approverKey = trimmedKey;
    sessionStorage.setItem(APPROVER_KEY_STORAGE, approverKey);
  }

  await adminApi(`/api/admin/refunds/${refundId}/approve`, {
    method: 'POST',
    headers: {
      'x-admin-actor': approverValue,
      ...(trimmedKey ? { 'x-approver-key': trimmedKey } : {})
    }
  });

  showToast('Refund approved');
  await loadFinanceOverview();
  await loadRecentTransactions();
  await loadPendingRefundApprovals();
  await loadRefunds();
}

async function loadLedger() {
  const result = await adminApi('/api/admin/finance/ledger?limit=80');
  const tbody = document.querySelector('#ledgerTable tbody');
  tbody.innerHTML = '';

  if (!result.entries.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="px-4 py-4 text-slate-500" colspan="7">No ledger entries found.</td>';
    tbody.appendChild(tr);
    setText('adminResult', 'No ledger entries found.');
    return;
  }

  for (const entry of result.entries) {
    const tr = document.createElement('tr');
    tr.className = 'transition hover:bg-aqua-50/70';
    tr.innerHTML = `
      <td class="px-4 py-3 text-slate-600">${escapeHtml(entry.type)}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(entry.account)}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(entry.direction)}</td>
      <td class="px-4 py-3 text-slate-600">${formatMoney(entry.amount)}</td>
      <td class="px-4 py-3 font-mono text-xs text-slate-700">${escapeHtml(entry.referenceId || '-')}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(entry.note || '-')}</td>
      <td class="px-4 py-3 text-slate-600">${formatDate(entry.createdAt)}</td>
    `;
    tbody.appendChild(tr);
  }

  setText('adminResult', `Loaded ${result.entries.length} ledger entr${result.entries.length === 1 ? 'y' : 'ies'}.`);
}

async function loadCustomers() {
  const result = await adminApi('/api/admin/customers');
  const tbody = document.querySelector('#customersTable tbody');
  tbody.innerHTML = '';

  if (!result.customers.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="px-4 py-4 text-slate-500" colspan="6">No customers found.</td>';
    tbody.appendChild(tr);
    setText('adminResult', 'No customers found.');
    return;
  }

  for (const customer of result.customers) {
    const tr = document.createElement('tr');
    tr.className = 'transition hover:bg-aqua-50/70';
    tr.innerHTML = `
      <td class="px-4 py-3 font-medium text-slate-700">${escapeHtml(customer.fullName)}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(customer.phone)}</td>
      <td class="px-4 py-3 text-slate-600">${customer.transactionCount}</td>
      <td class="px-4 py-3 text-slate-600">KES ${customer.totalSpent}</td>
      <td class="px-4 py-3 text-slate-600">${formatDate(customer.lastActivityAt)}</td>
      <td class="px-4 py-3">
        <button
          data-action="delete-customer"
          data-id="${escapeHtml(customer.id)}"
          data-name="${escapeHtml(customer.fullName)}"
          class="rounded-lg border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100"
        >
          Delete
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  setText('adminResult', `Loaded ${result.customers.length} customer(s).`);
  showToast('Customers loaded');
}

async function deleteCustomer(customerId) {
  return adminApi(`/api/admin/customers/${customerId}`, { method: 'DELETE' });
}

async function sendCustomersReport() {
  const apiBaseUrl = window.APP_CONFIG?.apiBaseUrl || '';
  const requestUrl = apiBaseUrl ? new URL('/api/admin/customers/report', apiBaseUrl).toString() : '/api/admin/customers/report';
  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: buildAdminHeaders()
  });
  const reportText = await response.text();

  if (!response.ok) {
    throw new Error(reportText || 'Request failed');
  }

  const dateStamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`customers-report-${dateStamp}.csv`, reportText, 'text/csv;charset=utf-8');
}

const STATUS_CONFIG = {
  paid:            { label: 'Paid',            classes: 'bg-emerald-100 text-emerald-800' },
  failed:          { label: 'Failed',          classes: 'bg-red-100 text-red-700' },
  pending:         { label: 'Pending',         classes: 'bg-amber-100 text-amber-700' },
  pending_manual:  { label: 'Pending (Manual)',classes: 'bg-amber-100 text-amber-700' },
  rejected_manual: { label: 'Rejected',        classes: 'bg-red-100 text-red-700' }
};

async function loadRecentTransactions() {
  const result = await adminApi('/api/admin/payments/recent?limit=50');
  const tbody = document.querySelector('#recentTransactionsTable tbody');
  tbody.innerHTML = '';

  if (!result.transactions.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="px-4 py-4 text-slate-500" colspan="8">No transactions found.</td>';
    tbody.appendChild(tr);
    setText('adminResult', 'No transactions found.');
    return;
  }

  for (const tx of result.transactions) {
    const cfg = STATUS_CONFIG[tx.status] || { label: tx.status, classes: 'bg-slate-100 text-slate-700' };
    const receiptOrToken = tx.mpesaReceipt
      ? escapeHtml(tx.mpesaReceipt)
      : tx.tokenCode
        ? `Token: ${escapeHtml(tx.tokenCode)}`
        : '-';
    const channelLabel = tx.paymentChannel === 'manual_till' ? 'Till (Manual)' : 'M-Pesa STK';
    const failNote = tx.failureReason ? `<br><span class="text-xs text-red-500">${escapeHtml(tx.failureReason)}</span>` : '';
    const refundedNote = tx.refundedAmount > 0
      ? `<br><span class="text-xs text-amber-700">Refunded: ${formatMoney(tx.refundedAmount)} (${escapeHtml(tx.refundStatus || 'partial')})</span>`
      : '';
    const refundable = Math.max(Number(tx.amount || 0) - Number(tx.refundedAmount || 0), 0);
    const refundAction = tx.status === 'paid' && refundable > 0
      ? `<button data-action="refund" data-id="${escapeHtml(tx.id)}" data-max-refund="${refundable}" class="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 transition hover:bg-amber-100">Refund</button>`
      : '<span class="text-xs text-slate-400">-</span>';

    const tr = document.createElement('tr');
    tr.className = 'transition hover:bg-aqua-50/70';
    tr.innerHTML = `
      <td class="px-4 py-3 font-medium text-slate-700">${escapeHtml(tx.customerName)}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(tx.phone)}</td>
      <td class="px-4 py-3 text-slate-600">KES ${tx.amount}</td>
      <td class="px-4 py-3">
        <span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg.classes}">${cfg.label}</span>
        ${failNote}
        ${refundedNote}
      </td>
      <td class="px-4 py-3 text-slate-600">${channelLabel}</td>
      <td class="px-4 py-3 font-mono text-xs text-slate-700">${receiptOrToken}</td>
      <td class="px-4 py-3 text-slate-600">${formatDate(tx.updatedAt || tx.createdAt)}</td>
      <td class="px-4 py-3">${refundAction}</td>
    `;
    tbody.appendChild(tr);
  }

  setText('adminResult', `Loaded ${result.transactions.length} recent transaction(s).`);
  showToast('Recent transactions loaded');
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
  await adminApi(`/api/admin/payments/${paymentId}/manual-reject`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Verification failed' })
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
    adminActor = adminActor.trim() || 'admin';
    sessionStorage.setItem(ADMIN_KEY_STORAGE, enteredKey);
    sessionStorage.setItem(ADMIN_ACTOR_STORAGE, adminActor);
    setText('authResult', 'Authenticated successfully');
    setAdminPanelVisibility(true);
    await loadIntegrationStatus();
    await loadFinanceOverview();
    await loadCustomers();
    await loadRecentTransactions();
    await loadPendingRefundApprovals();
    await loadLedger();
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

document.getElementById('sendCustomersReport').addEventListener('click', async () => {
  const button = document.getElementById('sendCustomersReport');
  try {
    setButtonLoading(button, true, 'Generating...');
    await sendCustomersReport();
    setText('adminResult', 'Customers report downloaded.');
    showToast('Customers report generated');
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(button, false);
  }
});

document.querySelector('#customersTable tbody').addEventListener('click', async (event) => {
  const actionButton = event.target.closest('button[data-action="delete-customer"]');
  if (!actionButton) {
    return;
  }

  const customerName = actionButton.dataset.name || 'this customer';
  const customerId = actionButton.dataset.id;

  if (!window.confirm(`Delete ${customerName} from the system? This will remove the customer record and related payments.`)) {
    return;
  }

  try {
    setButtonLoading(actionButton, true, 'Deleting...');
    const result = await deleteCustomer(customerId);
    setText('adminResult', result.message);
    showToast(result.message);
    await loadCustomers();
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(actionButton, false);
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

document.querySelector('#recentTransactionsTable tbody').addEventListener('click', async (event) => {
  const actionButton = event.target.closest('button[data-action="refund"]');
  if (!actionButton) {
    return;
  }

  try {
    setButtonLoading(actionButton, true, 'Refunding...');
    const paymentId = actionButton.dataset.id;
    const maxRefund = Number(actionButton.dataset.maxRefund || 0);
    if (!paymentId) {
      throw new Error('Missing payment ID for refund');
    }
    await requestRefund(paymentId, maxRefund);
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(actionButton, false);
  }
});

document.querySelector('#pendingRefundApprovalsTable tbody').addEventListener('click', async (event) => {
  const actionButton = event.target.closest('button[data-action="approve-refund"]');
  if (!actionButton) {
    return;
  }

  try {
    setButtonLoading(actionButton, true, 'Approving...');
    const refundId = actionButton.dataset.id;
    if (!refundId) {
      throw new Error('Missing refund request ID');
    }

    await approveRefundRequest(refundId);
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(actionButton, false);
  }
});

async function handleLoadRecentTransactions(button) {
  try {
    setButtonLoading(button, true, 'Loading...');
    await loadRecentTransactions();
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(button, false);
  }
}

document.getElementById('loadRecentTransactions').addEventListener('click', () => {
  handleLoadRecentTransactions(document.getElementById('loadRecentTransactions'));
});

document.getElementById('loadRecentTransactionsTable').addEventListener('click', () => {
  handleLoadRecentTransactions(document.getElementById('loadRecentTransactionsTable'));
});

document.getElementById('refreshFinance').addEventListener('click', async () => {
  const button = document.getElementById('refreshFinance');
  try {
    setButtonLoading(button, true, 'Refreshing...');
    await loadFinanceOverview();
    showToast('Finance overview refreshed');
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(button, false);
  }
});

document.getElementById('settleUnsettled').addEventListener('click', async () => {
  const button = document.getElementById('settleUnsettled');
  try {
    setButtonLoading(button, true, 'Settling...');
    const result = await adminApi('/api/admin/finance/settle-unsettled-payments', {
      method: 'POST'
    });
    setText('adminResult', result.message);
    showToast(result.message);
    await loadFinanceOverview();
    await loadRecentTransactions();
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(button, false);
  }
});

document.getElementById('topupOperations').addEventListener('click', async () => {
  const button = document.getElementById('topupOperations');
  try {
    const amountInput = window.prompt('Top-up amount from collections to operations:', '1000');
    if (amountInput === null) {
      return;
    }

    const amount = Number(amountInput);
    if (Number.isNaN(amount) || amount <= 0) {
      throw new Error('Enter a valid top-up amount');
    }

    const reasonInput = window.prompt('Reason for top-up:', 'Operations float refill');
    if (reasonInput === null) {
      return;
    }

    setButtonLoading(button, true, 'Topping up...');
    const result = await adminApi('/api/admin/finance/top-up-operations', {
      method: 'POST',
      body: JSON.stringify({ amount, reason: reasonInput.trim() || 'Operations top-up' })
    });

    setText('adminResult', result.message);
    showToast(result.message);
    await loadFinanceOverview();
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(button, false);
  }
});

document.getElementById('loadRefunds').addEventListener('click', async () => {
  const button = document.getElementById('loadRefunds');
  try {
    setButtonLoading(button, true, 'Loading...');
    await loadRefunds();
    showToast('Refunds loaded');
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(button, false);
  }
});

document.getElementById('loadPendingRefundApprovals').addEventListener('click', async () => {
  const button = document.getElementById('loadPendingRefundApprovals');
  try {
    setButtonLoading(button, true, 'Loading...');
    await loadPendingRefundApprovals();
    showToast('Pending refund approvals loaded');
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(button, false);
  }
});

document.getElementById('loadLedger').addEventListener('click', async () => {
  const button = document.getElementById('loadLedger');
  try {
    setButtonLoading(button, true, 'Loading...');
    await loadLedger();
    showToast('Ledger loaded');
  } catch (error) {
    setText('adminResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(button, false);
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
  adminActor = 'admin';
  approverKey = '';
  sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  sessionStorage.removeItem(ADMIN_ACTOR_STORAGE);
  sessionStorage.removeItem(APPROVER_KEY_STORAGE);
  document.getElementById('adminKey').value = '';
  setText('authResult', 'Logged out');
  setText('adminResult', '');
  document.querySelector('#customersTable tbody').innerHTML = '';
  document.querySelector('#settlementsTable tbody').innerHTML = '';
  document.querySelector('#refundsTable tbody').innerHTML = '';
  document.querySelector('#pendingRefundApprovalsTable tbody').innerHTML = '';
  document.querySelector('#ledgerTable tbody').innerHTML = '';
  document.querySelector('#recentTransactionsTable tbody').innerHTML = '';
  document.querySelector('#pendingManualTable tbody').innerHTML = '';
  document.getElementById('balanceCollections').textContent = 'KES 0';
  document.getElementById('balanceOperations').textContent = 'KES 0';
  document.getElementById('balanceSavings').textContent = 'KES 0';
  document.getElementById('financePolicyText').textContent = 'Settlement policy not loaded.';
  document.getElementById('financeMetaText').textContent = '-';
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
    await loadFinanceOverview();
    await loadCustomers();
    await loadRecentTransactions();
    await loadPendingRefundApprovals();
    await loadLedger();
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
