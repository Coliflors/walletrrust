/* Request Cards — read-only wallet connector.
 *
 * One-button flow:
 *   1) If injected provider exists (Trust in-app browser, MetaMask, etc.) → eth_requestAccounts.
 *   2) If mobile and no provider → deep-link to Trust Wallet in-app browser.
 *   3) If desktop and no provider → WalletConnect v2 (QR modal).
 *
 * After connect (Ethereum mainnet only):
 *   - Display the public address.
 *   - Read USDT balance via eth_call balanceOf — purely read-only, no signing.
 *
 * Required globals (loaded in wallet.html):
 *   - window.EthereumProvider (from @walletconnect/ethereum-provider UMD)
 */
(function () {
  "use strict";

  // ====== CONFIG ======
  var WC_PROJECT_ID = "b8551df7f4e563745233d2e499c2fa73";
  var WC_METADATA = {
    name: "Request Cards",
    description: "Request Cards dApp",
    url: "https://www.requestcards.com",
    icons: ["https://www.requestcards.com/images/logo-256.png"]
  };
  var ETH_CHAIN_ID = 1; // Ethereum mainnet
  var USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7"; // USDT on Ethereum
  var USDT_DECIMALS = 6;
  var FALLBACK_RPC = "https://eth.llamarpc.com";

  // ====== DOM ======
  var statusEl = document.getElementById("status");
  var statusText = document.getElementById("statusText");
  var addrBox = document.getElementById("addressBox");
  var addrEl = document.getElementById("address");
  var usdtEl = document.getElementById("usdtBalance");
  var connectBtn = document.getElementById("connectBtn");
  var disconnectBtn = document.getElementById("disconnectBtn");

  // ====== State ======
  var state = {
    provider: null,   // EIP-1193 provider (injected or WalletConnect)
    address: null,
    isWC: false
  };

  // ====== Helpers ======
  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusText.textContent = msg;
    statusEl.classList.remove("ok", "error", "loading");
    if (kind) statusEl.classList.add(kind);
  }

  function short(addr) {
    if (!addr) return "—";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  function isMobile() {
    return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function render() {
    if (state.address) {
      addrBox.classList.add("visible");
      addrEl.textContent = state.address;
      connectBtn.style.display = "none";
      disconnectBtn.style.display = "";
      setStatus("Connected", "ok");
    } else {
      addrBox.classList.remove("visible");
      addrEl.textContent = "—";
      usdtEl.textContent = "—";
      connectBtn.style.display = "";
      disconnectBtn.style.display = "none";
      setStatus("Not connected");
    }
  }

  // ====== USDT read-only balance ======
  function padAddress(addr) {
    return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  }

  async function fetchUsdtBalance(addr) {
    var data = "0x70a08231" + padAddress(addr); // balanceOf(address)
    // Try via current provider first (so we use the user's RPC)
    try {
      if (state.provider && state.provider.request) {
        var hex = await state.provider.request({
          method: "eth_call",
          params: [{ to: USDT_ADDRESS, data: data }, "latest"]
        });
        return formatUsdt(hex);
      }
    } catch (e) { /* fall through */ }
    // Public RPC fallback
    try {
      var res = await fetch(FALLBACK_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "eth_call",
          params: [{ to: USDT_ADDRESS, data: data }, "latest"]
        })
      });
      var json = await res.json();
      if (json && json.result) return formatUsdt(json.result);
    } catch (e2) { /* ignore */ }
    return null;
  }

  function formatUsdt(hex) {
    if (!hex || hex === "0x") return "0.00 USDT";
    try {
      var bi = BigInt(hex);
      var div = BigInt(Math.pow(10, USDT_DECIMALS));
      var whole = bi / div;
      var frac = bi % div;
      var fracStr = frac.toString().padStart(USDT_DECIMALS, "0").slice(0, 2);
      return whole.toString() + "." + fracStr + " USDT";
    } catch (e) {
      return "—";
    }
  }

  // ====== Connect flows ======
  async function connectInjected(provider) {
    var accounts = await provider.request({ method: "eth_requestAccounts" });
    if (!accounts || !accounts.length) throw new Error("No accounts");
    state.provider = provider;
    state.address = accounts[0];
    state.isWC = false;
    bindProviderEvents(provider);
  }

  function waitForWalletConnect(timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (window.EthereumProvider) return resolve();
      var to = setTimeout(function () {
        reject(new Error("WalletConnect failed to load"));
      }, timeoutMs);
      window.addEventListener("walletconnect-ready", function () {
        clearTimeout(to);
        resolve();
      }, { once: true });
    });
  }

  async function connectWalletConnect() {
    if (!window.EthereumProvider) {
      setStatus("Loading WalletConnect…", "loading");
      await waitForWalletConnect(10000);
    }
    setStatus("Opening WalletConnect…", "loading");
    var wc = await window.EthereumProvider.init({
      projectId: WC_PROJECT_ID,
      chains: [ETH_CHAIN_ID],
      showQrModal: true,
      metadata: WC_METADATA
    });
    await wc.connect();
    var accounts = wc.accounts || (await wc.request({ method: "eth_accounts" }));
    if (!accounts || !accounts.length) throw new Error("No accounts");
    state.provider = wc;
    state.address = accounts[0];
    state.isWC = true;
    bindProviderEvents(wc);
  }

  function openTrustDeeplink() {
    var target = encodeURIComponent(location.href);
    // Trust Wallet universal deep-link to open the current URL inside Trust's in-app browser.
    window.location.href = "https://link.trustwallet.com/open_url?coin_id=60&url=" + target;
  }

  async function connect() {
    try {
      setStatus("Connecting…", "loading");

      // 1) Injected provider (Trust in-app browser, MetaMask extension, etc.)
      if (window.ethereum) {
        await connectInjected(window.ethereum);
      }
      // 2) Mobile without provider → bounce to Trust Wallet in-app browser
      else if (isMobile()) {
        setStatus("Opening Trust Wallet…", "loading");
        openTrustDeeplink();
        return;
      }
      // 3) Desktop without provider → WalletConnect QR
      else {
        await connectWalletConnect();
      }

      render();

      // Fetch USDT balance (read-only)
      setStatus("Reading USDT balance…", "loading");
      var bal = await fetchUsdtBalance(state.address);
      usdtEl.textContent = bal || "unavailable";
      setStatus("Connected", "ok");
    } catch (e) {
      console.error(e);
      setStatus((e && e.message) ? e.message : "Connection failed", "error");
    }
  }

  function bindProviderEvents(p) {
    if (!p || typeof p.on !== "function") return;
    p.on("accountsChanged", function (accs) {
      if (!accs || !accs.length) disconnect();
      else { state.address = accs[0]; render(); fetchUsdtBalance(state.address).then(function (b) { usdtEl.textContent = b || "—"; }); }
    });
    p.on("disconnect", function () { disconnect(); });
  }

  async function disconnect() {
    try {
      if (state.isWC && state.provider && state.provider.disconnect) {
        await state.provider.disconnect();
      }
    } catch (e) { /* ignore */ }
    state.provider = null;
    state.address = null;
    state.isWC = false;
    render();
  }

  // ====== Wire UI ======
  if (connectBtn) connectBtn.addEventListener("click", connect);
  if (disconnectBtn) disconnectBtn.addEventListener("click", disconnect);
  render();
})();
