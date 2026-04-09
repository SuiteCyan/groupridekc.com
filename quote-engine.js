/**
 * ═══════════════════════════════════════════════════════════════
 * GROUP RIDE KC – Quote Engine (Admin Approval Flow)
 * ═══════════════════════════════════════════════════════════════
 *
 * This self-contained module provides a quote form for requesting rides.
 * The flow: customer submits form → booking saved with status 'pending_review' →
 * admin notification email sent → confirmation modal shown.
 *
 * Usage:
 *   <div id="quote-form-container"></div>
 *   <script src="quote-engine.js"></script>
 *
 * The engine injects:
 *   - All CSS styling (booking form, modal, autocomplete)
 *   - Complete form HTML (trip type, dates, locations, pricing)
 *   - Confirmation modal
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
    /* Autocomplete container styling */
    .ac-container {
      width: 100%;
    }
    .ac-container gmp-place-autocomplete {
      width: 100%;
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

    /* Google Places Autocomplete (New API) — style via ::part selectors */
    gmp-place-autocomplete {
      --gmp-mat-color-surface: rgba(255,255,255,.05);
      --gmp-mat-color-on-surface: #fff;
      --gmp-mat-color-on-surface-variant: rgba(255,255,255,.5);
      --gmp-mat-shape-corner-extra-small: 8px;
      font-family: 'Inter', sans-serif;
      width: 100%;
    }

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
      <div class="form-sub">Request a ride · Get a quick estimate</div>

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

        <!-- Round Trip On-Site Hours (shown only for round trip) -->
        <div id="kc-onsite-hours-row" class="form-group" style="display:none; margin-bottom:18px;">
          <div style="background:rgba(253,185,19,.07); border:1px solid rgba(253,185,19,.25); border-radius:10px; padding:14px 16px;">
            <div style="display:flex; align-items:flex-start; gap:10px;">
              <span style="font-size:1.1rem; flex-shrink:0;">🕐</span>
              <div style="flex:1;">
                <div style="font-size:0.9rem; color:var(--gold); font-weight:700; margin-bottom:4px;">On-Site Wait Time</div>
                <div style="font-size:0.8rem; color:var(--text-muted); line-height:1.5; margin-bottom:12px;">Round trips include an additional <strong style="color:#fff;">$95/hour</strong> for each hour the driver stays on-site between drop-off and return pickup. Estimate how long you'll need below.</div>
                <div style="display:flex; align-items:center; gap:12px;">
                  <label for="kc-onsite-hours" style="font-size:0.82rem; color:rgba(255,255,255,.7); white-space:nowrap; margin-bottom:0;">Hours on-site</label>
                  <select id="kc-onsite-hours" onchange="window.recalcPrice()" style="width:100px; background:rgba(255,255,255,.08); border:1px solid var(--border); border-radius:8px; padding:8px 12px; color:#fff; font-family:inherit; font-size:0.9rem;">
                    <option value="1">1 hour</option>
                    <option value="2" selected>2 hours</option>
                    <option value="3">3 hours</option>
                    <option value="4">4 hours</option>
                    <option value="5">5 hours</option>
                    <option value="6">6 hours</option>
                    <option value="7">7 hours</option>
                    <option value="8">8 hours</option>
                  </select>
                  <span id="kc-onsite-cost-preview" style="font-size:0.85rem; color:var(--gold); font-weight:600;">+$190</span>
                </div>
              </div>
            </div>
          </div>
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

        <!-- Pickup Address with Google Autocomplete (New API) -->
        <div class="form-group">
          <label>Pickup Location</label>
          <div id="pickup-ac-container" class="ac-container"></div>
          <input type="hidden" id="pickup-loc" />
        </div>

        <!-- Dropoff Address with Google Autocomplete (New API) -->
        <div class="form-group">
          <label>Drop-off Location</label>
          <div id="dropoff-ac-container" class="ac-container"></div>
          <input type="hidden" id="dropoff-loc" />
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

        <!-- Name -->
        <div class="form-group">
          <label for="customer-name">Your Name</label>
          <input type="text" id="customer-name" placeholder="First and last name" required />
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

        <!-- Notes -->
        <div class="form-group">
          <label for="notes">Notes (optional)</label>
          <textarea id="notes" placeholder="Any special requests or details..."></textarea>
        </div>

        <!-- Price Breakdown -->
        <div class="price-breakdown">
          <div class="pb-row">
            <span>Base fare</span>
            <span id="pb-base">$95</span>
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
          <div class="pb-row" id="pb-kc-onsite-row" style="display:none;">
            <span id="pb-kc-onsite-label" style="color:var(--gold);">🕐 On-site (2 hrs × $95)</span>
            <span id="pb-kc-onsite-val" style="color:var(--gold);">+$190</span>
          </div>
          <hr class="pb-divider" />
          <div class="pb-total">
            <span>Estimated Total</span>
            <span id="price-display">$95</span>
          </div>
          <div class="pb-note">This is an estimate. Final price will be confirmed by Group Ride KC.</div>
        </div>

        <!-- Estimate disclaimer — shown when address is approximate -->
        <div id="estimate-disclaimer" style="display:none; background:rgba(253,185,19,.07); border:1px solid rgba(253,185,19,.25); border-radius:10px; padding:14px 16px; margin-bottom:16px;">
          <div style="display:flex; align-items:flex-start; gap:10px;">
            <span style="font-size:1.1rem; flex-shrink:0;">⚠️</span>
            <div>
              <div style="font-size:0.85rem; color:var(--gold); font-weight:700; margin-bottom:5px;">Estimated Price Only</div>
              <div style="font-size:0.79rem; color:var(--text-muted); line-height:1.5;">Your exact address couldn't be pinpointed — distance is estimated from the nearest city center. The final fare will be confirmed by Group Ride KC when your reservation is reviewed.</div>
            </div>
          </div>
          <label style="display:flex; align-items:center; gap:10px; cursor:pointer; margin-top:12px;">
            <input type="checkbox" id="estimate-ack" style="margin-top:2px;">
            <span style="font-size:0.82rem; color:rgba(255,255,255,.75);">I understand</span>
          </label>
        </div>

        <button type="submit" class="btn btn-primary form-submit" id="submit-btn">Submit Request →</button>
      </form>
    </div>
  `;

  const modalHTML = `
    <!-- Confirmation Modal -->
    <div class="modal-overlay" id="qe-confirmationModal">
      <div class="modal">
        <button class="modal-close" onclick="window.closeModal('qe-confirmationModal')">✕</button>
        <div class="modal-icon">✅</div>
        <h3>Request Received!</h3>
        <p>Thank you for your request! We will review your ride details and get back to you within 24 hours via text and email.</p>
        <button class="btn btn-primary" onclick="window.closeModal('qe-confirmationModal')">Got It — Thanks!</button>
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
    suburban: { base: 95,  perMile: 2.25, label: 'Suburban' },
    van:      { base: 95,  perMile: 3.00, label: '10-Pass Van' }
  };
  const SURGE_PRICING = { base: 145, perMile: 5.00 };
  const DEPOSIT_PCT = 0.50;
  const KC_ONSITE_HOURLY_RATE = 95;

  // KC center (64109) and 200-mile radius for geocoder
  const KC_LAT = 39.0984, KC_LON = -94.5786, MAX_RADIUS_MI = 200;
  const GOOGLE_API_KEY = 'AIzaSyDsrdC9f_xMYhWSzQvmqT1v121rGvV6CAQ';

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

  let selectedVehicle = 'suburban';
  let kcTripType = 'oneway';
  let coords = { pickup: null, dropoff: null };
  let coordsApproximate = { pickup: false, dropoff: false };
  let routeMiles = null;

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC FUNCTIONS (exposed to window)
     ═══════════════════════════════════════════════════════════════ */

  window.selectKcTripType = function(type) {
    kcTripType = type;
    document.getElementById('kc-tt-oneway').classList.toggle('selected', type === 'oneway');
    document.getElementById('kc-tt-roundtrip').classList.toggle('selected', type === 'roundtrip');
    const onsiteRow = document.getElementById('kc-onsite-hours-row');
    onsiteRow.style.display = type === 'roundtrip' ? 'block' : 'none';
    if (type === 'oneway') {
      document.getElementById('kc-onsite-hours').value = '2';
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
    // Only recalculate price on date/time change
    window.recalcPrice();
  };

  /* ── Google Places Autocomplete Setup (New API) ──────────────── */
  function initGoogleAutocomplete() {
    const kcCenter = { lat: KC_LAT, lng: KC_LON };
    const placeholders = {
      pickup: 'Address, hotel, or landmark',
      dropoff: 'Stadium, KCI Airport, hotel, etc.'
    };

    ['pickup', 'dropoff'].forEach(type => {
      const container = document.getElementById(type + '-ac-container');
      const hiddenInput = document.getElementById(type + '-loc');

      const ac = new google.maps.places.PlaceAutocompleteElement({
        locationBias: new google.maps.Circle({ center: kcCenter, radius: 50000 }),
        includedRegionCodes: ['us'],
        types: ['geocode', 'establishment']
      });

      // Set placeholder via the input inside the shadow DOM
      ac.setAttribute('placeholder', placeholders[type]);

      // Style the element to fill its container
      ac.style.width = '100%';

      container.appendChild(ac);

      ac.addEventListener('gmp-select', async ({ placePrediction }) => {
        if (!placePrediction) {
          coordsApproximate[type] = true;
          return;
        }
        const place = placePrediction.toPlace();
        await place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName'] });

        const loc = place.location;
        if (!loc) {
          coordsApproximate[type] = true;
          return;
        }
        const lat = loc.lat();
        const lon = loc.lng();
        coords[type] = { lat, lon };
        coordsApproximate[type] = false;

        // Store the formatted address in the hidden input for form submission
        hiddenInput.value = place.formattedAddress || place.displayName || '';

        if (coords.pickup && coords.dropoff) window.calculateRoute();
      });
    });
  }

  // Load Google Maps JS API dynamically, then init autocomplete
  (function loadGoogleMaps() {
    // If already loaded (e.g. by index.html), just init
    if (window.google && window.google.maps && window.google.maps.places) {
      initGoogleAutocomplete();
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&libraries=places&loading=async&callback=__initGoogleAC`;
    script.async = true;
    script.defer = true;
    window.__initGoogleAC = function() { initGoogleAutocomplete(); };
    document.head.appendChild(script);
  })();

  /* ── Google Directions API for route distance ──────────────── */
  window.calculateRoute = async function() {
    const { pickup, dropoff } = coords;
    if (!pickup || !dropoff) return;

    const routeBar = document.getElementById('route-info');
    routeBar.style.display = 'flex';
    document.getElementById('ri-dist').textContent = '…';
    document.getElementById('ri-time').textContent = '…';

    try {
      const service = new google.maps.DirectionsService();
      const result = await service.route({
        origin:      new google.maps.LatLng(pickup.lat, pickup.lon),
        destination: new google.maps.LatLng(dropoff.lat, dropoff.lon),
        travelMode:  google.maps.TravelMode.DRIVING
      });

      if (result.routes && result.routes.length) {
        const leg     = result.routes[0].legs[0];
        const meters  = leg.distance.value;
        const seconds = leg.duration.value;
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

    const onsiteHours = isRoundTrip ? parseInt(document.getElementById('kc-onsite-hours')?.value || '0') : 0;
    const onsiteFee = onsiteHours * KC_ONSITE_HOURLY_RATE;
    const kcOnsiteRow = document.getElementById('pb-kc-onsite-row');
    if (isRoundTrip && onsiteHours > 0) {
      kcOnsiteRow.style.display = 'flex';
      document.getElementById('pb-kc-onsite-label').textContent = '🕐 On-site (' + onsiteHours + ' hr' + (onsiteHours > 1 ? 's' : '') + ' × $' + KC_ONSITE_HOURLY_RATE + ')';
      document.getElementById('pb-kc-onsite-val').textContent = '+$' + onsiteFee;
      document.getElementById('kc-onsite-cost-preview').textContent = '+$' + onsiteFee;
    } else {
      kcOnsiteRow.style.display = 'none';
    }

    const total = (isRoundTrip ? oneWayTotal * 2 : oneWayTotal) + onsiteFee;
    document.getElementById('price-display').textContent = '$' + total;
  };

  window.submitBooking = async function(e) {
    e.preventDefault();

    const disc = document.getElementById('estimate-disclaimer');
    const ack  = document.getElementById('estimate-ack');
    if (disc && disc.style.display !== 'none' && ack && !ack.checked) {
      ack.style.outline = '2px solid var(--gold)';
      ack.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => { ack.style.outline = ''; }, 2000);
      return;
    }

    const btn = document.getElementById('submit-btn');
    btn.textContent = 'Submitting…';
    btn.disabled = true;

    // Validate all required fields
    const pickupDate = document.getElementById('pickup-date').value;
    const pickupTime = document.getElementById('pickup-time').value;
    const pickupAddr = document.getElementById('pickup-loc').value;
    const dropoffAddr = document.getElementById('dropoff-loc').value;
    const passengers = document.getElementById('passengers').value;
    const luggage = document.getElementById('luggage').value;
    const customerName = document.getElementById('customer-name').value.trim();
    const phone = document.getElementById('phone').value;
    const email = document.getElementById('email').value;
    const notes = document.getElementById('notes').value || '';

    if (!customerName || !pickupDate || !pickupTime || !pickupAddr || !dropoffAddr || !passengers || luggage === '' || !phone || !email) {
      alert('Please fill in all required fields.');
      btn.textContent = 'Submit Request →';
      btn.disabled = false;
      return;
    }

    const totalText = document.getElementById('price-display').textContent.replace('$','');
    const total = parseFloat(totalText);

    const isSurgeFlag = MATCH_DAYS.has(pickupDate) || (function(){
      if(!pickupTime) return false;
      const h = parseInt(pickupTime.split(':')[0]);
      return h >= 22 || h < 5;
    })();

    const booking = {
      customer_name:   customerName,
      vehicle:         selectedVehicle,
      trip_type:       kcTripType,
      pickup_date:     pickupDate,
      pickup_time:     pickupTime,
      pickup_address:  pickupAddr,
      dropoff_address: dropoffAddr,
      pickup_lat:      coords.pickup?.lat || null,
      pickup_lon:      coords.pickup?.lon || null,
      dropoff_lat:     coords.dropoff?.lat || null,
      dropoff_lon:     coords.dropoff?.lon || null,
      route_miles:     routeMiles,
      passengers:      parseInt(passengers),
      luggage:         parseInt(luggage),
      phone:           phone,
      email:           email,
      notes:           kcTripType === 'roundtrip' ? (notes ? notes + ' | ' : '') + 'On-site wait: ' + (document.getElementById('kc-onsite-hours')?.value || '0') + ' hours' : notes,
      base_fare:       PRICING[selectedVehicle].base,
      distance_cost:   routeMiles ? parseFloat((routeMiles * PRICING[selectedVehicle].perMile).toFixed(2)) : null,
      surge_applied:   isSurgeFlag,
      total_price:     total,
      deposit_amount:  parseFloat((total * DEPOSIT_PCT).toFixed(2)),
      local_transport_fee: kcTripType === 'roundtrip' ? parseInt(document.getElementById('kc-onsite-hours')?.value || '0') * KC_ONSITE_HOURLY_RATE : 0,
      status:          'pending_review',
      payment_status:  'pending',
      source_page:     window.location.pathname
    };

    try {
      const { data, error } = await supabaseClient.from('bookings').insert([booking]).select();
      if (error) throw error;

      // Fire-and-forget: send admin notification email via Netlify function
      fetch('/.netlify/functions/send-request-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: data[0].id,
          booking_data: booking
        })
      }).catch(err => {
        console.warn('Admin email notification failed (non-critical):', err);
      });

      // Show confirmation modal and reset form
      document.getElementById('qe-confirmationModal').classList.add('active');
      document.getElementById('bookingForm').reset();

      // Reset vehicle selection UI
      selectedVehicle = 'suburban';
      kcTripType = 'oneway';
      coords = { pickup: null, dropoff: null };
      coordsApproximate = { pickup: false, dropoff: false };
      routeMiles = null;
      document.getElementById('kc-tt-oneway').classList.add('selected');
      document.getElementById('kc-tt-roundtrip').classList.remove('selected');
      document.getElementById('kc-onsite-hours-row').style.display = 'none';
      document.getElementById('kc-onsite-hours').value = '2';
      document.getElementById('route-info').style.display = 'none';
      window.recalcPrice();

      btn.textContent = 'Submit Request →';
      btn.disabled = false;
    } catch(err) {
      console.error('Supabase insert error:', err);
      const detail = err?.message || err?.details || JSON.stringify(err);
      alert('Booking error: ' + detail + '\n\nPlease try again or call us at (816) 552-6669.');
      btn.textContent = 'Submit Request →';
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

  /* ═══════════════════════════════════════════════════════════════
     PAGE INITIALIZATION
     ═══════════════════════════════════════════════════════════════ */

  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('pickup-date');
  if(dateInput) dateInput.setAttribute('min', today);

  console.log('Quote Engine initialized (admin approval flow)');
})();
