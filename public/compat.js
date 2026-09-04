/* global window */
(function installWechatWebViewCompatibility() {
  if (typeof window.globalThis !== "object") {
    Object.defineProperty(window, "globalThis", {
      configurable: true,
      writable: true,
      value: window,
    });
  }

  if (typeof Object.fromEntries !== "function") {
    Object.defineProperty(Object, "fromEntries", {
      configurable: true,
      writable: true,
      value: function fromEntries(entries) {
        var result = {};
        var items = Array.isArray(entries) ? entries : Array.from(entries);
        for (var index = 0; index < items.length; index += 1) {
          result[items[index][0]] = items[index][1];
        }
        return result;
      },
    });
  }
})();
