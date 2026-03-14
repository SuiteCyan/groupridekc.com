/**
 * ═══════════════════════════════════════════════════════════════
 * GROUP RIDE KC – Universal Quote Engine
 * ═══════════════════════════════════════════════════════════════
 *
 * This self-contained module provides a complete quote form system
 * for both index.html and worldcup.html (via iframe).
 *
 * Usage:
 *   <div id="quote-form-container"></div>
 *   <script src="quote-engine.js"></script>
 *
 * The engine injects:
 *   - All CSS styling (booking form, payment, modal, autocomplete)
 *   - Complete form HTML (trip type, dates, locations, pricing)
 *   - Payment section (initially hidden)
 *   - Success modals
 *   - Full JavaScript state and API logic
 */

(function() {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     INJECT CSS
     ═══════════════════════════════════════════════════════════════ */

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    /* Booking Form Card */
    .booking-form-card {
      background: var(--card2); border: 1px solid var(--border);
      border-radius: 20px; padding: 36px;
    }
    .form-title { font-size: 1.3rem; font-weight: 700; margin-bottom: 6px; }
    .form-sub   { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 28px; }
    .form-row   { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media(max-width: 600px) { .form-row { grid-template-columns: 1fr; } }

    .form-group { margin-bottom: 18px; }
    .form-group label {
      display: block; font-size: 0.82rem; font-weight: 600;
      color: rgba(255,255,255,.7); margin-bottom: 6px;
    }
    .form-group input:not([type="checkbox"]),
    .form-group select,
    .form-group textarea {
      width: 100%; background: rgba(255,255,255,.05); border: 1px solid var(--border);
      border-radius: 8px; padding: 12px 14px; color: #fff; font-family: inherit;
      font-size: 0.9rem; transition: border-color .2s;
      -webkit-appearance: none;
    }
    .form-group input:not([type="checkbox"]):focus,
    .form-group select:focus,
    .form-group textarea:focus {
      outline: none; border-color: var(--gold);
    }
    .form-group input[type="checkbox"] {
      -webkit-appearance: none;
      appearance: none;
      width: 20px; height: 20px;
      border: 2px solid rgba(255,255,255,.35);
      border-radius: 4px;
      background: rgba(255,255,255,.05);
      cursor: pointer;
      position: relative;
      flex-shrink: 0;
      transition: all .2s;
    }
    .form-group input[type="checkbox"]:checked {
      background: var(--gold, #f5a623);
      border-color: var(--gold, #f5a623);
    }
    .form-group input[type="checkbox"]:checked::after {
      content: '✓';
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      color: #000;
      font-size: 14px;
      font-weight: 800;
      line-height: 1;
    }
    .form-group textarea { resize: vertical; min-height: 90px; }

    /* Vehicle Selector */
    .vehicle-selector { display: flex; gap: 12px; }
    .vehicle-opt {
      flex: 1; border: 2px solid var(--border); border-radius: 10px;
      padding: 14px 10px; text-align: center; cursor: pointer; transition: all .2s;
    }
    .vehicle-opt:hover { border-color: rgba(253,185,19,.5); }
    .vehicle-opt.selected { border-color: var(--gold); background: rgba(253,185,19,.07); }
    .vehicle-opt .vo-icon { font-size: 1.6rem; margin-bottom: 4px; }
    .vehicle-opt .vo-name { font-size: 0.8rem; font-weight: 600; }
    .vehicle-opt .vo-cap  { font-size: 0.72rem; color: var(--text-muted); }

    /* Form Dividers and Totals */
    .form-divider { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
    .form-total {
      display: flex; justify-content: space-between; align-items: center;
      background: rgba(253,185,19,.06); border-radius: 10px; padding: 14px 18px;
      margin-bottom: 20px;
    }
    .form-total-label { font-size: 0.85rem; color: var(--text-muted); }
    .form-total-price { font-size: 1.3rem; font-weight: 800; color: var(--gold); }
    .form-submit { width: 100%; padding: 16px; font-size: 1rem; border-radius: 10px; }

    /* Autocomplete Dropdown */
    .autocomplete-wrapper { position: relative; }
    .autocomplete-dropdown {
      display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 200;
      background: #1e1e1e; border: 1px solid var(--gold);
      border-radius: 0 0 10px 10px; overflow: hidden;
      box-shadow: 0 8px 24px rgba(0,0,0,.5);
    }
    .autocomplete-dropdown.open { display: block; }
    .ac-item {
      padding: 10px 14px; font-size: 0.82rem; cursor: pointer;
      border-bottom: 1px solid var(--border); transition: background .15s;
      display: flex; align-items: flex-start; gap: 8px;
    }
    .ac-item:last-child { border-bottom: none; }
    .ac-item:hover { background: rgba(253,185,19,.1); }
    .ac-icon { color: var(--gold); flex-shrink: 0; margin-top: 1px; }
    .ac-name { font-weight: 500; color: #fff; }
    .ac-addr { color: var(--text-muted); font-size: 0.75rem; }

    /* Availability Badge */
    #avail-status {
      border-radius: 8px; padding: 10px 14px; margin-bottom: 14px;
      font-size: 0.82rem; font-weight: 600; display: flex;
      align-items: center; gap: 8px;
    }
    #avail-status.avail-ok   { background: rgba(40,200,120,.12); border: 1px solid rgba(40,200,120,.3); color: #4ce0a0; }
    #avail-status.avail-no   { background: rgba(227,24,55,.12);  border: 1px solid rgba(227,24,55,.3);  color: #ff6b7a; }
    #avail-status.avail-load { background: rgba(253,185,19,.08); border: 1px solid rgba(253,185,19,.2); color: var(--gold); }
    .avail-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .avail-ok .avail-dot   { background: #4ce0a0; box-shadow: 0 0 6px #4ce0a0; }
    .avail-no .avail-dot   { background: #ff6b7a; box-shadow: 0 0 6px #ff6b7a; }
    .avail-load .avail-dot { background: var(--gold); animation: pulse 1s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

    /* Route Info Bar */
    #route-info {
      background: rgba(253,185,19,.07); border: 1px solid rgba(253,185,19,.2);
      border-radius: 8px; padding: 10px 14px; margin-bottom: 14px;
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    }
    .ri-item { display: flex; align-items: center; gap: 6px; font-size: 0.82rem; }
    .ri-label { color: var(--text-muted); }
    .ri-value { font-weight: 700; color: var(--gold); }

    /* Price Breakdown */
    .price-breakdown {
      background: rgba(255,255,255,.04); border: 1px solid var(--border);
      border-radius: 10px; padding: 14px 16px; margin-bottom: 16px;
    }
    .pb-row {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 0.82rem; padding: 4px 0;
    }
    .pb-row span:first-child { color: var(--text-muted); }
    .pb-row span:last-child  { font-weight: 600; }
    .pb-divider { border: none; border-top: 1px solid var(--border); margin: 8px 0; }
    .pb-total {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 0.95rem; padding: 2px 0;
    }
    .pb-total span:first-child { font-weight: 600; }
    .pb-total span:last-child  { font-size: 1.4rem; font-weight: 800; color: var(--gold); }
    .pb-note { font-size: 0.7rem; color: var(--text-muted); margin-top: 4px; }
    .pb-cal-note {
      margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border);
      font-size: 0.72rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px;
    }

    /* Payment Section */
    #qe-payment { padding: 100px 0; }
    .payment-inner {
      display: grid; grid-template-columns: 1fr 1fr; gap: 60px; align-items: start;
    }
    @media(max-width: 900px) { .payment-inner { grid-template-columns: 1fr; } }

    .payment-card {
      background: var(--card); border: 1px solid var(--border);
      border-radius: 20px; padding: 36px;
    }
    .payment-card h3 { font-size: 1.2rem; font-weight: 700; margin-bottom: 6px; }
    .payment-card .pay-sub { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 28px; }
    .pay-methods { display: flex; gap: 10px; margin-bottom: 24px; flex-wrap: wrap; }
    .pay-method {
      background: var(--card2); border: 1px solid var(--border); border-radius: 8px;
      padding: 10px 16px; font-size: 0.82rem; font-weight: 600;
      display: flex; align-items: center; gap: 6px; cursor: pointer; transition: all .2s;
    }
    .pay-method:hover, .pay-method.active { border-color: var(--gold); color: var(--gold); }

    .pay-secure {
      display: flex; align-items: center; gap: 8px; font-size: 0.78rem;
      color: var(--text-muted); margin-top: 16px;
    }
    .secure-icon { color: var(--gold); }
    .pay-btn { width: 100%; padding: 16px; font-size: 1rem; border-radius: 10px; margin-top: 20px; }
    .powered-by {
      text-align: center; font-size: 0.75rem; color: var(--text-muted); margin-top: 12px;
    }
    .powered-by span { color: var(--gold); font-weight: 600; }

    .payment-info { }
    .payment-steps { margin-top: 28px; display: flex; flex-direction: column; gap: 20px; }
    .pay-step {
      display: flex; gap: 16px; align-items: flex-start;
    }
    .pay-step-num {
      width: 32px; height: 32px; border-radius: 50%; background: var(--red);
      color: #fff; font-weight: 800; font-size: 0.85rem;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .pay-step-title { font-weight: 600; margin-bottom: 4px; }
    .pay-step-desc  { font-size: 0.83rem; color: var(--text-muted); }

    /* Calendar & Clock Icon Colors */
    input[type="date"]::-webkit-calendar-picker-indicator,
    input[type="time"]::-webkit-calendar-picker-indicator {
      filter: invert(1);
      cursor: pointer;
      opacity: 0.55;
    }

    /* Modal */
    .modal-overlay {
      display: none; position: fixed; inset: 0; z-index: 1000;
      background: rgba(0,0,0,.8); backdrop-filter: blur(6px);
      align-items: center; justify-content: center; padding: 24px;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: var(--card2); border: 1px solid var(--border);
      border-radius: 20px; max-width: 480px; width: 100%;
      padding: 36px; position: relative; animation: slideUp .3s ease;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .modal-close {
      position: absolute; top: 16px; right: 16px;
      background: none; border: none; color: var(--text-muted);
      font-size: 1.4rem; cursor: pointer; line-height: 1; transition: color .2s;
    }
    .modal-close:hover { color: #fff; }
    .modal-icon { font-size: 3rem; margin-bottom: 16px; text-align: center; }
    .modal h3 { font-size: 1.4rem; font-weight: 700; text-align: center; margin-bottom: 10px; }
    .modal p  { text-align: center; color: var(--text-muted); font-size: 0.9rem; margin-bottom: 24px; }
    .modal .btn { width: 100%; }
  `;
  document.head.appendChild(styleEl);

  /* ═══════════════════════════════════════════════════════════════
     INJECT HTML
     ═══════════════════════════════════════════════════════════════ */

  const formHTML = `
    <div class="booking-form-card" id="quote-form" style="position:relative;">
      <div class="form-title">Get a Quote</div>
      <div class="form-sub">Live pricing · Availability check · Instant estimate</div>

      <form id="bookingForm" onsubmit="window.submitBooking(event)">

        <!-- Trip Type -->
        <div class="form-group">
          <label>Trip Type</label>
          <div class="vehicle-selector">
            <div class="vehicle-opt selected" id="kc-tt-oneway" onclick="window.selectKcTripType('oneway')">
              <div class="vo-icon">➡️</div>
              <div class="vo-name">One-Way</div>
              <div class="vo-cap">Drop-off only</div>
            </div>
            <div class="vehicle-opt" id="kc-tt-roundtrip" onclick="window.selectKcTripType('roundtrip')">
              <div class="vo-icon">🔄</div>
              <div class="vo-name">Round Trip</div>
              <div class="vo-cap">Drop-off &amp; return</div>
            </div>
          </div>
        </div>

        <!-- Round Trip Local Transport Add-on (shown only for round trip) -->
        <div id="kc-local-transport-row" class="form-group" style="display:none; margin-bottom:10px;">
          <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; font-weight:400;">
            <input type="checkbox" id="kc-local-transport" onchange="window.recalcPrice()"
                   style="margin-top:2px;">
            <span>
              <strong style="color:var(--gold);">Local Area Transport</strong>
              <span style="color:var(--text-muted); font-size:0.85rem;"> +$250</span>
              <div style="font-size:0.78rem; color:var(--text-muted); margin-top:3px;">Driver stays on-site to taxi your group to different locations — venues, restaurants, bars &amp; more</div>
            </span>
          </label>
        </div>

        <!-- Date & Time -->
        <div class="form-row">
          <div class="form-group">
            <label for="pickup-date">Pickup Date</label>
            <input type="date" id="pickup-date" required oninput="window.onDateTimeChange()" />
          </div>
          <div class="form-group">
            <label for="pickup-time">Pickup Time</label>
            <input type="time" id="pickup-time" required oninput="window.onDateTimeChange()" />
          </div>
        </div>

        <!-- Availability Status -->
        <div id="avail-status" style="display:none;">
          <div class="avail-dot"></div>
          <span id="avail-text"></span>
        </div>

        <!-- Pickup Address with Autocomplete -->
        <div class="form-group autocomplete-wrapper">
          <label for="pickup-loc">Pickup Location</label>
          <input type="text" id="pickup-loc" placeholder="Address, hotel, or landmark"
                 required autocomplete="off" oninput="window.debounceGeocode(this,'pickup')" />
          <div class="autocomplete-dropdown" id="pickup-dropdown"></div>
        </div>

        <!-- Dropoff Address with Autocomplete -->
        <div class="form-group autocomplete-wrapper">
          <label for="dropoff-loc">Drop-off Location</label>
          <input type="text" id="dropoff-loc" placeholder="Stadium, KCI Airport, hotel, etc."
                 required autocomplete="off" oninput="window.debounceGeocode(this,'dropoff')" />
          <div class="autocomplete-dropdown" id="dropoff-dropdown"></div>
        </div>

        <!-- Route Info Bar (shown after both addresses resolved) -->
        <div id="route-info" style="display:none;">
          <div class="ri-item">📍 <span class="ri-label">Distance:</span>&nbsp;<span class="ri-value" id="ri-dist">--</span></div>
          <div class="ri-item">⏱ <span class="ri-label">Drive time:</span>&nbsp;<span class="ri-value" id="ri-time">--</span></div>
        </div>

        <!-- Passengers & Luggage -->
        <div class="form-row">
          <div class="form-group">
            <label for="passengers">Passengers</label>
            <select id="passengers" required onchange="window.autoSelectVehicle()">
              <option value="">Select…</option>
              <option>1</option><option>2</option><option>3</option>
              <option>4</option><option>5</option><option>6</option>
              <option>7</option><option>8</option><option>9</option><option>10</option>
            </select>
          </div>
          <div class="form-group">
            <label for="luggage">Luggage Pieces</label>
            <select id="luggage" required>
              <option value="">Select…</option>
              <option>0</option><option>1</option><option>2</option><option>3</option>
              <option>4</option><option>5</option><option>6</option><option>7</option>
              <option>8</option><option>9</option><option>10</option>
            </select>
          </div>
        </div>

        <!-- Phone -->
        <div class="form-group">
          <label for="phone">Phone Number</label>
          <input type="tel" id="phone" placeholder="(816) 552-6669" required oninput="window.formatPhone(this)" maxlength="14" />
        </div>

        <div class="form-group">
          <label for="email">Email Address</label>
          <input type="email" id="email" placeholder="you@example.com" required />
        </div>

        <!-- Price Breakdown -->
        <div class="price-breakdown">
          <div class="pb-row">
            <span>Base fare</span>
            <span id="pb-base">$65</span>
          </div>
          <div class="pb-row" id="pb-dist-row" style="display:none;">
            <span id="pb-dist-label">Distance (-- mi × $2.25)</span>
            <span id="pb-dist-val">--</span>
          </div>
          <div class="pb-row" id="pb-surge-row" style="display:none;">
            <span id="pb-surge-label" style="color:var(--gold);">⚡ Surge pricing</span>
            <span id="pb-surge-val" style="color:var(--gold);"></span>
          </div>
          <div class="pb-row" id="pb-roundtrip-row" style="display:none;">
            <span style="color:var(--gold);">🔄 Round trip (×2)</span>
            <span id="pb-roundtrip-val" style="color:var(--gold);"></span>
          </div>
          <div class="pb-row" id="pb-kc-local-row" style="display:none;">
            <span style="color:var(--gold);">+ Local Area Transport</span>
            <span id="pb-kc-local-val" style="color:var(--gold);">+$250</span>
          </div>
          <hr class="pb-divider" />
          <div class="pb-total">
            <span>Estimated Total</span>
            <span id="price-display">$65</span>
          </div>
          <hr class="pb-divider" />
          <div class="pb-row" style="color:var(--gold); font-weight:700;">
            <span>Non-refundable 50% Deposit Due Now</span>
            <span id="pb-deposit">$33</span>
          </div>
          <div class="pb-row">
            <span>Remaining balance (due on ride day)</span>
            <span id="pb-remaining">$32</span>
          </div>
          <div class="pb-note">Submit your request to unlock the secure deposit payment below.</div>
          <div class="pb-cal-note">📅 <span>Availability via Google Calendar · <a href="#" style="color:var(--gold);">Connect your calendar</a></span></div>
        </div>

        <!-- Estimate disclaimer — shown when address is approximate -->
        <div id="estimate-disclaimer" style="display:none; background:rgba(253,185,19,.07); border:1px solid rgba(253,185,19,.25); border-radius:10px; padding:14px 16px; margin-bottom:16px;">
          <div style="display:flex; align-items:flex-start; gap:10px;">
            <span style="font-size:1.1rem; flex-shrink:0;">⚠️</span>
            <div>
              <div style="font-size:0.85rem; color:var(--gold); font-weight:700; margin-bottom:5px;">Estimated Price Only</div>
              <div style="font-size:0.79rem; color:var(--text-muted); line-height:1.5;">Your exact address couldn't be pinpointed — distance is estimated from the nearest city center. The final fare will be confirmed by Group Ride KC when your reservation is accepted.</div>
            </div>
          </div>
          <label style="display:flex; align-items:center; gap:10px; cursor:pointer; margin-top:12px;">
            <input type="checkbox" id="estimate-ack" style="margin-top:2px;">
            <span style="font-size:0.82rem; color:rgba(255,255,255,.75);">I understand</span>
          </label>
        </div>

        <button type="submit" class="btn btn-primary form-submit" id="submit-btn">Request This Ride →</button>
      </form>
    </div>
  `;

  const paymentHTML = `
    <!-- Payment Section -->
    <section id="qe-payment" style="display:none;">
      <div class="container">
        <!-- Unlocked banner -->
        <div style="background:rgba(40,200,120,.1); border:1px solid rgba(40,200,120,.3); border-radius:12px; padding:16px 24px; margin-bottom:40px; display:flex; align-items:center; gap:14px;">
          <span style="font-size:1.5rem;">🔓</span>
          <div>
            <div style="font-weight:700; color:#4ce0a0;">Reservation Request Received!</div>
            <div style="font-size:0.83rem; color:var(--text-muted); margin-top:2px;">Pay your non-refundable 50% deposit below to hold your vehicle. The remaining balance is due on ride day.</div>
          </div>
        </div>
        <div class="payment-inner">
          <div class="payment-info reveal">
            <div class="section-label">Secure Deposit</div>
            <h2 class="section-title">Hold Your<br>Reservation</h2>
            <p class="section-sub">A non-refundable 50% deposit is required to confirm your booking. The remaining balance is collected on the day of your ride.</p>
            <div class="payment-steps">
              <div class="pay-step">
                <div class="pay-step-num">1</div>
                <div>
                  <div class="pay-step-title">Submit Your Request</div>
                  <div class="pay-step-desc">Fill out the booking form and we confirm availability within 30 minutes.</div>
                </div>
              </div>
              <div class="pay-step">
                <div class="pay-step-num">2</div>
                <div>
                  <div class="pay-step-title">Receive Secure Invoice</div>
                  <div class="pay-step-desc">You'll get a payment link via email and SMS for the confirmed amount.</div>
                </div>
              </div>
              <div class="pay-step">
                <div class="pay-step-num">3</div>
                <div>
                  <div class="pay-step-title">Pay &amp; Get Confirmed</div>
                  <div class="pay-step-desc">Complete checkout in seconds. Driver info sent immediately after payment.</div>
                </div>
              </div>
              <div class="pay-step">
                <div class="pay-step-num">4</div>
                <div>
                  <div class="pay-step-title">Ride Day — You're All Set</div>
                  <div class="pay-step-desc">Track your driver, receive SMS updates, and enjoy a stress-free ride to the game.</div>
                </div>
              </div>
            </div>
          </div>

          <div class="payment-card reveal">
            <h3>Deposit Payment</h3>
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(253,185,19,.08); border:1px solid rgba(253,185,19,.2); border-radius:8px; padding:12px 16px; margin-bottom:20px; flex-wrap:wrap; gap:8px;">
              <div>
                <div style="font-size:0.75rem; color:var(--text-muted);">Non-refundable deposit due now (50%)</div>
                <div style="font-size:1.6rem; font-weight:900; color:var(--gold);" id="pay-deposit-amt">$17</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:0.75rem; color:var(--text-muted);">Remaining on ride day</div>
                <div style="font-size:1rem; font-weight:700;" id="pay-remaining-amt">$48</div>
                <div style="font-size:0.7rem; color:var(--text-muted);">Total: <span id="pay-total-amt">$65</span></div>
              </div>
            </div>
            <div class="pay-sub">You'll be redirected to Stripe's secure checkout. We never store your card information.</div>

            <div style="display:flex; flex-wrap:wrap; gap:8px; margin:16px 0;">
              <div style="background:rgba(255,255,255,.06); border:1px solid var(--border); border-radius:6px; padding:8px 14px; font-size:0.82rem; color:var(--text-muted);">💳 Credit / Debit</div>
              <div style="background:rgba(255,255,255,.06); border:1px solid var(--border); border-radius:6px; padding:8px 14px; font-size:0.82rem; color:var(--text-muted);"> Apple Pay</div>
              <div style="background:rgba(255,255,255,.06); border:1px solid var(--border); border-radius:6px; padding:8px 14px; font-size:0.82rem; color:var(--text-muted);">Google Pay</div>
            </div>

            <div class="pay-secure">
              <span class="secure-icon">🔒</span>
              256-bit SSL encryption · PCI DSS compliant · Powered by Stripe
            </div>

            <button id="pay-deposit-btn" class="btn btn-primary pay-btn" onclick="window.redirectToStripe()" style="width:100%; padding:18px; font-size:1.05rem;">Pay Deposit Now →</button>
            <div class="powered-by">Secure payments by <span>Stripe</span></div>
          </div>
        </div>
      </div>
    </section>
  `;

  const modalHTML = `
    <!-- Success Modals -->
    <div class="modal-overlay" id="qe-bookingModal">
      <div class="modal">
        <button class="modal-close" onclick="window.closeModal('qe-bookingModal')">✕</button>
        <div class="modal-icon">🎉</div>
        <h3>Ride Request Sent!</h3>
        <p>We've received your booking request and will confirm availability and send your payment link within 30 minutes. Check your email and SMS for next steps.</p>
        <button class="btn btn-primary" onclick="window.closeModal('qe-bookingModal')">Got It — Thanks!</button>
      </div>
    </div>

    <div class="modal-overlay" id="qe-payModal">
      <div class="modal">
        <button class="modal-close" onclick="window.closeModal('qe-payModal')">✕</button>
        <div class="modal-icon">✅</div>
        <h3>Payment Confirmed!</h3>
        <p>Your ride is booked and confirmed. Your driver's name and contact info will be sent to your email and phone within the hour.</p>
        <button class="btn btn-gold" onclick="window.closeModal('qe-payModal')">View My Booking</button>
      </div>
    </div>
  `;

  /* ═══════════════════════════════════════════════════════════════
     INJECT HTML INTO DOM
     ═══════════════════════════════════════════════════════════════ */

  const container = document.getElementById('quote-form-container');
  if (!container) {
    console.error('quote-form-container not found in DOM');
    return;
  }

  container.innerHTML = formHTML;
  container.insertAdjacentHTML('afterend', paymentHTML);
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  /* ═══════════════════════════════════════════════════════════════
     SUPABASE INITIALIZATION
     ═══════════════════════════════════════════════════════════════ */

  const SUPABASE_URL = 'https://nysoddktcdzynktrddte.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55c29kZGt0Y2R6eW5rdHJkZHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTYyMzAsImV4cCI6MjA4ODk5MjIzMH0.uj4aEhQ0fWog_6OA6ypx5N8Kou871hw7eipgKPIiIDU';
  let supabaseClient = null;
  try {
    if (window.supabase && window.supabase.createClient) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    }
  } catch(e) {
    console.warn('Supabase init failed:', e.message);
  }

  /* ═══════════════════════════════════════════════════════════════
     CONFIGURATION & STATE
     ═══════════════════════════════════════════════════════════════ */

  const PRICING = {
    suburban: { base: 65,  perMile: 2.25, label: 'Suburban' },
    van:      { base: 95,  perMile: 3.00, label: '10-Pass Van' }
  };
  const SURGE_PRICING = { base: 99, perMile: 5.00 };
  const DEPOSIT_PCT = 0.50;
  const KC_LOCAL_TRANSPORT_FEE = 250;

  // KC center (64109) and 300-mile bounding box for geocoder
  const KC_LAT = 39.0984, KC_LON = -94.5786, MAX_RADIUS_MI = 300;
  // ~4.35° lat per 300 mi, ~5.6° lon per 300 mi at this latitude
  const GEO_BBOX = '-100.18,34.75,-88.98,43.45';

  function distFromKC(lat, lon) {
    // Haversine distance in miles
    const R = 3958.8;
    const dLat = (lat - KC_LAT) * Math.PI / 180;
    const dLon = (lon - KC_LON) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(KC_LAT*Math.PI/180) * Math.cos(lat*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  const MATCH_DAYS = new Set([
    '2026-06-12','2026-06-15','2026-06-16','2026-06-19',
    '2026-06-20','2026-06-23','2026-06-24','2026-06-27',
    '2026-06-28','2026-07-01','2026-07-02','2026-07-05'
  ]);

  const BOOKED_SLOTS = [
    { date:'2026-06-15', startH:13, endH:16, vehicle:'suburban' },
    { date:'2026-06-15', startH:12, endH:17, vehicle:'van'      },
    { date:'2026-06-20', startH:18, endH:21, vehicle:'suburban' },
    { date:'2026-07-01', startH:10, endH:13, vehicle:'van'      },
  ];

  let selectedVehicle = 'suburban';
  let kcTripType = 'oneway';
  let coords = { pickup: null, dropoff: null };
  let coordsApproximate = { pickup: false, dropoff: false };
  let routeMiles = null;
  let geocodeTimers = {};
  let activeBooking = { id: null, type: null };

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC FUNCTIONS (exposed to window)
     ═══════════════════════════════════════════════════════════════ */

  window.selectKcTripType = function(type) {
    kcTripType = type;
    document.getElementById('kc-tt-oneway').classList.toggle('selected', type === 'oneway');
    document.getElementById('kc-tt-roundtrip').classList.toggle('selected', type === 'roundtrip');
    const localRow = document.getElementById('kc-local-transport-row');
    localRow.style.display = type === 'roundtrip' ? 'block' : 'none';
    if (type === 'oneway') {
      document.getElementById('kc-local-transport').checked = false;
    }
    window.recalcPrice();
  };

  window.autoSelectVehicle = function() {
    const pax = parseInt(document.getElementById('passengers').value) || 0;
    selectedVehicle = pax >= 6 ? 'van' : 'suburban';
    document.getElementById('pb-base').textContent = '$' + PRICING[selectedVehicle].base;
    window.recalcPrice();
    window.onDateTimeChange();
  };

  window.onDateTimeChange = function() {
    const date = document.getElementById('pickup-date').value;
    const time = document.getElementById('pickup-time').value;
    const el   = document.getElementById('avail-status');
    const txt  = document.getElementById('avail-text');
    if (!date || !time) { el.style.display = 'none'; return; }

    el.style.display = 'flex';
    el.className = 'avail-load';
    txt.textContent = 'Checking availability…';

    setTimeout(() => {
      const available = checkAvailability(date, time, selectedVehicle);
      el.className = available ? 'avail-ok' : 'avail-no';
      if (available) {
        const isMatchDay = MATCH_DAYS.has(date);
        txt.textContent = isMatchDay
          ? '✓ Available — Match day surcharge applies'
          : '✓ Available for your selected date & time';
      } else {
        txt.textContent = '✗ Unavailable — please choose a different time';
      }
      window.recalcPrice();
    }, 250);
  };

  function checkAvailability(date, time, vehicle) {
    const [h, m] = time.split(':').map(Number);
    const pickupMins = h * 60 + m;
    return !BOOKED_SLOTS.some(slot =>
      slot.date === date &&
      slot.vehicle === vehicle &&
      pickupMins >= slot.startH * 60 - 60 &&
      pickupMins <= slot.endH   * 60 + 60
    );
  }

  window.debounceGeocode = function(input, type) {
    clearTimeout(geocodeTimers[type]);
    const q = input.value.trim();
    const dd = document.getElementById(type + '-dropdown');
    if (q.length < 3) { dd.classList.remove('open'); return; }
    geocodeTimers[type] = setTimeout(() => geocodeSearch(q, type), 400);
  };

  function normalizePhoton(features, forceApproximate) {
    return features.map(f => {
      const p = f.properties;
      const hasNumber  = !!p.housenumber;
      const street     = hasNumber ? `${p.housenumber} ${p.street || ''}`.trim() : p.street;
      const parts      = [street, p.city, p.state].filter(Boolean);
      const display    = p.name && !hasNumber
        ? [p.name, ...parts].filter(Boolean).join(', ')
        : parts.join(', ');
      return {
        name:          hasNumber ? street : (p.name || p.street || p.city || ''),
        display_name:  display || p.name || '',
        lat:           f.geometry.coordinates[1],
        lon:           f.geometry.coordinates[0],
        isApproximate: forceApproximate || !hasNumber
      };
    }).filter(r => r.display_name)
      .filter(r => distFromKC(r.lat, r.lon) <= MAX_RADIUS_MI);
  }

  function extractCityFallback(query) {
    const parts = query.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      // "2990 E. Ridgely Road, Smithville, MO" → "Smithville, MO"
      // "Smithville, MO" → "Smithville, MO"
      return parts.slice(-2).join(', ');
    }
    // Try splitting on spaces: "2990 E Ridgely Road Smithville MO"
    // Strip leading numbers (house number) and common road words
    const stripped = query
      .replace(/^\d+\s*/, '')
      .replace(/\b(road|rd|street|st|ave|avenue|blvd|boulevard|dr|drive|ln|lane|ct|court|way|hwy|highway|e\.?|w\.?|n\.?|s\.?)\b\.?\s*/gi, '')
      .trim();
    if (stripped.length > 2) return stripped;
    return null;
  }

  async function geocodeSearch(query, type) {
    try {
      const url = `https://photon.komoot.io/api/` +
        `?q=${encodeURIComponent(query)}&lat=${KC_LAT}&lon=${KC_LON}&bbox=${GEO_BBOX}&limit=5`;
      const res  = await fetch(url);
      const data = await res.json();
      let results = normalizePhoton(data.features, false);
      let isFallback = false;

      // Check if we got an exact street-level match (has house number)
      const hasExactMatch = results.some(r => !r.isApproximate);

      // If no results OR no exact match, try city-level fallback
      if (!results.length || !hasExactMatch) {
        const cityQuery = extractCityFallback(query);
        if (cityQuery) {
          const fbUrl  = `https://photon.komoot.io/api/` +
            `?q=${encodeURIComponent(cityQuery)}&lat=${KC_LAT}&lon=${KC_LON}&bbox=${GEO_BBOX}&limit=3`;
          const fbRes  = await fetch(fbUrl);
          const fbData = await fbRes.json();
          const cityResults = normalizePhoton(fbData.features, true);

          if (cityResults.length) {
            // If we had no results at all, use city results only
            // If we had approximate results, prepend city results (deduped)
            if (!results.length) {
              results = cityResults;
            } else {
              // Merge: city-level first, then any other results, removing duplicates
              const seen = new Set(cityResults.map(r => r.display_name));
              results = [...cityResults, ...results.filter(r => !seen.has(r.display_name))];
            }
            isFallback = true;
          }
        }

        // If still no results at all, do one more attempt: just the city name
        if (!results.length) {
          const words = query.replace(/[0-9]/g, '').split(/[\s,]+/).filter(w => w.length > 2);
          if (words.length) {
            const cityOnly = words.slice(-2).join(' ');
            const coUrl = `https://photon.komoot.io/api/` +
              `?q=${encodeURIComponent(cityOnly)}&lat=${KC_LAT}&lon=${KC_LON}&bbox=${GEO_BBOX}&limit=3`;
            const coRes = await fetch(coUrl);
            const coData = await coRes.json();
            results = normalizePhoton(coData.features, true);
            isFallback = true;
          }
        }
      }

      window.showDropdown(results, type, query, isFallback);
    } catch(e) {
      window.showDropdown([], type, query, true);
    }
  }

  window.showDropdown = function(results, type, originalQuery, isFallback) {
    const dd = document.getElementById(type + '-dropdown');
    let html = '';

    if (!results.length) {
      html = `<div style="padding:12px 14px;">
                <div style="font-size:0.82rem; color:var(--gold); font-weight:600; margin-bottom:6px;">
                  We couldn't find that exact address
                </div>
                <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:10px; line-height:1.4;">
                  This may be a rural or unlisted location. You can select a nearby city below, or use your typed address as-is. We'll confirm the exact location with you.
                </div>
                <div class="ac-item" onclick="window.useManualAddress('${type}', \`${(originalQuery||'').replace(/`/g,"'")}\`)">
                  <span class="ac-icon">✏️</span>
                  <div><div class="ac-name">Use "${originalQuery}" as entered</div>
                       <div class="ac-addr" style="color:var(--gold);">We'll confirm the exact pickup with you</div></div>
                </div>
              </div>`;
      dd.innerHTML = html;
      dd.classList.add('open');
      return;
    }

    if (isFallback) {
      html += `<div style="padding:10px 14px 4px;">
                 <div style="font-size:0.78rem; color:var(--gold); font-weight:600;">
                   Exact address not found — select a nearby area:
                 </div>
                 <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px; margin-bottom:6px;">
                   Your fare will be estimated from the city center. We'll confirm the exact distance with you.
                 </div>
               </div>`;
    }

    html += results.map(r => {
      const name    = r.name || r.display_name.split(',')[0];
      const addr    = r.display_name;
      const approx  = r.isApproximate ? 'true' : 'false';
      const icon    = r.isApproximate ? '🏙️' : '📍';
      const hint    = r.isApproximate ? '<div style="font-size:0.7rem;color:var(--gold);margin-top:2px;">City-level estimate</div>' : '';
      return `<div class="ac-item"
                   onclick="window.selectAddress('${type}', ${r.lat}, ${r.lon}, \`${r.display_name.replace(/`/g,"'")}\`, ${approx})">
                <span class="ac-icon">${icon}</span>
                <div><div class="ac-name">${name}</div>
                     <div class="ac-addr">${addr}</div>${hint}</div>
              </div>`;
    }).join('');

    if (isFallback && originalQuery) {
      html += `<div class="ac-item" style="border-top:1px solid var(--border);"
                    onclick="window.useManualAddress('${type}', \`${originalQuery.replace(/`/g,"'")}\`)">
                 <span class="ac-icon">✏️</span>
                 <div><div class="ac-name">Use "${originalQuery}" as entered</div>
                      <div class="ac-addr" style="color:var(--gold);">We'll confirm the exact pickup with you</div></div>
               </div>`;
    }

    dd.innerHTML = html;
    dd.classList.add('open');
  };

  window.useManualAddress = function(type, label) {
    document.getElementById(type + '-loc').value = label;
    document.getElementById(type + '-dropdown').classList.remove('open');
    coords[type] = { lat: 39.0984, lon: -94.5786 };
    coordsApproximate[type] = true;
    updateEstimateDisclaimer();
    if (coords.pickup && coords.dropoff) window.calculateRoute();
  };

  window.selectAddress = function(type, lat, lon, label, isApproximate) {
    document.getElementById(type + '-loc').value = label;
    document.getElementById(type + '-dropdown').classList.remove('open');
    coords[type] = { lat: parseFloat(lat), lon: parseFloat(lon) };
    coordsApproximate[type] = !!isApproximate;
    updateEstimateDisclaimer();
    if (coords.pickup && coords.dropoff) window.calculateRoute();
  };

  function updateEstimateDisclaimer() {
    const isApprox = coordsApproximate.pickup || coordsApproximate.dropoff;
    const disc = document.getElementById('estimate-disclaimer');
    const cb   = document.getElementById('estimate-ack');
    if (!disc) return;
    disc.style.display = isApprox ? 'block' : 'none';
    if (cb) {
      cb.required = isApprox;
      if (!isApprox) cb.checked = false;
    }
  }

  document.addEventListener('click', e => {
    if (!e.target.closest('.autocomplete-wrapper')) {
      document.querySelectorAll('.autocomplete-dropdown').forEach(d => d.classList.remove('open'));
    }
  });

  window.calculateRoute = async function() {
    const { pickup, dropoff } = coords;
    if (!pickup || !dropoff) return;

    const routeBar = document.getElementById('route-info');
    routeBar.style.display = 'flex';
    document.getElementById('ri-dist').textContent = '…';
    document.getElementById('ri-time').textContent = '…';

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/` +
        `${pickup.lon},${pickup.lat};${dropoff.lon},${dropoff.lat}?overview=false`;
      const res  = await fetch(url);
      const data = await res.json();

      if (data.code === 'Ok') {
        const meters  = data.routes[0].distance;
        const seconds = data.routes[0].duration;
        routeMiles = meters / 1609.344;

        const miles = routeMiles.toFixed(1);
        const mins  = Math.round(seconds / 60);
        const hrs   = Math.floor(mins / 60);
        const timeStr = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins} min`;

        document.getElementById('ri-dist').textContent = miles + ' mi';
        document.getElementById('ri-time').textContent = timeStr;
        window.recalcPrice();
      }
    } catch(e) {
      routeBar.style.display = 'none';
    }
  };

  function isSurge(date, time) {
    const matchDay  = date && MATCH_DAYS.has(date);
    const lateNight = time && (() => { const h = parseInt(time.split(':')[0]); return h >= 22 || h < 5; })();
    return matchDay || lateNight;
  }

  window.recalcPrice = function() {
    const p     = PRICING[selectedVehicle];
    const date  = document.getElementById('pickup-date').value;
    const time  = document.getElementById('pickup-time').value;
    const surge = isSurge(date, time);

    const base    = surge ? SURGE_PRICING.base    : p.base;
    const perMile = surge ? SURGE_PRICING.perMile : p.perMile;

    document.getElementById('pb-base').textContent = '$' + base;

    const surgeRow = document.getElementById('pb-surge-row');
    if (surge) {
      const reasons = [];
      if (date && MATCH_DAYS.has(date)) reasons.push('Match day');
      if (time) { const h = parseInt(time.split(':')[0]); if (h >= 22 || h < 5) reasons.push('Late night'); }
      surgeRow.style.display = 'flex';
      document.getElementById('pb-surge-label').textContent = '⚡ Surge pricing — ' + reasons.join(' · ');
      document.getElementById('pb-surge-val').textContent   = '$' + base + ' base · $' + perMile.toFixed(2) + '/mi';
    } else {
      surgeRow.style.display = 'none';
    }

    let distCost = 0;
    if (routeMiles !== null) {
      distCost = routeMiles * perMile;
      document.getElementById('pb-dist-row').style.display = 'flex';
      document.getElementById('pb-dist-label').textContent =
        `Distance (${routeMiles.toFixed(1)} mi × $${perMile.toFixed(2)})`;
      document.getElementById('pb-dist-val').textContent = '$' + distCost.toFixed(2);
    }

    const oneWayTotal = Math.ceil(base + distCost);
    const isRoundTrip = kcTripType === 'roundtrip';
    const rtRow = document.getElementById('pb-roundtrip-row');
    if (isRoundTrip) {
      rtRow.style.display = 'flex';
      document.getElementById('pb-roundtrip-val').textContent = '×2 = $' + (oneWayTotal * 2);
    } else {
      rtRow.style.display = 'none';
    }

    const localChecked = document.getElementById('kc-local-transport')?.checked;
    const localFee = (isRoundTrip && localChecked) ? KC_LOCAL_TRANSPORT_FEE : 0;
    const kcLocalRow = document.getElementById('pb-kc-local-row');
    if (localFee > 0) {
      kcLocalRow.style.display = 'flex';
      document.getElementById('pb-kc-local-val').textContent = '+$' + localFee;
    } else {
      kcLocalRow.style.display = 'none';
    }

    const total   = (isRoundTrip ? oneWayTotal * 2 : oneWayTotal) + localFee;
    const deposit = Math.ceil(total * DEPOSIT_PCT);

    document.getElementById('price-display').textContent  = '$' + total;
    document.getElementById('pb-deposit').textContent     = '$' + deposit;
    document.getElementById('pb-remaining').textContent   = '$' + (total - deposit);
    document.getElementById('pay-deposit-amt').textContent  = '$' + deposit;
    document.getElementById('pay-total-amt').textContent    = '$' + total;
    document.getElementById('pay-remaining-amt').textContent = '$' + (total - deposit);
  };

  window.submitBooking = async function(e) {
    e.preventDefault();
    const avail = document.getElementById('avail-status');
    if (avail.classList.contains('avail-no')) {
      alert('This vehicle is unavailable at the selected time. Please choose a different date or time.');
      return;
    }

    const disc = document.getElementById('estimate-disclaimer');
    const ack  = document.getElementById('estimate-ack');
    if (disc && disc.style.display !== 'none' && ack && !ack.checked) {
      ack.style.outline = '2px solid var(--gold)';
      ack.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => { ack.style.outline = ''; }, 2000);
      return;
    }

    window.recalcPrice();

    const btn = document.getElementById('submit-btn');
    btn.textContent = 'Submitting…';
    btn.disabled = true;

    const totalText   = document.getElementById('price-display').textContent.replace('$','');
    const depositText = document.getElementById('pb-deposit').textContent.replace('$','');
    const total   = parseFloat(totalText);
    const deposit = parseFloat(depositText);

    const pickupDate = document.getElementById('pickup-date').value;
    const pickupTime = document.getElementById('pickup-time').value;
    const isSurgeFlag = MATCH_DAYS.has(pickupDate) || (function(){
      if(!pickupTime) return false;
      const h = parseInt(pickupTime.split(':')[0]);
      return h >= 22 || h < 5;
    })();

    const booking = {
      vehicle:       selectedVehicle,
      trip_type:     kcTripType,
      pickup_date:   pickupDate,
      pickup_time:   pickupTime,
      pickup_address:  document.getElementById('pickup-loc').value,
      dropoff_address: document.getElementById('dropoff-loc').value,
      pickup_lat:    coords.pickup?.lat || null,
      pickup_lon:    coords.pickup?.lon || null,
      dropoff_lat:   coords.dropoff?.lat || null,
      dropoff_lon:   coords.dropoff?.lon || null,
      route_miles:   routeMiles,
      passengers:    parseInt(document.getElementById('passengers').value),
      phone:         document.getElementById('phone').value,
      email:         document.getElementById('email').value,
      base_fare:     PRICING[selectedVehicle].base,
      distance_cost: routeMiles ? parseFloat((routeMiles * PRICING[selectedVehicle].perMile).toFixed(2)) : null,
      surge_applied: isSurgeFlag,
      total_price:   total,
      deposit_amount: deposit,
      payment_status: 'pending',
      booking_status: 'pending',
      notes:         'Source: ' + window.location.pathname
    };

    try {
      const { data, error } = await supabaseClient.from('bookings').insert([booking]).select();
      if (error) throw error;
      activeBooking = { id: data[0].id, type: 'kc' };

      // Fire-and-forget: create Google Calendar event for this booking
      createCalendarEvent({
        booking_id:      data[0].id,
        booking_type:    'kc',
        vehicle:         selectedVehicle,
        trip_type:       kcTripType,
        pickup_date:     pickupDate,
        pickup_time:     pickupTime,
        pickup_address:  booking.pickup_address,
        dropoff_address: booking.dropoff_address,
        route_miles:     routeMiles,
        passengers:      booking.passengers,
        phone:           booking.phone,
        email:           booking.email,
        total_price:     total,
        deposit_amount:  deposit,
        payment_status:  'pending',
        source_page:     window.location.pathname,
      });

      const paySection = document.getElementById('qe-payment');
      paySection.style.display = 'block';

      document.getElementById('pay-deposit-amt').textContent   = '$' + deposit;
      document.getElementById('pay-total-amt').textContent     = '$' + total;
      document.getElementById('pay-remaining-amt').textContent = '$' + (total - deposit);

      setTimeout(() => paySection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

      btn.textContent = '✓ Request Submitted — Pay Deposit Below';
      btn.style.background = '#2a9d5c';
    } catch(err) {
      console.error('Supabase insert error:', err);
      const detail = err?.message || err?.details || JSON.stringify(err);
      alert('Booking error: ' + detail + '\n\nPlease try again or call us at (816) 552-6669.');
      btn.textContent = 'Request This Ride →';
      btn.disabled = false;
    }
  };

  window.formatPhone = function(el) {
    const digits = el.value.replace(/\D/g, '').substring(0, 10);
    let formatted = '';
    if (digits.length > 0) formatted  = '(' + digits.substring(0, 3);
    if (digits.length >= 4) formatted += ') ' + digits.substring(3, 6);
    if (digits.length >= 7) formatted += '-' + digits.substring(6, 10);
    el.value = formatted;
  };

  window.closeModal = function(id) {
    document.getElementById(id).classList.remove('active');
  };

  window.redirectToStripe = async function() {
    if (!activeBooking.id) {
      alert('Please submit a booking form first.');
      return;
    }

    const depositText = document.getElementById('pay-deposit-amt').textContent.replace('$','');
    const depositAmt  = parseFloat(depositText);
    const amountCents = Math.round(depositAmt * 100);

    let customerEmail = document.getElementById('email').value;
    const description = 'Group Ride KC — KC Ride Deposit';

    const payBtn = document.getElementById('pay-deposit-btn');
    if (payBtn) { payBtn.textContent = 'Redirecting to checkout…'; payBtn.disabled = true; }

    try {
      const res = await fetch('/.netlify/functions/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_cents:   amountCents,
          booking_id:     activeBooking.id,
          booking_type:   activeBooking.type,
          customer_email: customerEmail,
          description:    description
        })
      });

      const data = await res.json();
      if (data.url) {
        const table = activeBooking.type === 'loto' ? 'loto_bookings' : 'bookings';
        await supabaseClient.from(table).update({ stripe_session_id: data.sessionId }).eq('id', activeBooking.id);
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to create checkout session');
      }
    } catch(err) {
      console.error('Stripe redirect error:', err);
      alert('There was an error connecting to payment. Please try again or call us at (816) 552-6669.');
      if (payBtn) { payBtn.textContent = 'Pay Deposit Now →'; payBtn.disabled = false; }
    }
  };

  /* ═══════════════════════════════════════════════════════════════
     GOOGLE CALENDAR INTEGRATION (fire-and-forget)
     ═══════════════════════════════════════════════════════════════ */
  async function createCalendarEvent(bookingData) {
    try {
      await fetch('/.netlify/functions/create-calendar-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingData),
      });
      console.log('Calendar event request sent');
    } catch (err) {
      // Non-blocking — don't interrupt the booking flow
      console.warn('Calendar event creation failed (non-critical):', err);
    }
  }
  // Expose for LOTO form to use
  window.createCalendarEvent = createCalendarEvent;

  /* ═══════════════════════════════════════════════════════════════
     PAGE INITIALIZATION
     ═══════════════════════════════════════════════════════════════ */

  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('pickup-date');
  if(dateInput) dateInput.setAttribute('min', today);

  // Check payment status on load
  (function checkPaymentStatus() {
    const params = new URLSearchParams(window.location.search);
    const payment   = params.get('payment');
    const bookingId = params.get('booking_id');
    const bookingType = params.get('type') || 'kc';
    const sessionId = params.get('session_id');

    if (!payment || !bookingId) return;

    if (payment === 'success') {
      const table = bookingType === 'loto' ? 'loto_bookings' : 'bookings';
      supabaseClient.from(table)
        .update({ payment_status: 'deposit_paid', stripe_payment_id: sessionId })
        .eq('id', bookingId)
        .then(() => {
          document.getElementById('qe-payModal').classList.add('active');
        });

      window.history.replaceState({}, '', window.location.pathname);
    } else if (payment === 'cancelled') {
      alert('Payment was cancelled. Your booking is still saved — you can pay the deposit anytime by calling us at (816) 552-6669.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  })();

  console.log('Quote Engine initialized');
})();
