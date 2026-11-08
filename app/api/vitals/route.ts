/** Receives Web Vitals from browsers (metric names and numbers only) for performance budgets. */
export async function POST(request: Request) {
  try {
    const m = (await request.json()) as { name?: string; value?: number; rating?: string; route?: string };
    if (typeof m.name === "string" && typeof m.value === "number") {
      console.info(JSON.stringify({ level: "info", type: "web-vital", name: m.name.slice(0, 20), value: Math.round(m.value * 100) / 100, rating: String(m.rating ?? "").slice(0, 20), route: String(m.route ?? "").replace(/\/p\/[^/]+/, "/p/:id").slice(0, 100) }));
    }
  } catch {}
  return new Response(null, { status: 204 });
}
