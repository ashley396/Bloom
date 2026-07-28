(function () {
  const ENDPOINT = "/.netlify/functions/client-errors";
  let queue = [];
  let flushing = false;

  function report(payload) {
    queue.push({ ...payload, ts: new Date().toISOString() });
    if (queue.length > 20) queue.shift();
    flush();
  }

  async function flush() {
    if (flushing || !queue.length) return;
    flushing = true;
    const batch = queue.splice(0, 5);
    try {
      const token = JSON.parse(localStorage.getItem("bloom_session") || "null")?.accessToken;
      await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(batch.length === 1 ? batch[0] : { type: "batch", items: batch })
      });
    } catch {
      queue.unshift(...batch);
    } finally {
      flushing = false;
    }
  }

  window.addEventListener("error", (event) => {
    report({ type: "uncaught", message: event.message, path: location.pathname, line: event.lineno });
  });

  window.addEventListener("unhandledrejection", (event) => {
    report({ type: "promise", message: String(event.reason?.message || event.reason), path: location.pathname });
  });

  window.BloomProductionMonitor = {
    reportApiFailure(path, status, message) {
      report({ type: "api", path, status, message: String(message || "").slice(0, 300) });
    },
    reportPermission(message) {
      report({ type: "permission", message: String(message || "").slice(0, 200), path: location.pathname });
    }
  };
})();
