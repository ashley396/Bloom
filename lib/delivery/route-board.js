/** Multi-stop delivery route ordering (pure). */

export function optimizeRouteStops(stops = []) {
  const pending = stops.filter((s) => String(s.status || "") !== "DELIVERED");
  const delivered = stops.filter((s) => String(s.status || "") === "DELIVERED");

  const sorted = [...pending].sort((a, b) => {
    const dateA = String(a.delivery_date || "");
    const dateB = String(b.delivery_date || "");
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const windowA = String(a.delivery_window || "");
    const windowB = String(b.delivery_window || "");
    if (windowA !== windowB) return windowA.localeCompare(windowB);
    const driverA = String(a.driver || "");
    const driverB = String(b.driver || "");
    if (driverA !== driverB) return driverA.localeCompare(driverB);
    return String(a.address || "").localeCompare(String(b.address || ""));
  });

  return [
    ...sorted.map((stop, index) => ({ ...stop, route_order: index + 1 })),
    ...delivered.map((stop, index) => ({
      ...stop,
      route_order: sorted.length + index + 1,
    })),
  ];
}

export function routeBoardSummary(stops = []) {
  const miles = stops.reduce((sum, s) => sum + Number(s.round_trip_miles || 0), 0);
  const drivers = [...new Set(stops.map((s) => String(s.driver || "").trim()).filter(Boolean))];
  return {
    stop_count: stops.length,
    miles: Math.round(miles * 10) / 10,
    drivers,
  };
}
