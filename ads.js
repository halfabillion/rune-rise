/* Thin ad abstraction. Default provider is a no-op stub (grants rewards so the game is fully playable).
 * To go live, load the portal SDK <script> in index.html and the matching adapter is picked automatically:
 *   CrazyGames: https://sdk.crazygames.com/crazygames-sdk-v3.js   -> window.CrazyGames.SDK
 *   Poki:       https://game-cdn.poki.com/scripts/v2/poki-sdk.js  -> window.PokiSDK
 *   GamePix / GameMonetize: see build.js targets (script tags are injected per portal build).
 * RR_BUILD.ads === false (licence build) forces the silent stub.
 * On iOS/Android (Capacitor) the AdMob adapter is used.
 * Nothing here signs up for or calls any network service on its own. */
(function (root) {
  'use strict';
  var listeners = { pause: [], resume: [] };
  function emit(k) { listeners[k].forEach(function (f) { try { f(); } catch (e) {} }); }
  var lastInterstitial = 0, INTERSTITIAL_GAP_MS = 60000;

  var stub = {
    name: 'stub',
    init: function () { return Promise.resolve(); },
    rewarded: function (placement) {
      // Simulate a short "ad" so UX flows (pause/resume, button states) are exercised.
      emit('pause');
      return new Promise(function (res) { setTimeout(function () { emit('resume'); res(true); }, 350); });
    },
    interstitial: function () { return Promise.resolve(); },
    gameplayStart: function () {}, gameplayStop: function () {}, happyTime: function () {}, loadingDone: function () {}
  };

  var crazy = {
    name: 'crazygames',
    sdk: function () { return root.CrazyGames && root.CrazyGames.SDK; },
    init: function () { return this.sdk().init ? this.sdk().init() : Promise.resolve(); },
    _ad: function (type) {
      var sdk = this.sdk();
      return new Promise(function (res) {
        sdk.ad.requestAd(type, {
          adStarted: function () { emit('pause'); },
          adFinished: function () { emit('resume'); res(true); },
          adError: function () { emit('resume'); res(false); }
        });
      });
    },
    rewarded: function () { return this._ad('rewarded'); },
    interstitial: function () { return this._ad('midgame'); },
    gameplayStart: function () { try { this.sdk().game.gameplayStart(); } catch (e) {} },
    gameplayStop: function () { try { this.sdk().game.gameplayStop(); } catch (e) {} },
    happyTime: function () { try { this.sdk().game.happytime(); } catch (e) {} },
    loadingDone: function () { try { this.sdk().game.loadingStop(); } catch (e) {} }
  };

  var poki = {
    name: 'poki',
    init: function () { return root.PokiSDK.init(); },
    rewarded: function () {
      emit('pause');
      return root.PokiSDK.rewardedBreak().then(function (ok) { emit('resume'); return !!ok; }, function () { emit('resume'); return false; });
    },
    interstitial: function () {
      emit('pause');
      return root.PokiSDK.commercialBreak().then(function () { emit('resume'); }, function () { emit('resume'); });
    },
    gameplayStart: function () { try { root.PokiSDK.gameplayStart(); } catch (e) {} },
    gameplayStop: function () { try { root.PokiSDK.gameplayStop(); } catch (e) {} },
    happyTime: function () {},
    loadingDone: function () { try { root.PokiSDK.gameLoadingFinished(); } catch (e) {} }
  };

  /* AdMob via @capacitor-community/admob inside the Capacitor iOS/Android app.
   * Replace the Google TEST unit IDs below with your real ones before release (see README). */
  var ADMOB_IDS = {
    ios:     { rewarded: 'ca-app-pub-3940256099942544/1712485313', interstitial: 'ca-app-pub-3940256099942544/4411468910' },
    android: { rewarded: 'ca-app-pub-3940256099942544/5224354917', interstitial: 'ca-app-pub-3940256099942544/1033173712' }
  };
  var admob = {
    name: 'admob',
    plugin: function () { return root.Capacitor.Plugins.AdMob; },
    ids: function () { var pf = root.Capacitor.getPlatform && root.Capacitor.getPlatform(); return ADMOB_IDS[pf === 'android' ? 'android' : 'ios']; },
    init: function () {
      var A = this.plugin(), self = this;
      return A.initialize({ initializeForTesting: false })
        .then(function () { // UK/EEA consent (UMP) then iOS App Tracking Transparency
          return A.requestConsentInfo().then(function (ci) {
            if (ci && ci.isConsentFormAvailable && ci.status === 'REQUIRED') return A.showConsentForm();
          }).catch(function () {});
        })
        .then(function () { return A.trackingAuthorizationStatus ? A.trackingAuthorizationStatus() : null; })
        .then(function (st) { if (st && st.status === 'notDetermined') return A.requestTrackingAuthorization(); })
        .catch(function () {})
        .then(function () { self.preload(); });
    },
    preload: function () {
      var A = this.plugin(), id = this.ids();
      A.prepareRewardVideoAd({ adId: id.rewarded }).catch(function () {});
      A.prepareInterstitial({ adId: id.interstitial }).catch(function () {});
    },
    rewarded: function () {
      var A = this.plugin(), self = this; emit('pause');
      return A.showRewardVideoAd().then(function (reward) { emit('resume'); self.preload(); return !!reward; },
        function () { emit('resume'); self.preload(); return false; });
    },
    interstitial: function () {
      var A = this.plugin(), self = this; emit('pause');
      return A.showInterstitial().then(function () { emit('resume'); self.preload(); }, function () { emit('resume'); self.preload(); });
    },
    gameplayStart: function () {}, gameplayStop: function () {}, happyTime: function () {}, loadingDone: function () {}
  };

  /* GamePix SDK v3 (window.GamePix) */
  var gamepix = {
    name: 'gamepix',
    init: function () { return Promise.resolve(); },
    rewarded: function () { emit('pause'); return root.GamePix.rewardAd().then(function (r) { emit('resume'); return !!(r && r.success); }, function () { emit('resume'); return false; }); },
    interstitial: function () { emit('pause'); return root.GamePix.interstitialAd().then(function () { emit('resume'); }, function () { emit('resume'); }); },
    gameplayStart: function () {}, gameplayStop: function () {},
    happyTime: function () { try { root.GamePix.happyMoment(); } catch (e) {} },
    loadingDone: function () { try { root.GamePix.loaded(); } catch (e) {} }
  };
  /* GameMonetize SDK (window.sdk + window.SDK_OPTIONS). It only exposes showBanner(); the game resumes on SDK_GAME_START. */
  var gamemonetize = {
    name: 'gamemonetize',
    init: function () { return Promise.resolve(); },
    _show: function () {
      return new Promise(function (res) {
        var done = false; emit('pause');
        root.__rrGMResume = function () { if (done) return; done = true; emit('resume'); res(true); };
        try { root.sdk.showBanner(); } catch (e) { root.__rrGMResume(); }
        setTimeout(function () { root.__rrGMResume && root.__rrGMResume(); }, 45000);
      });
    },
    rewarded: function () { return this._show(); },
    interstitial: function () { return this._show(); },
    gameplayStart: function () {}, gameplayStop: function () {}, happyTime: function () {}, loadingDone: function () {}
  };

  function pick() {
    var B = root.RR_BUILD || {};
    if (B.ads === false) return stub;
    if (root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform() && root.Capacitor.Plugins && root.Capacitor.Plugins.AdMob) return admob;
    if (root.CrazyGames && root.CrazyGames.SDK) return crazy;
    if (root.PokiSDK) return poki;
    if (root.GamePix && root.GamePix.rewardAd) return gamepix;
    if (root.sdk && root.sdk.showBanner) return gamemonetize;
    return stub;
  }
  var p = stub, playing = false, noAds = false;
  var Ads = {
    get provider() { return p.name; },
    init: function () { p = pick(); return p.init().catch(function () { p = stub; }); },
    on: function (k, f) { listeners[k].push(f); },
    /** Rewarded video. Resolves true only if the reward should be granted. placement: 'revive' | 'undo' */
    rewarded: function (placement) { return p.rewarded(placement).catch(function () { return false; }); },
    /** Interstitial between rounds; frequency-capped here as well as by the portal. */
    /** 'Remove ads' purchase disables interstitials; rewarded stays available because it's opt-in. */
    setNoAds: function (v) { noAds = !!v; },
    get noAds() { return noAds; },
    /** false in the licence build: the game hides every ad-gated button. */
    get enabled() { return (root.RR_BUILD || {}).ads !== false; },
    interstitial: function () {
      if (noAds) return Promise.resolve();
      var now = Date.now();
      if (now - lastInterstitial < INTERSTITIAL_GAP_MS) return Promise.resolve();
      lastInterstitial = now;
      return p.interstitial().catch(function () {});
    },
    gameplayStart: function () { if (!playing) { playing = true; p.gameplayStart(); } },
    gameplayStop: function () { if (playing) { playing = false; p.gameplayStop(); } },
    happyTime: function () { p.happyTime(); },
    loadingDone: function () { p.loadingDone(); }
  };
  root.Ads = Ads;
})(this);
