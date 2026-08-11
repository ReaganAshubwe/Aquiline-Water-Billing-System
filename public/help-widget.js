/**
 * Aqualine Water Billing - Help & Support Center Widget
 * Provides floating help button, interactive modal with multi-tab navigation,
 * real-time FAQ search, live water token cost calculator, and support inquiry form.
 */

(function () {
  'use strict';

  let helpModalElement = null;
  let activeTab = 'guide';
  let pricingData = { perLitre: 10, per1000Litre: 10000 };

  // Fetch live pricing for calculator
  async function fetchPricing() {
    try {
      const apiBaseUrl = window.APP_CONFIG?.apiBaseUrl || '';
      const url = apiBaseUrl ? new URL('/api/pricing', apiBaseUrl).toString() : '/api/pricing';
      const res = await fetch(url);
      if (res.ok) {
        pricingData = await res.json();
      }
    } catch (e) {
      console.warn('Could not load live pricing for help calculator:', e);
    }
  }

  // Inject Styles for Help Widget & Modal
  function injectStyles() {
    if (document.getElementById('aqualine-help-styles')) return;

    const style = document.createElement('style');
    style.id = 'aqualine-help-styles';
    style.textContent = `
      /* Help Floating Action Button */
      .aqualine-help-fab {
        position: fixed;
        bottom: 1.5rem;
        right: 1.5rem;
        z-index: 50;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
        color: #ffffff;
        border: 1.5px solid rgba(255, 255, 255, 0.4);
        padding: 0.75rem 1.15rem;
        border-radius: 9999px;
        font-weight: 700;
        font-size: 0.875rem;
        box-shadow: 0 10px 25px -5px rgba(2, 132, 199, 0.5), 0 8px 10px -6px rgba(2, 132, 199, 0.3);
        cursor: pointer;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(8px);
      }

      .aqualine-help-fab:hover {
        transform: translateY(-3px) scale(1.02);
        box-shadow: 0 14px 28px -4px rgba(2, 132, 199, 0.6), 0 10px 10px -5px rgba(2, 132, 199, 0.4);
        background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
      }

      .aqualine-help-fab:active {
        transform: translateY(0) scale(0.98);
      }

      .aqualine-help-fab .fab-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.35rem;
        height: 1.35rem;
        background: #ffffff;
        color: #0284c7;
        font-weight: 800;
        font-size: 0.75rem;
        border-radius: 9999px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.15);
      }

      /* Modal Backdrop & Container */
      .aqualine-help-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 100;
        background: rgba(15, 23, 42, 0.75);
        backdrop-filter: blur(6px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.25s ease, visibility 0.25s ease;
      }

      .aqualine-help-modal-backdrop.is-active {
        opacity: 1;
        visibility: visible;
      }

      .aqualine-help-modal {
        background: #ffffff;
        width: 100%;
        max-width: 44rem;
        max-height: 90vh;
        border-radius: 1.5rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(226, 232, 240, 0.8);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transform: scale(0.95) translateY(10px);
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .aqualine-help-modal-backdrop.is-active .aqualine-help-modal {
        transform: scale(1) translateY(0);
      }

      /* Dark Mode for Modal */
      body.dark-mode .aqualine-help-modal {
        background: #1e293b;
        color: #f1f5f9;
        border-color: #334155;
      }

      body.dark-mode .help-modal-header {
        background: #0f172a;
        border-color: #334155;
      }

      body.dark-mode .help-tab-btn {
        color: #94a3b8;
      }

      body.dark-mode .help-tab-btn.is-active {
        color: #38bdf8;
        border-bottom-color: #38bdf8;
        background: rgba(56, 189, 248, 0.08);
      }

      body.dark-mode .help-card {
        background: #0f172a !important;
        border-color: #334155 !important;
        color: #e2e8f0 !important;
      }

      body.dark-mode .help-input {
        background: #0f172a !important;
        border-color: #334155 !important;
        color: #f8fafc !important;
      }

      body.dark-mode .help-faq-item {
        background: #0f172a !important;
        border-color: #334155 !important;
      }

      /* Scrollbar */
      .help-custom-scroll::-webkit-scrollbar {
        width: 6px;
      }
      .help-custom-scroll::-webkit-scrollbar-track {
        background: transparent;
      }
      .help-custom-scroll::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 9999px;
      }
      body.dark-mode .help-custom-scroll::-webkit-scrollbar-thumb {
        background: #475569;
      }
    `;
    document.head.appendChild(style);
  }

  // Create Modal DOM Structure
  function createModalDOM() {
    if (document.getElementById('aqualineHelpModalBackdrop')) {
      return document.getElementById('aqualineHelpModalBackdrop');
    }

    const backdrop = document.createElement('div');
    backdrop.id = 'aqualineHelpModalBackdrop';
    backdrop.className = 'aqualine-help-modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'helpModalTitle');

    backdrop.innerHTML = `
      <div class="aqualine-help-modal" onclick="event.stopPropagation()">
        <!-- Header -->
        <div class="help-modal-header flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-cyan-700 text-white font-bold text-lg shadow-md">
              ?
            </div>
            <div>
              <h2 id="helpModalTitle" class="text-base font-bold text-slate-800 dark:text-slate-100 sm:text-lg">
                Help & Visitor Support Center
              </h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                Guides, FAQs, Rate Calculator & Live Assistance
              </p>
            </div>
          </div>
          <button
            id="closeHelpModalBtn"
            class="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200 transition"
            aria-label="Close help modal"
          >
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Navigation Tabs -->
        <div class="flex border-b border-slate-200 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800/60 px-4 text-xs font-bold overflow-x-auto">
          <button data-tab="guide" class="help-tab-btn is-active flex items-center gap-1.5 border-b-2 border-sky-600 px-4 py-3 text-sky-700 dark:text-sky-400 transition whitespace-nowrap">
            <span>📖</span> <span>How It Works</span>
          </button>
          <button data-tab="faqs" class="help-tab-btn flex items-center gap-1.5 border-b-2 border-transparent px-4 py-3 text-slate-600 dark:text-slate-400 transition whitespace-nowrap">
            <span>❓</span> <span>FAQs</span>
          </button>
          <button data-tab="calc" class="help-tab-btn flex items-center gap-1.5 border-b-2 border-transparent px-4 py-3 text-slate-600 dark:text-slate-400 transition whitespace-nowrap">
            <span>🧮</span> <span>Cost Calculator</span>
          </button>
          <button data-tab="contact" class="help-tab-btn flex items-center gap-1.5 border-b-2 border-transparent px-4 py-3 text-slate-600 dark:text-slate-400 transition whitespace-nowrap">
            <span>💬</span> <span>Contact Support</span>
          </button>
        </div>

        <!-- Body Content Area (Scrollable) -->
        <div class="help-custom-scroll flex-1 overflow-y-auto p-6 text-sm text-slate-700 dark:text-slate-200 space-y-6">
          
          <!-- TAB 1: GUIDE -->
          <div id="helpTabGuide" class="help-tab-content space-y-4">
            <div class="rounded-xl bg-sky-50 dark:bg-slate-800/80 p-4 border border-sky-100 dark:border-slate-700">
              <h3 class="font-bold text-sky-900 dark:text-sky-300 text-sm mb-1">Simple 4-Step Water Purchase Process</h3>
              <p class="text-xs text-slate-600 dark:text-slate-400">Follow these easy steps to purchase and dispense water automatically:</p>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="help-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div class="flex items-center gap-2 mb-2">
                  <span class="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-white font-bold text-xs">1</span>
                  <h4 class="font-bold text-slate-800 dark:text-slate-100">Register Account</h4>
                </div>
                <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Enter your <b>Full Name</b> and <b>M-Pesa Phone Number</b> on the home page. Registration is instantaneous.
                </p>
              </div>

              <div class="help-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div class="flex items-center gap-2 mb-2">
                  <span class="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-white font-bold text-xs">2</span>
                  <h4 class="font-bold text-slate-800 dark:text-slate-100">Make Payment</h4>
                </div>
                <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Log in with your phone or submit payment. Receive an instant <b>M-Pesa STK PIN prompt</b> or enter receipt code.
                </p>
              </div>

              <div class="help-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div class="flex items-center gap-2 mb-2">
                  <span class="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-white font-bold text-xs">3</span>
                  <h4 class="font-bold text-slate-800 dark:text-slate-100">Get Water Token</h4>
                </div>
                <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  You receive an <b>8-digit token code</b> instantly on-screen and via SMS message to your phone.
                </p>
              </div>

              <div class="help-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div class="flex items-center gap-2 mb-2">
                  <span class="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-white font-bold text-xs">4</span>
                  <h4 class="font-bold text-slate-800 dark:text-slate-100">Dispense Water</h4>
                </div>
                <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Type your 8-digit token code on the digital water dispenser keypad and press <b>#</b> to release water.
                </p>
              </div>
            </div>

            <div class="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-300 flex items-start gap-2">
              <span class="text-base">💡</span>
              <div>
                <b>Pro Tip:</b> Water tokens never expire until entered at the dispenser. You can review all past tokens in the 
                <a href="/customer.html" class="underline font-bold text-sky-700 dark:text-sky-400 hover:opacity-80">Customer Portal</a>.
              </div>
            </div>
          </div>

          <!-- TAB 2: FAQS -->
          <div id="helpTabFaqs" class="help-tab-content hidden space-y-3">
            <!-- Search Bar -->
            <div class="relative">
              <input
                id="helpFaqSearch"
                type="text"
                placeholder="Search FAQs (e.g. mpesa, token, refund, rates)..."
                class="help-input w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 pl-9 text-xs outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 transition"
              />
              <svg class="absolute left-3 top-3 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            <div id="faqList" class="space-y-2">
              <!-- Item 1 -->
              <details class="help-faq-item group rounded-xl border border-slate-200 bg-white p-3.5 transition" open>
                <summary class="flex cursor-pointer items-center justify-between font-bold text-slate-800 dark:text-slate-100 text-xs">
                  <span>What are the water pricing rates?</span>
                  <span class="text-sky-600 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <p class="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-2">
                  Pricing is standard: <b>KES 10 per single litre</b> or bulk rate of <b>KES 10,000 per 1,000 litres</b>. 
                  Tokens can be generated for any quantity from 1 litre upwards.
                </p>
              </details>

              <!-- Item 2 -->
              <details class="help-faq-item group rounded-xl border border-slate-200 bg-white p-3.5 transition">
                <summary class="flex cursor-pointer items-center justify-between font-bold text-slate-800 dark:text-slate-100 text-xs">
                  <span>I paid but didn't receive an SMS. Where is my token?</span>
                  <span class="text-sky-600 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <p class="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-2">
                  Your token is immediately displayed on your screen right after payment. You can also log into the 
                  <a href="/customer.html" class="underline font-semibold text-sky-600">Customer Portal</a> anytime to view your live token history.
                </p>
              </details>

              <!-- Item 3 -->
              <details class="help-faq-item group rounded-xl border border-slate-200 bg-white p-3.5 transition">
                <summary class="flex cursor-pointer items-center justify-between font-bold text-slate-800 dark:text-slate-100 text-xs">
                  <span>How does M-Pesa STK Push work?</span>
                  <span class="text-sky-600 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <p class="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-2">
                  When you initiate a purchase, a prompt appears on your phone asking for your M-Pesa PIN. Once entered, payment is confirmed automatically in 3-5 seconds.
                </p>
              </details>

              <!-- Item 4 -->
              <details class="help-faq-item group rounded-xl border border-slate-200 bg-white p-3.5 transition">
                <summary class="flex cursor-pointer items-center justify-between font-bold text-slate-800 dark:text-slate-100 text-xs">
                  <span>What if the water point is dry or dispenser fails?</span>
                  <span class="text-sky-600 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <p class="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-2">
                  You can request a full refund from your Customer Portal or contact support. Refunds are audited and processed directly back to your M-Pesa account.
                </p>
              </details>

              <!-- Item 5 -->
              <details class="help-faq-item group rounded-xl border border-slate-200 bg-white p-3.5 transition">
                <summary class="flex cursor-pointer items-center justify-between font-bold text-slate-800 dark:text-slate-100 text-xs">
                  <span>Do tokens expire?</span>
                  <span class="text-sky-600 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <p class="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-2">
                  Tokens remain active until fully dispensed. Each token is single-use and tied to your registered water account.
                </p>
              </details>
            </div>
            <p id="faqNoResults" class="hidden py-4 text-center text-xs text-slate-500">No matching questions found. Try another term or contact support.</p>
          </div>

          <!-- TAB 3: CALCULATOR -->
          <div id="helpTabCalc" class="help-tab-content hidden space-y-4">
            <div class="rounded-xl bg-sky-50 dark:bg-slate-800/80 p-4 border border-sky-100 dark:border-slate-700">
              <h3 class="font-bold text-sky-900 dark:text-sky-300 text-sm mb-1">Water Volume & Cost Estimator</h3>
              <p class="text-xs text-slate-600 dark:text-slate-400">Calculate exact token cost for required litres or see how much water your budget buys.</p>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div class="help-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                <label class="block text-xs font-bold text-slate-700 dark:text-slate-200">
                  Enter Litres Needed:
                  <input
                    id="calcLitresInput"
                    type="number"
                    min="1"
                    value="20"
                    class="help-input mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 transition"
                  />
                </label>
                <div class="flex flex-wrap gap-1.5">
                  <button type="button" onclick="window.setCalcLitres(10)" class="rounded-lg bg-sky-100 dark:bg-slate-700 px-2 py-1 text-[11px] font-bold text-sky-800 dark:text-sky-300 hover:bg-sky-200">+10L</button>
                  <button type="button" onclick="window.setCalcLitres(20)" class="rounded-lg bg-sky-100 dark:bg-slate-700 px-2 py-1 text-[11px] font-bold text-sky-800 dark:text-sky-300 hover:bg-sky-200">+20L (Jerrycan)</button>
                  <button type="button" onclick="window.setCalcLitres(50)" class="rounded-lg bg-sky-100 dark:bg-slate-700 px-2 py-1 text-[11px] font-bold text-sky-800 dark:text-sky-300 hover:bg-sky-200">+50L</button>
                  <button type="button" onclick="window.setCalcLitres(1000)" class="rounded-lg bg-sky-100 dark:bg-slate-700 px-2 py-1 text-[11px] font-bold text-sky-800 dark:text-sky-300 hover:bg-sky-200">+1,000L (Tank)</button>
                </div>
              </div>

              <div class="help-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                <label class="block text-xs font-bold text-slate-700 dark:text-slate-200">
                  Or Enter Budget (KES):
                  <input
                    id="calcBudgetInput"
                    type="number"
                    min="1"
                    value="200"
                    class="help-input mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 transition"
                  />
                </label>
                <div class="flex flex-wrap gap-1.5">
                  <button type="button" onclick="window.setCalcBudget(50)" class="rounded-lg bg-emerald-100 dark:bg-slate-700 px-2 py-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-200">KES 50</button>
                  <button type="button" onclick="window.setCalcBudget(100)" class="rounded-lg bg-emerald-100 dark:bg-slate-700 px-2 py-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-200">KES 100</button>
                  <button type="button" onclick="window.setCalcBudget(500)" class="rounded-lg bg-emerald-100 dark:bg-slate-700 px-2 py-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-200">KES 500</button>
                  <button type="button" onclick="window.setCalcBudget(1000)" class="rounded-lg bg-emerald-100 dark:bg-slate-700 px-2 py-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-200">KES 1,000</button>
                </div>
              </div>
            </div>

            <!-- Result Box -->
            <div class="rounded-2xl border border-sky-300 bg-gradient-to-r from-sky-500 to-cyan-600 p-4 text-white shadow-md">
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-xs uppercase tracking-wider font-semibold opacity-90">Calculated Water Amount</div>
                  <div id="calcVolumeDisplay" class="text-2xl font-black">20 Litres</div>
                </div>
                <div class="text-right">
                  <div class="text-xs uppercase tracking-wider font-semibold opacity-90">Estimated Total Cost</div>
                  <div id="calcCostDisplay" class="text-2xl font-black text-amber-300">KES 200.00</div>
                </div>
              </div>
              <div class="mt-2 border-t border-white/20 pt-2 text-[11px] opacity-85 flex justify-between">
                <span id="calcRateNotice">Rate: KES 10 / Litre</span>
                <span>Automatic Dispensing Token Included</span>
              </div>
            </div>
          </div>

          <!-- TAB 4: CONTACT & INQUIRY FORM -->
          <div id="helpTabContact" class="help-tab-content hidden space-y-4">
            <div class="grid gap-3 sm:grid-cols-3">
              <div class="help-card rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                <div class="text-lg">📞</div>
                <div class="text-xs font-bold text-slate-800 dark:text-slate-100 mt-1">Phone Line</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">+254 700 000 000</div>
              </div>
              <div class="help-card rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                <div class="text-lg">✉️</div>
                <div class="text-xs font-bold text-slate-800 dark:text-slate-100 mt-1">Support Email</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">aqualinesupport@gmail.com</div>
              </div>
              <div class="help-card rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                <div class="text-lg">📍</div>
                <div class="text-xs font-bold text-slate-800 dark:text-slate-100 mt-1">Head Office</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Nairobi, Kenya</div>
              </div>
            </div>

            <!-- Inquiry Form -->
            <form id="helpInquiryForm" class="help-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
              <h4 class="font-bold text-slate-800 dark:text-slate-100 text-xs">Send Instant Support Request:</h4>
              <div class="grid gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  name="name"
                  placeholder="Your Full Name"
                  required
                  class="help-input rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-sky-500 transition"
                />
                <input
                  type="text"
                  name="contact"
                  placeholder="Phone Number or Email"
                  required
                  class="help-input rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-sky-500 transition"
                />
              </div>
              <select
                name="subject"
                class="help-input w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-sky-500 transition"
              >
                <option value="Token Purchase Help">Token Purchase Assistance</option>
                <option value="SMS Delay / Missing Token">SMS Delay / Missing Token</option>
                <option value="Dispenser Hardware Issue">Dispenser Hardware Issue</option>
                <option value="Refund & Billing Request">Refund & Billing Request</option>
                <option value="General Inquiry">General Question / Feedback</option>
              </select>
              <textarea
                name="message"
                rows="3"
                placeholder="Describe your question or issue in detail..."
                required
                class="help-input w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-sky-500 transition"
              ></textarea>
              
              <button
                type="submit"
                id="helpInquirySubmitBtn"
                class="w-full rounded-xl bg-gradient-to-r from-sky-600 to-cyan-700 py-2.5 text-xs font-bold text-white shadow-sm hover:from-sky-500 hover:to-cyan-600 transition"
              >
                Submit Inquiry Ticket
              </button>
              <p id="helpInquiryResult" class="min-h-4 text-center text-xs font-semibold"></p>
            </form>
          </div>

        </div>

        <!-- Footer -->
        <div class="border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-6 py-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>Aqualine Water Billing Support 24/7</span>
          <button
            onclick="window.closeHelpModal()"
            class="font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400"
          >
            Close
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    return backdrop;
  }

  // Floating Action Button
  function createFloatingButton() {
    if (document.getElementById('aqualineHelpFab')) return;

    const btn = document.createElement('button');
    btn.id = 'aqualineHelpFab';
    btn.className = 'aqualine-help-fab';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Open Help & Support Center');
    btn.innerHTML = `
      <span class="fab-badge">?</span>
      <span>Need Help?</span>
    `;

    btn.addEventListener('click', () => {
      window.openHelpModal('guide');
    });

    document.body.appendChild(btn);
  }

  // Switch Active Tab
  function switchTab(tabName) {
    activeTab = tabName;
    const modal = document.getElementById('aqualineHelpModalBackdrop');
    if (!modal) return;

    // Tab buttons
    modal.querySelectorAll('.help-tab-btn').forEach((btn) => {
      const isTarget = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('is-active', isTarget);
      if (isTarget) {
        btn.classList.add('border-sky-600', 'text-sky-700', 'dark:text-sky-400');
        btn.classList.remove('border-transparent', 'text-slate-600');
      } else {
        btn.classList.remove('border-sky-600', 'text-sky-700', 'dark:text-sky-400');
        btn.classList.add('border-transparent', 'text-slate-600');
      }
    });

    // Tab contents
    const tabMap = {
      guide: 'helpTabGuide',
      faqs: 'helpTabFaqs',
      calc: 'helpTabCalc',
      contact: 'helpTabContact'
    };

    Object.entries(tabMap).forEach(([key, elementId]) => {
      const el = document.getElementById(elementId);
      if (el) {
        el.classList.toggle('hidden', key !== tabName);
      }
    });
  }

  // Calculator Logic
  function updateCalculatorFromLitres(litres) {
    const qty = Math.max(1, Number(litres) || 1);
    const cost = qty * (pricingData.perLitre || 10);

    const volEl = document.getElementById('calcVolumeDisplay');
    const costEl = document.getElementById('calcCostDisplay');
    const budgetInput = document.getElementById('calcBudgetInput');

    if (volEl) volEl.textContent = `${qty.toLocaleString()} Litre${qty > 1 ? 's' : ''}`;
    if (costEl) costEl.textContent = `KES ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    if (budgetInput && document.activeElement !== budgetInput) {
      budgetInput.value = cost;
    }
  }

  function updateCalculatorFromBudget(budget) {
    const amount = Math.max(1, Number(budget) || 1);
    const rate = pricingData.perLitre || 10;
    const litres = Math.floor(amount / rate);

    const volEl = document.getElementById('calcVolumeDisplay');
    const costEl = document.getElementById('calcCostDisplay');
    const litresInput = document.getElementById('calcLitresInput');

    if (volEl) volEl.textContent = `${litres.toLocaleString()} Litre${litres === 1 ? '' : 's'}`;
    if (costEl) costEl.textContent = `KES ${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    if (litresInput && document.activeElement !== litresInput) {
      litresInput.value = litres || 1;
    }
  }

  window.setCalcLitres = function (litres) {
    const input = document.getElementById('calcLitresInput');
    if (input) {
      input.value = litres;
      updateCalculatorFromLitres(litres);
    }
  };

  window.setCalcBudget = function (budget) {
    const input = document.getElementById('calcBudgetInput');
    if (input) {
      input.value = budget;
      updateCalculatorFromBudget(budget);
    }
  };

  // FAQ Instant Search
  function setupFaqSearch() {
    const searchInput = document.getElementById('helpFaqSearch');
    const faqList = document.getElementById('faqList');
    const noResults = document.getElementById('faqNoResults');
    if (!searchInput || !faqList) return;

    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const items = faqList.querySelectorAll('.help-faq-item');
      let visibleCount = 0;

      items.forEach((item) => {
        const text = item.textContent.toLowerCase();
        const matches = !q || text.includes(q);
        item.style.display = matches ? 'block' : 'none';
        if (matches) {
          visibleCount++;
          if (q) item.open = true;
        }
      });

      if (noResults) {
        noResults.classList.toggle('hidden', visibleCount > 0);
      }
    });
  }

  // Support Inquiry Form Submission
  function setupInquiryForm() {
    const form = document.getElementById('helpInquiryForm');
    const resultEl = document.getElementById('helpInquiryResult');
    const submitBtn = document.getElementById('helpInquirySubmitBtn');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const contactVal = formData.get('contact');
      const isEmail = contactVal.includes('@');

      const payload = {
        name: formData.get('name'),
        phone: isEmail ? '' : contactVal,
        email: isEmail ? contactVal : '',
        subject: formData.get('subject'),
        message: formData.get('message')
      };

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Submitting ticket...';
        }

        const apiBaseUrl = window.APP_CONFIG?.apiBaseUrl || '';
        const url = apiBaseUrl ? new URL('/api/help/inquiry', apiBaseUrl).toString() : '/api/help/inquiry';
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to submit inquiry');

        if (resultEl) {
          resultEl.className = 'text-emerald-600 dark:text-emerald-400 font-bold text-xs mt-2';
          resultEl.textContent = data.message || `Ticket #${data.ticketId} created successfully!`;
        }
        form.reset();
      } catch (err) {
        if (resultEl) {
          resultEl.className = 'text-rose-600 font-bold text-xs mt-2';
          resultEl.textContent = err.message;
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Inquiry Ticket';
        }
      }
    });
  }

  // Public Global API
  window.openHelpModal = function (tabName = 'guide') {
    const modal = createModalDOM();
    modal.classList.add('is-active');
    document.body.style.overflow = 'hidden';
    switchTab(tabName);
  };

  window.closeHelpModal = function () {
    const modal = document.getElementById('aqualineHelpModalBackdrop');
    if (modal) {
      modal.classList.remove('is-active');
      document.body.style.overflow = '';
    }
  };

  // Initialization
  function init() {
    injectStyles();
    fetchPricing();
    createFloatingButton();
    createModalDOM();

    // Event listeners
    const modal = document.getElementById('aqualineHelpModalBackdrop');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) window.closeHelpModal();
      });

      document.getElementById('closeHelpModalBtn')?.addEventListener('click', window.closeHelpModal);

      modal.querySelectorAll('.help-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          switchTab(btn.getAttribute('data-tab'));
        });
      });
    }

    // Keyboard escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.closeHelpModal();
      }
    });

    // Calculator inputs
    document.getElementById('calcLitresInput')?.addEventListener('input', (e) => {
      updateCalculatorFromLitres(e.target.value);
    });

    document.getElementById('calcBudgetInput')?.addEventListener('input', (e) => {
      updateCalculatorFromBudget(e.target.value);
    });

    setupFaqSearch();
    setupInquiryForm();

    // Bind any existing data-help-trigger elements
    document.querySelectorAll('[data-help-trigger]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = el.getAttribute('data-help-tab') || 'guide';
        window.openHelpModal(tab);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
