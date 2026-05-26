/*!
 * wallet.js — Read-only wallet connector
 * Supports: Trust Wallet (injected), MetaMask (injected), WalletConnect v2
 * Reads: address, chainId. Listens: accountsChanged, chainChanged, disconnect.
 * Does NOT: sign, approve, permit, send transactions.
 *
 * Requires globals (loaded via CDN in wallet.html):
 *   - window.ethers  (ethers v6 UMD)
 *   - window.EthereumProvider  (from @walletconnect/ethereum-provider UMD)
 */
(function () {
  "use strict";

  // ====== CONFIG ======
  // Replace with your WalletConnect Cloud projectId: https://cloud.walletconnect.com
  var WC_PROJECT_ID = "b8551df7f4e563745233d2e499c2fa73";
  var WC_METADATA = {
    name: "Request Cards",
    description: "Request Cards dApp",
    url: "https://www.requestcards.com",
    icons: ["https://www.requestcards.com/favicon.ico"]
  };
  // Common EVM chains (Ethereum mainnet only required; extend as needed)
  var WC_CHAINS = [1];
  var WC_OPTIONAL_CHAINS = [56, 137, 42161, 10, 8453];

  // ====== DOM ======
  var statusEl = document.getElementById("status");
  var statusText = document.getElementById("statusText");
  var addrBox = document.getElementById("addressBox");
  var addrEl = document.getElementById("address");
  var chainEl = document.getElementById("chainId");
  var walletNameEl = document.getElementById("walletName");
  var connectBtn = document.getElementById("connectBtn");
  var disconnectBtn = document.getElementById("disconnectBtn");
  var walletOpts = document.querySelectorAll("[data-wallet]");

  // ====== STATE ======
  var state = {
    provider: null,        // EIP-1193 provider
    ethersProvider: null,  // ethers BrowserProvider
    address: null,
    chainId: null,
    walletName: null,
    isWC: false
  };

  // ====== UI helpers ======
  function setStatus(text, cls) {
    statusText.textContent = text;
    statusEl.classList.remove("connected", "error");
    if (cls) statusEl.classList.add(cls);
  }
  function shorten(a) { return a ? a.slice(0, 6) + "..." + a.slice(-4) : ""; }
  function render() {
    if (state.address) {
      addrBox.classList.add("visible");
      addrEl.textContent = state.address;
      chainEl.textContent = state.chainId != null ? String(state.chainId) : "—";
      walletNameEl.textContent = state.walletName || "—";
      connectBtn.style.display = "none";
      disconnectBtn.style.display = "flex";
      setStatus("Connected as " + shorten(state.address), "connected");
    } else {
      addrBox.classList.remove("visible");
      connectBtn.style.display = "flex";
      disconnectBtn.style.display = "none";
      setStatus("Not connected");
    }
  }

  // ====== Provider detection (injected wallets) ======
  function detectInjected(preference) {
    var eth = window.ethereum;
    if (!eth) return null;
    var list = (eth.providers && eth.providers.length) ? eth.providers : [eth];

    function nameOf(p) {
      if (p.isTrust || p.isTrustWallet) return "Trust Wallet";
      if (p.isMetaMask) return "MetaMask";
      return "Injected";
    }
    if (preference === "trust") {
      var t = list.find(function (p) { return p.isTrust || p.isTrustWallet; });
      if (t) return { provider: t, name: "Trust Wallet" };
    }
    if (preference === "metamask") {
      var m = list.find(function (p) { return p.isMetaMask && !p.isTrust && !p.isTrustWallet; });
      if (m) return { provider: m, name: "MetaMask" };
    }
    var first = list[0];
    return { provider: first, name: nameOf(first) };
  }

  // ====== Connect: injected ======
  async function connectInjected(preference) {
    var det = detectInjected(preference);
    if (!det || !det.provider) {
      setStatus("No wallet detected. Open this page inside Trust Wallet or install MetaMask.", "error");
      return;
    }
    try {
      setStatus("Requesting connection...");
      var accounts = await det.provider.request({ method: "eth_requestAccounts" });
      if (!accounts || !accounts.length) {
        setStatus("No account returned", "error");
        return;
      }
      var chainIdHex = await det.provider.request({ method: "eth_chainId" });
      state.provider = det.provider;
      state.address = accounts[0];
      state.chainId = parseInt(chainIdHex, 16);
      state.walletName = det.name;
      state.isWC = false;
      if (window.ethers && window.ethers.BrowserProvider) {
        state.ethersProvider = new window.ethers.BrowserProvider(det.provider);
      }
      bindProviderEvents(det.provider);
      render();
    } catch (e) {
      setStatus((e && e.message) ? e.message : "Connection rejected", "error");
    }
  }

  function waitForWalletConnect(timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (window.EthereumProvider) return resolve();
      var done = false;
      var to = setTimeout(function () {
        if (done) return;
        done = true;
        window.removeEventListener("walletconnect-ready", onReady);
        reject(new Error("WalletConnect library failed to load"));
      }, timeoutMs);
      function onReady() {
        if (done) return;
        done = true;
        clearTimeout(to);
        resolve();
      }
      window.addEventListener("walletconnect-ready", onReady, { once: true });
    });
  }

  // ====== Connect: WalletConnect v2 ======
  async function connectWalletConnect() {
    try {
      if (!window.EthereumProvider) {
        setStatus("Loading WalletConnect...");
        await waitForWalletConnect(8000);
      }
    } catch (e) {
      setStatus(e.message || "WalletConnect library not loaded", "error");
      return;
    }
    if (!WC_PROJECT_ID || WC_PROJECT_ID.indexOf("REPLACE_") === 0) {
      setStatus("Set your WalletConnect projectId in src/js/wallet.js.", "error");
      return;
    }
    try {
      setStatus("Opening WalletConnect...");
      var wc = await window.EthereumProvider.init({
        projectId: WC_PROJECT_ID,
        chains: WC_CHAINS,
        optionalChains: WC_OPTIONAL_CHAINS,
        showQrModal: true,
        metadata: WC_METADATA
      });
      await wc.connect();
      var accounts = wc.accounts || (await wc.request({ method: "eth_accounts" }));
      if (!accounts || !accounts.length) {
        setStatus("WalletConnect: no account", "error");
        return;
      }
      state.provider = wc;
      state.address = accounts[0];
      state.chainId = typeof wc.chainId === "number" ? wc.chainId : parseInt(wc.chainId, 16);
      state.walletName = "WalletConnect";
      state.isWC = true;
      if (window.ethers && window.ethers.BrowserProvider) {
        state.ethersProvider = new window.ethers.BrowserProvider(wc);
      }
      bindProviderEvents(wc);
      render();
    } catch (e) {
      setStatus((e && e.message) ? e.message : "WalletConnect failed", "error");
    }
  }

  // ====== Event listeners (EIP-1193) ======
  function bindProviderEvents(p) {
    if (!p || typeof p.on !== "function") return;
    p.on("accountsChanged", function (accs) {
      if (!accs || !accs.length) {
        disconnect();
      } else {
        state.address = accs[0];
        render();
      }
    });
    p.on("chainChanged", function (cid) {
      state.chainId = typeof cid === "string" ? parseInt(cid, 16) : cid;
      render();
    });
    p.on("disconnect", function () { disconnect(); });
  }

  // ====== Disconnect ======
  async function disconnect() {
    try {
      if (state.isWC && state.provider && typeof state.provider.disconnect === "function") {
        await state.provider.disconnect();
      }
    } catch (_) { /* ignore */ }
    state.provider = null;
    state.ethersProvider = null;
    state.address = null;
    state.chainId = null;
    state.walletName = null;
    state.isWC = false;
    render();
  }

  // ====== Wire up UI ======
  connectBtn.addEventListener("click", function () { connectInjected(); });
  disconnectBtn.addEventListener("click", disconnect);
  walletOpts.forEach(function (el) {
    el.addEventListener("click", function () {
      var w = el.getAttribute("data-wallet");
      if (w === "walletconnect") connectWalletConnect();
      else connectInjected(w);
    });
  });

  // Silent reconnect for injected providers
  (function silentReconnect() {
    if (!window.ethereum || !window.ethereum.request) return;
    window.ethereum.request({ method: "eth_accounts" })
      .then(function (a) {
        if (!a || !a.length) return;
        var det = detectInjected();
        if (!det) return;
        state.provider = det.provider;
        state.walletName = det.name;
        state.address = a[0];
        det.provider.request({ method: "eth_chainId" }).then(function (c) {
          state.chainId = parseInt(c, 16);
          if (window.ethers && window.ethers.BrowserProvider) {
            state.ethersProvider = new window.ethers.BrowserProvider(det.provider);
          }
          bindProviderEvents(det.provider);
          render();
        });
      })
      .catch(function () { /* ignore */ });
  })();

  render();

  // Expose minimal read-only API (no signing methods)
  window.WalletApp = {
    getState: function () {
      return {
        address: state.address,
        chainId: state.chainId,
        walletName: state.walletName,
        isWC: state.isWC
      };
    },
    disconnect: disconnect
  };
})();
