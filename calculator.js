/* How Much House Can I Afford (Canada) — calculator logic.
   Pure functions first (testable in Node), DOM wiring at the bottom.
   All figures in Canadian dollars. Rates verified November 2026. */
(function () {
  'use strict';

  /* ---------- helpers ---------- */

  function money(n) {
    return '$' + Math.round(n).toLocaleString('en-CA');
  }

  function monthlyPayment(principal, annualRatePct, years) {
    var r = annualRatePct / 100 / 12;
    var n = years * 12;
    if (r === 0) return principal / n;
    return principal * r / (1 - Math.pow(1 + r, -n));
  }

  /* ---------- CMHC mortgage default insurance ---------- */
  /* Premium is a percentage of the mortgage, set by the down payment.
     Verified against CMHC's published homeowner schedule, November 2026.
     Amortizations over 25 years add a 0.20% surcharge. */
  function cmhcRate(downPct, amortYears) {
    if (downPct >= 20) return 0;
    var base;
    if (downPct >= 15) base = 0.028;
    else if (downPct >= 10) base = 0.031;
    else base = 0.04;
    if (amortYears > 25) base += 0.002;
    return base;
  }

  /* Minimum down payment: 5% of the first $500,000, 10% of the rest. */
  function minDown(price) {
    if (price <= 500000) return 0.05 * price;
    return 25000 + 0.10 * (price - 500000);
  }

  /* ---------- land transfer tax ---------- */

  /* BC property transfer tax. Brackets: 1% first $200,000; 2% to $2M;
     3% to $3M; 5% over $3M (residential).
     First-time buyer exemption, rules in force since April 1, 2024:
     full exemption at $500,000 or less; an $8,000 exemption (the tax on
     the first $500,000) from $500,001 to $835,000; proportional
     phase-out from $835,000 to $860,000; nothing at $860,000 or more. */
  function bcLTT(price, firstTime) {
    var tax = 0;
    tax += 0.01 * Math.min(price, 200000);
    if (price > 200000) tax += 0.02 * (Math.min(price, 2000000) - 200000);
    if (price > 2000000) tax += 0.03 * (Math.min(price, 3000000) - 2000000);
    if (price > 3000000) tax += 0.05 * (price - 3000000);
    var saving = 0;
    if (firstTime) {
      if (price <= 500000) saving = tax;
      else if (price <= 835000) saving = Math.min(tax, 8000);
      else if (price < 860000) saving = Math.min(tax, 8000 * (860000 - price) / 25000);
    }
    return { tax: tax, saving: saving, payable: Math.max(0, tax - saving) };
  }

  /* Ontario land transfer tax. Brackets: 0.5% first $55,000; 1% to $250,000;
     1.5% to $400,000; 2% to $2M; 2.5% above $2M.
     First-time buyers get a refund of up to $4,000. */
  function ontarioLTT(price, firstTime) {
    var tax = 0;
    tax += 0.005 * Math.min(price, 55000);
    if (price > 55000) tax += 0.01 * (Math.min(price, 250000) - 55000);
    if (price > 250000) tax += 0.015 * (Math.min(price, 400000) - 250000);
    if (price > 400000) tax += 0.02 * (Math.min(price, 2000000) - 400000);
    if (price > 2000000) tax += 0.025 * (price - 2000000);
    var saving = firstTime ? Math.min(tax, 4000) : 0;
    return { tax: tax, saving: saving, payable: Math.max(0, tax - saving) };
  }

  /* Alberta has no land transfer tax. Land Titles charges a registration
     levy on the transfer and another on the mortgage: $50 plus $5 for
     every $5,000 (or part of $5,000). Rates in force since October 20, 2024. */
  function albertaFees(price, mortgage) {
    var transfer = 50 + 5 * Math.ceil(price / 5000);
    var mort = 50 + 5 * Math.ceil(mortgage / 5000);
    return { transfer: transfer, mort: mort, total: transfer + mort };
  }

  /* Manitoba land transfer tax. Brackets: 0% first $30,000; 0.5% to
     $90,000; 1% to $150,000; 1.5% to $200,000; 2% above $200,000.
     No first-time buyer relief — every buyer pays the same. Land
     Titles registration is a small extra fee (roughly $70) and is
     not in this number. */
  function manitobaLTT(price) {
    var tax = 0;
    if (price > 30000) tax += 0.005 * (Math.min(price, 90000) - 30000);
    if (price > 90000) tax += 0.01 * (Math.min(price, 150000) - 90000);
    if (price > 150000) tax += 0.015 * (Math.min(price, 200000) - 150000);
    if (price > 200000) tax += 0.02 * (price - 200000);
    return { tax: tax, saving: 0, payable: tax };
  }

  /* Saskatchewan has no land transfer tax. Information Services
     Corporation (ISC) charges a title transfer fee — free to $500,
     flat $25 to $6,300, 0.4% of the value above that — and a tiered
     flat fee to register the mortgage. Fee table effective
     April 15, 2026. No first-time buyer relief on the fees. */
  function saskFees(price, mortgage) {
    var transfer = price <= 500 ? 0 : (price <= 6300 ? 25 : 0.004 * price);
    var mort;
    if (mortgage < 250000) mort = 200;
    else if (mortgage <= 500000) mort = 275;
    else if (mortgage <= 750000) mort = 525;
    else if (mortgage <= 1000000) mort = 775;
    else mort = 1000;
    return { transfer: transfer, mort: mort, total: transfer + mort };
  }

  /* Quebec welcome tax (droit de mutation immobilière), provincial
     base brackets for 2026: 0.5% first $62,900; 1% to $315,000;
     1.5% above. Montreal and some other cities add higher tiers
     above $500,000 — see qc.html. The tax is billed by the
     municipality after closing, on the greater of the price, the
     deed amount, or the municipal assessment times the comparative
     factor; this calculator uses the price.
     First-time buyers do NOT pay less on closing day. They claim a
     refundable tax credit afterwards: 100% of the first $5,000 of
     duties plus 25% of the next $3,500, up to $5,875, reduced by
     2.35% of the taxable base above $750,000 and nil at $1,000,000.
     In force for homes acquired on or after January 1, 2026. */
  function quebecLTT(price, firstTime) {
    var tax = 0;
    tax += 0.005 * Math.min(price, 62900);
    if (price > 62900) tax += 0.01 * (Math.min(price, 315000) - 62900);
    if (price > 315000) tax += 0.015 * (price - 315000);
    var credit = 0;
    if (firstTime) {
      credit = Math.min(tax, 5000 + 0.25 * Math.min(Math.max(tax - 5000, 0), 3500), 5875);
      if (price > 750000) credit = Math.max(0, credit - 0.0235 * (price - 750000));
    }
    return { tax: tax, saving: 0, payable: tax, credit: credit };
  }

  /* Montreal's welcome tax brackets for 2026. Same as the provincial
     base up to $552,300, then higher tiers. Used by the qc.html
     calculator when the Montreal box is ticked. */
  function montrealLTT(price, firstTime) {
    var tax = 0;
    tax += 0.005 * Math.min(price, 62900);
    if (price > 62900) tax += 0.01 * (Math.min(price, 315000) - 62900);
    if (price > 315000) tax += 0.015 * (Math.min(price, 552300) - 315000);
    if (price > 552300) tax += 0.02 * (Math.min(price, 1104700) - 552300);
    if (price > 1104700) tax += 0.025 * (Math.min(price, 2136500) - 1104700);
    if (price > 2136500) tax += 0.035 * (Math.min(price, 3113000) - 2136500);
    if (price > 3113000) tax += 0.04 * (price - 3113000);
    var credit = 0;
    if (firstTime) {
      credit = Math.min(tax, 5000 + 0.25 * Math.min(Math.max(tax - 5000, 0), 3500), 5875);
      if (price > 750000) credit = Math.max(0, credit - 0.0235 * (price - 750000));
    }
    return { tax: tax, saving: 0, payable: tax, credit: credit };
  }

  /* New Brunswick real property transfer tax: a flat 1% of the
     greater of the price or the assessed value, in force since
     April 1, 2016. No first-time buyer relief. Registration is
     $84 per parcel per document — $168 for a one-parcel purchase
     with a mortgage — and is included in the total here. */
  function nbLTT(price) {
    var tax = 0.01 * price;
    return { tax: tax, saving: 0, payable: tax + 168 };
  }

  /* Nova Scotia has no provincial land transfer tax. Each
     municipality sets its own deed transfer tax, 1% to 1.5%.
     This uses Halifax's rate, 1.5% (By-law D-200) — the rate most
     Nova Scotia buyers pay — and the page lists the others.
     No first-time buyer relief. */
  function nsDTT(price) {
    var tax = 0.015 * price;
    return { tax: tax, saving: 0, payable: tax };
  }

  /* Prince Edward Island real property transfer tax: a flat 1% of
     the greater of the price or the assessed value; nothing at all
     if that amount is $30,000 or less. Qualifying first-time buyers
     are fully exempt, with no price cap — they must be Canadian
     citizens or permanent residents, meet the six-month PEI
     residency test, and live in the home for 183 days. */
  function peiLTT(price, firstTime) {
    var tax = price <= 30000 ? 0 : 0.01 * price;
    var saving = firstTime ? tax : 0;
    return { tax: tax, saving: saving, payable: Math.max(0, tax - saving) };
  }

  /* Newfoundland and Labrador has no land transfer tax. The Registry
     of Deeds charges $100 if the value is $500 or less, otherwise
     $100 plus $0.40 for each additional $100 (or part of $100) of
     value — once on the deed, once on the mortgage amount, the
     mortgage fee capped at $5,000. No first-time buyer relief. */
  function nlFees(price, mortgage) {
    function fee(value) {
      if (value <= 500) return 100;
      return 100 + 0.40 * Math.ceil((value - 500) / 100);
    }
    var deed = fee(price);
    var mort = Math.min(fee(mortgage), 5000);
    return { transfer: deed, mort: mort, total: deed + mort };
  }

  /* Yukon has no land transfer tax. The Land Titles Office charges
     a flat transfer fee by declared value band (Land Titles Tariff
     of Fees Regulation): under $100,000 $50; $100,000–$499,999.99
     $150; $500,000–$2,999,999.99 $350; $3,000,000–$9,999,999.99
     $550; $10,000,000 or more $750. An assurance fund fee also
     applies — $20 plus $10 per $10,000 of the increase in value
     since the last transfer — and a separate mortgage registration
     fee; neither is in this number because they depend on the
     property's history and the mortgage. */
  function yukonFees(price) {
    var transfer;
    if (price < 100000) transfer = 50;
    else if (price < 500000) transfer = 150;
    else if (price < 3000000) transfer = 350;
    else if (price < 10000000) transfer = 550;
    else transfer = 750;
    return { transfer: transfer, mort: 0, total: transfer };
  }

  /* Northwest Territories has no land transfer tax. The Land Titles
     Office charges $2 per $1,000 of value up to $1,000,000
     (minimum $100), then $2,000 plus $1.50 per $1,000 above
     $1,000,000; registering the mortgage is $1.50 per $1,000 of
     the amount secured (minimum $80). September 2025 schedule. */
  function nwtFees(price, mortgage) {
    var transfer = price <= 1000000
      ? Math.max(100, 0.002 * price)
      : 2000 + 0.0015 * (price - 1000000);
    var mort = Math.max(80, 0.0015 * mortgage);
    return { transfer: transfer, mort: mort, total: transfer + mort };
  }

  /* Nunavut has no land transfer tax. The Legal Registries Office
     charges $1.50 per $1,000 of value up to $1,000,000 (minimum
     $60), then $1,500 plus $1 per $1,000 above $1,000,000;
     registering the mortgage is $1 per $1,000 of the amount
     secured (minimum $40). */
  function nunavutFees(price, mortgage) {
    var transfer = price <= 1000000
      ? Math.max(60, 0.0015 * price)
      : 1500 + 0.001 * (price - 1000000);
    var mort = Math.max(40, 0.001 * mortgage);
    return { transfer: transfer, mort: mort, total: transfer + mort };
  }

  /* ---------- affordability solver ---------- */

  function solve(inp) {
    var grossMonthly = inp.income / 12;
    var qualifyRate = Math.max(inp.rate + 2, 5.25); // stress test
    var gdsCap = 0.39 * grossMonthly;
    var tdsCap = 0.44 * grossMonthly - inp.debts;
    var housingCap = Math.min(gdsCap, tdsCap);
    var nonMortgage = inp.taxAnnual / 12 + inp.heating + 0.5 * inp.condo;
    var payCap = housingCap - nonMortgage;

    if (payCap <= 0) {
      return { feasible: false, reason: 'Your property tax, heating and condo fees alone already use up the amount the 39%/44% limits allow for housing. Lower your other debts, or look at homes with lower taxes and fees.' };
    }

    function feasible(price) {
      if (price <= inp.down) return false;
      if (inp.down < minDown(price)) return false; // minimum down payment
      var downPct = (inp.down / price) * 100;
      if (downPct < 20 && price >= 1500000) return false; // no insurance above $1.5M
      var mortgage = (price - inp.down) * (1 + cmhcRate(downPct, inp.amort));
      return monthlyPayment(mortgage, qualifyRate, inp.amort) <= payCap;
    }

    var lo = inp.down + 1000, hi = 10000000;
    if (!feasible(lo)) {
      return { feasible: false, reason: 'With this down payment you do not meet the minimum down payment (5% of the first $500,000, 10% above that). Save a larger down payment first.' };
    }
    if (feasible(hi)) {
      return { feasible: true, capped: true, maxPrice: hi, qualifyRate: qualifyRate, gdsCap: gdsCap, tdsCap: tdsCap };
    }
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (feasible(mid)) lo = mid; else hi = mid;
    }
    var maxPrice = lo;

    // Which limit is binding?
    var binding;
    var downPct = (inp.down / maxPrice) * 100;
    if (downPct < 20 && maxPrice >= 1499999) binding = 'the $1.5 million insurance cap';
    else if (inp.down <= minDown(maxPrice) + 1) binding = 'the minimum down payment';
    else if (tdsCap <= gdsCap) binding = 'your total debt service ratio (TDS)';
    else binding = 'your gross debt service ratio (GDS)';

    return {
      feasible: true, maxPrice: maxPrice, qualifyRate: qualifyRate,
      gdsCap: gdsCap, tdsCap: tdsCap, payCap: payCap, binding: binding
    };
  }

  /* Full breakdown for one set of inputs. */
  function calculate(inp) {
    var solved = solve(inp);
    if (!solved.feasible) return solved;

    var price = solved.maxPrice;
    var downPct = (inp.down / price) * 100;
    var premiumRate = cmhcRate(downPct, inp.amort);
    var baseMortgage = price - inp.down;
    var premium = baseMortgage * premiumRate;
    var mortgage = baseMortgage + premium;
    var payment = monthlyPayment(mortgage, inp.rate, inp.amort);

    var ltt, lttLabel, pst = 0, pstLabel = '';
    if (inp.province === 'ontario') {
      ltt = ontarioLTT(price, inp.firstTime);
      lttLabel = 'Ontario land transfer tax';
      if (premium > 0) { pst = 0.08 * premium; pstLabel = 'Ontario PST on the CMHC premium (8%, cash)'; }
    } else if (inp.province === 'alberta') {
      var fees = albertaFees(price, mortgage);
      ltt = { tax: fees.total, saving: 0, payable: fees.total };
      lttLabel = 'Alberta Land Titles fees (no land transfer tax)';
    } else if (inp.province === 'manitoba') {
      ltt = manitobaLTT(price);
      lttLabel = 'Manitoba land transfer tax';
    } else if (inp.province === 'saskatchewan') {
      var sfees = saskFees(price, mortgage);
      ltt = { tax: sfees.total, saving: 0, payable: sfees.total };
      lttLabel = 'Saskatchewan Land Titles fees (no land transfer tax)';
      if (premium > 0) { pst = 0.06 * premium; pstLabel = 'Saskatchewan PST on the CMHC premium (6%, cash)'; }
    } else if (inp.province === 'quebec') {
      ltt = quebecLTT(price, inp.firstTime);
      lttLabel = 'Quebec welcome tax (provincial brackets)';
      if (premium > 0) { pst = 0.09 * premium; pstLabel = 'Quebec tax on the CMHC premium (9% in 2026, cash)'; }
    } else if (inp.province === 'newbrunswick') {
      ltt = nbLTT(price);
      lttLabel = 'New Brunswick transfer tax + registration fees';
    } else if (inp.province === 'novascotia') {
      ltt = nsDTT(price);
      lttLabel = 'Nova Scotia deed transfer tax (Halifax rate, 1.5%)';
    } else if (inp.province === 'pei') {
      ltt = peiLTT(price, inp.firstTime);
      lttLabel = 'PEI real property transfer tax';
    } else if (inp.province === 'newfoundland') {
      var nfees = nlFees(price, mortgage);
      ltt = { tax: nfees.total, saving: 0, payable: nfees.total };
      lttLabel = 'Newfoundland and Labrador Registry of Deeds fees (no land transfer tax)';
    } else if (inp.province === 'yukon') {
      var yfees = yukonFees(price);
      ltt = { tax: yfees.total, saving: 0, payable: yfees.total };
      lttLabel = 'Yukon Land Titles transfer fee (no land transfer tax)';
    } else if (inp.province === 'nwt') {
      var wfees = nwtFees(price, mortgage);
      ltt = { tax: wfees.total, saving: 0, payable: wfees.total };
      lttLabel = 'Northwest Territories Land Titles fees (no land transfer tax)';
    } else if (inp.province === 'nunavut') {
      var ufees = nunavutFees(price, mortgage);
      ltt = { tax: ufees.total, saving: 0, payable: ufees.total };
      lttLabel = 'Nunavut Land Titles fees (no land transfer tax)';
    } else {
      ltt = bcLTT(price, inp.firstTime);
      lttLabel = 'BC property transfer tax';
    }

    var legal = 1500;
    var cashTotal = inp.down + ltt.payable + legal + premium + pst;
    var cashOutOfPocket = inp.down + ltt.payable + legal + pst;

    return {
      feasible: true, maxPrice: price,
      comfortablePrice: price * 0.88, // about 12% below the max — a suggestion
      downPct: downPct, premiumRate: premiumRate, premium: premium,
      baseMortgage: baseMortgage, mortgage: mortgage,
      payment: payment, qualifyRate: solved.qualifyRate,
      gdsCap: solved.gdsCap, tdsCap: solved.tdsCap,
      binding: solved.binding, ltt: ltt, lttLabel: lttLabel, pst: pst, pstLabel: pstLabel,
      legal: legal, cashTotal: cashTotal, cashOutOfPocket: cashOutOfPocket
    };
  }

  /* Expose the pure functions for Node tests. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      money: money, monthlyPayment: monthlyPayment, cmhcRate: cmhcRate,
      minDown: minDown, bcLTT: bcLTT, ontarioLTT: ontarioLTT,
      albertaFees: albertaFees, manitobaLTT: manitobaLTT,
      saskFees: saskFees, quebecLTT: quebecLTT, montrealLTT: montrealLTT,
      nbLTT: nbLTT, nsDTT: nsDTT, peiLTT: peiLTT, nlFees: nlFees,
      yukonFees: yukonFees, nwtFees: nwtFees, nunavutFees: nunavutFees,
      solve: solve, calculate: calculate
    };
  }

  /* ---------- page wiring ---------- */

  if (typeof document === 'undefined') return;

  function num(id, fallback) {
    var el = document.getElementById(id);
    if (!el) return fallback;
    var v = parseFloat(String(el.value).replace(/[^0-9.]/g, ''));
    return isNaN(v) ? fallback : v;
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function show(id, on) {
    var el = document.getElementById(id);
    if (el) el.style.display = on ? '' : 'none';
  }

  function readInputs() {
    var provinceEl = document.getElementById('province');
    var firstTimeEl = document.getElementById('first-time');
    return {
      income: num('income', 100000),
      debts: num('debts', 0),
      down: num('down', 50000),
      rate: num('rate', 5),
      amort: num('amort', 25),
      taxAnnual: num('tax', 3600),
      heating: num('heating', 150),
      condo: num('condo', 0),
      province: provinceEl ? provinceEl.value : 'bc',
      firstTime: firstTimeEl ? firstTimeEl.checked : true
    };
  }

  function updateMain() {
    var inp = readInputs();
    var r = calculate(inp);
    if (!r.feasible) {
      show('results', false);
      show('no-result', true);
      show('sticky-bar', false);
      setText('no-result-text', r.reason);
      return;
    }
    show('results', true);
    show('no-result', false);
    show('sticky-bar', true);
    setText('sticky-max', money(r.maxPrice));
    setText('out-max', money(r.maxPrice));
    setText('out-comfortable', money(r.comfortablePrice));
    setText('out-payment', money(r.payment) + ' / month');
    setText('out-mortgage', money(r.mortgage));
    setText('out-qualify', r.qualifyRate.toFixed(2) + '%');
    setText('out-binding', r.binding);
    setText('out-cmhc', r.premiumRate > 0
      ? money(r.premium) + ' (' + (r.premiumRate * 100).toFixed(2) + '% of the mortgage)'
      : 'None — you put 20% or more down.');
    setText('out-cmhc2', r.premiumRate > 0 ? money(r.premium) : '$0');
    setText('out-ltt-label', r.lttLabel + ':');
    setText('out-ltt', money(r.ltt.payable) + (r.ltt.saving > 0 ? ' (you save ' + money(r.ltt.saving) + ' with first-time buyer relief)' : '') + (r.ltt.credit > 0 ? ' — first-time buyers can claim up to ' + money(r.ltt.credit) + ' back later on their tax return' : ''));
    setText('out-down', money(inp.down));
    setText('out-legal', money(r.legal));
    show('row-pst', r.pst > 0);
    setText('row-pst-dt', r.pstLabel);
    setText('row-pst-dd', money(r.pst));
    setText('out-cash-total', money(r.cashTotal));
    setText('out-cash-pocket', money(r.cashOutOfPocket));
  }

  /* Small land-transfer-tax calculator used on the province pages. */
  function updateLTT() {
    var priceEl = document.getElementById('ltt-price');
    if (!priceEl) return;
    var price = num('ltt-price', 0);
    var kind = priceEl.getAttribute('data-ltt');
    var firstTimeEl = document.getElementById('ltt-first-time');
    var firstTime = firstTimeEl ? firstTimeEl.checked : false;
    var out = document.getElementById('ltt-result');
    if (!out || price <= 0) { if (out) out.textContent = ''; return; }
    if (kind === 'bc') {
      var b = bcLTT(price, firstTime);
      out.textContent = 'Tax: ' + money(b.tax) + (firstTime ? ' — first-time saving: ' + money(b.saving) + ' — you pay: ' + money(b.payable) : ' — you pay: ' + money(b.payable));
    } else if (kind === 'ontario') {
      var o = ontarioLTT(price, firstTime);
      out.textContent = 'Tax: ' + money(o.tax) + (firstTime ? ' — first-time rebate: ' + money(o.saving) + ' — you pay: ' + money(o.payable) : ' — you pay: ' + money(o.payable));
    } else if (kind === 'alberta') {
      var mort = num('ltt-mortgage', price * 0.8);
      var a = albertaFees(price, mort);
      out.textContent = 'Transfer fee: ' + money(a.transfer) + ' — mortgage fee: ' + money(a.mort) + ' — total: ' + money(a.total);
    } else if (kind === 'manitoba') {
      var m = manitobaLTT(price);
      out.textContent = 'Land transfer tax: ' + money(m.tax) + ' — Manitoba has no first-time buyer relief, so everyone pays the same.';
    } else if (kind === 'saskatchewan') {
      var mortS = num('ltt-mortgage', price * 0.8);
      var s = saskFees(price, mortS);
      out.textContent = 'Title transfer fee: ' + money(s.transfer) + ' — mortgage fee: ' + money(s.mort) + ' — total: ' + money(s.total);
    } else if (kind === 'quebec') {
      var mtlEl = document.getElementById('ltt-montreal');
      var inMontreal = mtlEl ? mtlEl.checked : false;
      var q = inMontreal ? montrealLTT(price, firstTime) : quebecLTT(price, firstTime);
      out.textContent = 'Welcome tax' + (inMontreal ? ' (Montreal rates)' : ' (provincial rates)') + ': ' + money(q.tax) + (firstTime ? ' — first-time buyers can claim up to ' + money(q.credit) + ' back on their tax return (you still pay the full bill first)' : '');
    } else if (kind === 'newbrunswick') {
      var nb = nbLTT(price);
      out.textContent = 'Transfer tax (1%): ' + money(nb.tax) + ' — registration fees: $168 — total: ' + money(nb.payable);
    } else if (kind === 'novascotia') {
      var ns = nsDTT(price);
      out.textContent = 'Deed transfer tax at Halifax\'s 1.5% rate: ' + money(ns.tax) + ' — other municipalities charge 1% to 1.5%, and there is no first-time buyer relief.';
    } else if (kind === 'pei') {
      var p = peiLTT(price, firstTime);
      out.textContent = 'Transfer tax: ' + money(p.tax) + (firstTime ? ' — first-time buyer exemption: ' + money(p.saving) + ' — you pay: ' + money(p.payable) : ' — you pay: ' + money(p.payable));
    } else if (kind === 'newfoundland') {
      var mortN = num('ltt-mortgage', price * 0.8);
      var nl = nlFees(price, mortN);
      out.textContent = 'Deed fee: ' + money(nl.transfer) + ' — mortgage fee: ' + money(nl.mort) + ' — total: ' + money(nl.total);
    } else if (kind === 'yukon') {
      var y = yukonFees(price);
      out.textContent = 'Transfer fee: ' + money(y.total) + ' — the assurance fund fee and the mortgage registration fee are extra and not in this number.';
    } else if (kind === 'nwt') {
      var mortW = num('ltt-mortgage', price * 0.8);
      var w = nwtFees(price, mortW);
      out.textContent = 'Transfer fee: ' + money(w.transfer) + ' — mortgage fee: ' + money(w.mort) + ' — total: ' + money(w.total);
    } else if (kind === 'nunavut') {
      var mortU = num('ltt-mortgage', price * 0.8);
      var u = nunavutFees(price, mortU);
      out.textContent = 'Transfer fee: ' + money(u.transfer) + ' — mortgage fee: ' + money(u.mort) + ' — total: ' + money(u.total);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var inputs = document.querySelectorAll('#calculator input, #calculator select');
    inputs.forEach(function (el) {
      el.addEventListener('input', updateMain);
      el.addEventListener('change', updateMain);
    });
    if (document.getElementById('calculator')) updateMain();

    var lttInputs = document.querySelectorAll('#ltt-calculator input');
    lttInputs.forEach(function (el) {
      el.addEventListener('input', updateLTT);
      el.addEventListener('change', updateLTT);
    });
    if (document.getElementById('ltt-calculator')) updateLTT();

    var exampleBtn = document.getElementById('load-example');
    if (exampleBtn) {
      exampleBtn.addEventListener('click', function () {
        var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
        set('income', 100000); set('debts', 500); set('down', 50000);
        set('rate', 5); set('amort', 25); set('tax', 3600);
        set('heating', 150); set('condo', 0);
        var p = document.getElementById('province'); if (p) p.value = 'bc';
        var f = document.getElementById('first-time'); if (f) f.checked = true;
        updateMain();
        document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  });
})();
