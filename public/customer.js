async function api(path, options = {}) {
  const apiBaseUrl = window.APP_CONFIG?.apiBaseUrl || '';
  const requestUrl = apiBaseUrl ? new URL(path, apiBaseUrl).toString() : path;

  const response = await fetch(requestUrl, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

const THEME_STORAGE = 'aqualineTheme';

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

async function loadPricing() {
  try {
    const pricing = await api('/api/pricing');
    const el = document.getElementById('pricing');
    if (el) {
      el.textContent = `Pricing: KES ${pricing.perLitre}/litre or KES ${pricing.per1000Litre}/1000 litres`;
    }
  } catch (error) {
    showToast(error.message, true);
  }
}

function validateClientPhone(rawPhone) {
  if (!rawPhone) return 'Phone number is required.';
  const cleaned = String(rawPhone).trim().replace(/[\s\-\(\)\.]/g, '');
  if (!/^\+?\d+$/.test(cleaned)) return 'Phone number must only contain digits.';

  const digits = cleaned.replace(/^\+/, '');
  let core = '';
  if (digits.startsWith('254') && digits.length === 12) core = digits.slice(3);
  else if (digits.startsWith('0') && digits.length === 10) core = digits.slice(1);
  else if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('1'))) core = digits;
  else return 'Please enter a valid 10-digit Kenyan mobile number (e.g. 07XXXXXXXX or 01XXXXXXXX).';

  if (!/^[17]\d{8}$/.test(core)) return 'Kenyan mobile numbers must start with 07 or 01.';
  const fullLocal = `0${core}`;
  if (/^(\d)\1+$/.test(fullLocal) || /^(\d)\1+$/.test(core)) return 'Repeated dummy numbers (e.g. 0000000000) are not permitted.';
  if (new Set(core.split('')).size < 3) return 'Please enter a genuine active phone number.';

  return null;
}

document.getElementById('registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitBtn = event.target.querySelector('button[type="submit"]');
  const formData = new FormData(event.target);
  const fullName = String(formData.get('fullName') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const email = String(formData.get('email') || '').trim().toLowerCase();

  if (fullName.length < 3) {
    setText('registerResult', 'Full Name must be at least 3 characters.', true);
    showToast('Full Name must be at least 3 characters', true);
    return;
  }

  const phoneError = validateClientPhone(phone);
  if (phoneError) {
    setText('registerResult', phoneError, true);
    showToast(phoneError, true);
    return;
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setText('registerResult', 'Please enter a valid email address.', true);
    showToast('Please enter a valid email address', true);
    return;
  }

  const payload = { fullName, phone, email };

  try {
    setButtonLoading(submitBtn, true, 'Registering...');
    const result = await api('/api/customers/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const emailNotice = result.email ? ` • OTP Sent to: ${result.email}` : '';
    const codeNotice = result.loginCode ? ` • Code: ${result.loginCode}` : '';
    setText('registerResult', `Registered: ${result.customer.fullName} (${result.customer.phone})${codeNotice}${emailNotice}`);
    showToast(`Registered successfully! OTP sent to ${result.email || result.customer.phone}`);
    event.target.reset();
  } catch (error) {
    setText('registerResult', error.message, true);
    showToast(error.message, true);
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

loadPricing();
initMobileMenu();
initThemeToggle();
