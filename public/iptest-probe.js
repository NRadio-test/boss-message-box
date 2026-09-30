/* global location, parent, window, document, URLSearchParams */
// Served without transpilation; keep syntax compatible with the app's older WebViews.
(() => {
  const provider = new URLSearchParams(location.search).get("provider");
  const token = location.hash.slice(1);
  if (parent === window || !/^[a-f0-9-]{36}$/.test(token)) return;
  const send = (data) => parent.postMessage({ token, ...data }, "*");
  const callback = "routeProbeCallback";
  const script = document.createElement("script");
  window[callback] = (data, location) => {
    if (provider === "ping0") { send({ ip: data, location }); return; }
    if (provider === "alibaba") {
      const content = data && data.content;
      send({ ip: content && content.localIp, location: content && content.ipCountry });
    } else if (provider === "tencent" && data && data.ret === 0) {
      send({ ip: data.ip, location: [...new Set([data.country, data.province, data.city, data.district, data.isp].filter((value) => typeof value === "string" && value))].join(" ") });
    } else send({ error: true });
  };
  if (provider === "alibaba") {
    const random = token.replace(/-/g, "").slice(0, 16);
    script.src = `https://${Date.now()}-${random}.dns-detect.alicdn.com/api/detect/DescribeDNSLookup?cb=${callback}`;
  } else if (provider === "tencent") {
    script.src = `https://r.inews.qq.com/api/ip2city?otype=jsonp&callback=${callback}&_=${Date.now()}`;
  } else if (provider === "ping0") {
    script.src = `https://ping0.cc/geo/jsonp/${callback}`;
  } else return;
  script.onerror = () => send({ error: true });
  document.body.append(script);
})();
