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

document.getElementById('registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitBtn = event.target.querySelector('button[type="submit"]');
  const formData = new FormData(event.target);
  const payload = {
    fullName: formData.get('fullName'),
    phone: formData.get('phone')
  };

  try {
    setButtonLoading(submitBtn, true, 'Registering...');
    const result = await api('/api/customers/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setText('registerResult', `Registered: ${result.customer.fullName} (${result.customer.phone})`);
    showToast('Customer registered successfully');
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
