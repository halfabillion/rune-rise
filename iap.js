/* In-app purchase abstraction for the shard shop.
 * - Native app (Capacitor + cordova-plugin-purchase v13, window.CdvPurchase): real StoreKit purchases.
 * - Web / dev: stub. It only "succeeds" on localhost or with ?dev=1 so a public web build never grants free items.
 * Product IDs must match what you create in App Store Connect (see README). */
(function (root) {
  'use strict';
  var PRODUCTS = [
    { id: 'rr.shards.300',  type: 'consumable',    shards: 300,  title: 'Pouch of shards',  desc: '300 ◆',              price: '£0.99' },
    { id: 'rr.shards.1000', type: 'consumable',    shards: 1000, title: 'Chest of shards',  desc: '1,000 ◆ · best value', price: '£2.99' },
    { id: 'rr.shards.2800', type: 'consumable',    shards: 2800, title: 'Vault of shards',  desc: '2,800 ◆',            price: '£5.99' },
    { id: 'rr.noads',       type: 'nonconsumable', noAds: true,  title: 'Remove ads',       desc: 'No interstitials, forever', price: '£2.99' },
    { id: 'rr.starter',     type: 'nonconsumable', noAds: true, shards: 500, title: 'Starter bundle', desc: 'Remove ads + 500 ◆', price: '£3.99' }
  ];
  var grantFn = function () {};
  function byId(id) { for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].id === id) return PRODUCTS[i]; }

  var devOk = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(root.location.hostname) || /[?&]dev=1/.test(root.location.search) || root.location.protocol === 'file:';
  var stub = {
    name: 'stub', available: devOk,
    init: function () { return Promise.resolve(); },
    buy: function (id) {
      if (!devOk) return Promise.resolve({ ok: false, reason: 'web' });
      grantFn(byId(id)); return Promise.resolve({ ok: true, stub: true });
    },
    restore: function () { return Promise.resolve(); },
    price: function (id) { return byId(id).price; }
  };

  var cdv = {
    name: 'storekit', available: true,
    init: function () {
      var C = root.CdvPurchase, store = C.store;
      PRODUCTS.forEach(function (p) {
        store.register({ id: p.id, platform: C.Platform.APPLE_APPSTORE,
          type: p.type === 'consumable' ? C.ProductType.CONSUMABLE : C.ProductType.NON_CONSUMABLE });
      });
      store.when()
        .approved(function (t) { return t.verify(); })   // add a receipt validator URL here if you want server-side checks
        .verified(function (r) { return r.finish(); })
        .finished(function (t) { t.products.forEach(function (p) { var d = byId(p.id); if (d) grantFn(d, t); }); });
      store.when().productUpdated(function (p) { if (p.owned) { var d = byId(p.id); if (d && d.type === 'nonconsumable') grantFn(d, null, true); } });
      return store.initialize([C.Platform.APPLE_APPSTORE]);
    },
    buy: function (id) {
      var C = root.CdvPurchase, offer = C.store.get(id) && C.store.get(id).getOffer();
      if (!offer) return Promise.resolve({ ok: false, reason: 'unavailable' });
      return offer.order().then(function (err) { return err ? { ok: false, reason: err.message } : { ok: true, pending: true }; });
    },
    restore: function () { return root.CdvPurchase.store.restorePurchases(); },
    price: function (id) { var p = root.CdvPurchase.store.get(id); return (p && p.pricing && p.pricing.price) || byId(id).price; }
  };

  var p = stub;
  root.IAP = {
    products: PRODUCTS,
    get provider() { return p.name; },
    get available() { return p.available; },
    /** grant(product, transaction?, isRestore?) is called once per successful purchase/restore. */
    init: function (grant) {
      grantFn = grant || grantFn;
      if (root.CdvPurchase && root.CdvPurchase.store) p = cdv;
      return p.init().catch(function () { p = stub; });
    },
    buy: function (id) { return p.buy(id); },
    restore: function () { return p.restore(); },
    price: function (id) { return p.price(id); }
  };
})(this);
