/* Blockwall LiveTape — upgrade the snapshot tape to realtime (CoinGecko + DefiLlama).
   Mutates the rendered tape cells + live ticker in place; falls back to snapshot
   silently on any failure. window.LiveTape.upgrade(edition). */
(function (global) {
  "use strict";
  var CACHE_KEY = "bw_live_tape_v2", TTL = 60000;

  function money(n) { return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 }); }
  function compact(n) { n = Number(n); if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T"; if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B"; if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M"; return "$" + Math.round(n); }
  function pct(c) { return (c >= 0 ? "+" : "") + Number(c).toFixed(1) + "%"; }
  function dirOf(c) { return Math.abs(c) < 0.05 ? "flat" : (c < 0 ? "down" : "up"); }
  function norm(l) { return String(l || "").toUpperCase().replace(/\s+/g, " ").trim(); }
  function thin(a, t) { if (!a || !a.length) return null; var step = Math.max(1, Math.floor(a.length / t)), o = []; for (var i = 0; i < a.length; i += step) o.push(a[i][1]); if (o[o.length - 1] !== a[a.length - 1][1]) o.push(a[a.length - 1][1]); return o; }

  function getJSON(url) {
    var ac = new AbortController(), to = setTimeout(function () { ac.abort(); }, 4500);
    return fetch(url, { signal: ac.signal }).then(function (r) { clearTimeout(to); if (!r.ok) throw 0; return r.json(); });
  }

  function fetchLive() {
    try { var c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null"); if (c && Date.now() - c.t < TTL) return Promise.resolve(c.d); } catch (e) {}
    var P = [
      getJSON("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true").catch(function () { return null; }),
      getJSON("https://api.coingecko.com/api/v3/global").catch(function () { return null; }),
      getJSON("https://api.llama.fi/v2/historicalChainTvl").catch(function () { return null; }),
      getJSON("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7").catch(function () { return null; }),
      getJSON("https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=7").catch(function () { return null; })
    ];
    return Promise.all(P).then(function (r) {
      var price = r[0], glob = r[1], tvlArr = r[2], btcChart = r[3], ethChart = r[4], live = {};
      if (price && price.bitcoin) live["BTC"] = { value: money(price.bitcoin.usd), pct: pct(price.bitcoin.usd_24h_change), dir: dirOf(price.bitcoin.usd_24h_change), win: "24h" };
      if (price && price.ethereum) live["ETH"] = { value: money(price.ethereum.usd), pct: pct(price.ethereum.usd_24h_change), dir: dirOf(price.ethereum.usd_24h_change), win: "24h" };
      if (glob && glob.data) { var m = glob.data.total_market_cap.usd, mc = glob.data.market_cap_change_percentage_24h_usd; live["TOTAL MKT CAP"] = { value: compact(m), pct: pct(mc), dir: dirOf(mc), win: "24h" }; }
      if (tvlArr && tvlArr.length > 1) { var last = tvlArr[tvlArr.length - 1].tvl, prev = tvlArr[tvlArr.length - 2].tvl, tc = prev ? (last - prev) / prev * 100 : 0; live["DEFI TVL"] = { value: compact(last), pct: pct(tc), dir: dirOf(tc), win: "1d" }; }
      if (live["BTC"]) live["BTC"].spark = thin(btcChart && btcChart.prices, 30);
      if (live["ETH"]) live["ETH"].spark = thin(ethChart && ethChart.prices, 30);
      live._updated = (price && price.bitcoin && price.bitcoin.last_updated_at) ? price.bitcoin.last_updated_at * 1000 : Date.now();
      if (Object.keys(live).length > 1) { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d: live })); } catch (e) {} return live; }
      return null;
    });
  }

  function setDelta(el, rec) {
    if (!el) return; el.className = "delta " + rec.dir; el.textContent = "";
    var g = document.createElement("span"); g.className = "g"; g.textContent = rec.dir === "up" ? "▲" : rec.dir === "down" ? "▼" : "–"; el.appendChild(g);
    el.appendChild(document.createTextNode(rec.pct));
    var w = document.createElement("span"); w.className = "win"; w.textContent = rec.win; el.appendChild(w);
  }

  function applyDOM(live, updated) {
    document.querySelectorAll(".tape .tape-cell").forEach(function (cell) {
      var lab = cell.querySelector(".tape-label"); if (!lab) return; var key = norm(lab.textContent); var rec = live[key]; if (!rec) return;
      var p = cell.querySelector(".tape-price");
      if (p) { if (p.textContent !== rec.value) { cell.classList.remove("lt-flash"); void cell.offsetWidth; cell.classList.add("lt-flash"); } p.textContent = rec.value; }
      setDelta(cell.querySelector(".delta"), rec);
      if ((key === "BTC" || key === "ETH") && rec.spark && window.BWSpark && !cell.querySelector(".tape-spark")) {
        var sp = document.createElement("div"); sp.className = "tape-spark"; sp.setAttribute("aria-hidden", "true"); sp.innerHTML = window.BWSpark.svg(rec.spark, { w: 64, h: 18 }); cell.appendChild(sp);
      }
    });
    document.querySelectorAll(".livetape .lt-cell").forEach(function (cell) {
      var lab = cell.querySelector(".lt-label"); if (!lab) return; var rec = live[norm(lab.textContent)]; if (!rec) return;
      var p = cell.querySelector(".lt-price"); if (p) p.textContent = rec.value;
      var d = cell.querySelector(".lt-delta"); if (d) { d.className = "lt-delta " + rec.dir + " num"; d.textContent = (rec.dir === "up" ? "▲ " : rec.dir === "down" ? "▼ " : "– ") + rec.pct; }
    });
    var asof = document.querySelector(".tape-asof");
    if (asof) { asof.textContent = ""; var w = document.createElement("span"); w.className = "lt-live"; var dot = document.createElement("span"); dot.className = "lt-live-dot"; w.appendChild(dot);
      var t = document.createElement("span"); var secs = Math.max(0, Math.round((Date.now() - updated) / 1000)); t.textContent = "LIVE · CoinGecko + DefiLlama · updated " + secs + "s ago"; w.appendChild(t); asof.appendChild(w);
      asof.__updated = updated; }
  }

  function tickAgo() { var asof = document.querySelector(".tape-asof"); if (asof && asof.__updated) { var t = asof.querySelector(".lt-live span:last-child"); if (t) { var secs = Math.max(0, Math.round((Date.now() - asof.__updated) / 1000)); t.textContent = "LIVE · CoinGecko + DefiLlama · updated " + secs + "s ago"; } } }

  global.LiveTape = {
    _started: false,
    upgrade: function (ed) {
      if (!ed || !ed.market_snapshot || !ed.market_snapshot.items) return;
      function run() {
        fetchLive().then(function (live) {
          if (!live) return;
          ed.market_snapshot.items.forEach(function (it) { var rec = live[norm(it.label)]; if (rec) { it.value = rec.value; it.change_24h = rec.pct; it.direction = rec.dir; } });
          applyDOM(live, live._updated);
        }).catch(function () {});
      }
      run();
      if (!global.LiveTape._started) {
        global.LiveTape._started = true;
        setInterval(tickAgo, 15000);
        setInterval(function () { if (document.visibilityState === "visible") run(); }, 60000);
      }
    }
  };
})(window);
