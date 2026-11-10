/* Licence build: ads disabled. Same API as the full ads.js, every call is a silent no-op. */
(function (root) { 'use strict';
  var noop = function () {}, ok = function () { return Promise.resolve(false); }, done = function () { return Promise.resolve(); };
  root.Ads = { provider: 'none', enabled: false, noAds: true, init: done, on: noop, rewarded: ok, interstitial: done,
    setNoAds: noop, gameplayStart: noop, gameplayStop: noop, happyTime: noop, loadingDone: noop };
})(this);
