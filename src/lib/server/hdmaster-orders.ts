import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { buildQuote } from "./quote";
import type { CartLineInput } from "@/lib/market-types";

function hdmasterConfig() {
  const baseUrl = process.env.HDMASTER_URL?.replace(/\/$/, "");
  const token = process.env.ROSHOI_SERVICE_TOKEN?.trim();
  if (!baseUrl || !token) throw new Error("HDmaster integration is not configured.");
  return { baseUrl, token };
}

export const placeOrderViaHDmaster = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    restaurantId: string; zoneId: string; lat: number; lng: number; coupon?: string | null; lines: CartLineInput[];
    address: { line1: string; area: string; landmark?: string; instructions?: string; label?: string };
    paymentMethod: "COD" | "UPI_SANDBOX"; notes?: string; idempotencyKey: string;
  }) => input)
  .handler(async ({ context, data }) => {
    if (!data.address.line1.trim()) throw new Error("Delivery address is required.");
    if (!data.lines.length) throw new Error("Cart is empty.");
    if (!data.idempotencyKey || data.idempotencyKey.length < 8) throw new Error("Idempotency key is required.");
    const built = await buildQuote({ restaurantId: data.restaurantId, zoneId: data.zoneId, lat: data.lat, lng: data.lng, coupon: data.coupon, lines: data.lines }, false);
    if (built.result.quote.blockers.length) throw new Error(`Order blocked: ${built.result.quote.blockers.join(", ")}`);
    const { baseUrl, token } = hdmasterConfig();
    const sql = await getSql();
    const zones = await sql<{ city_id: string }>`select city_id from zones where id = ${built.zoneId} limit 1`;
    if (!zones[0]?.city_id) throw new Error("Delivery zone is not configured.");
    const q = built.result.quote;
    const response = await fetch(`${baseUrl}/v1/admin/customer-orders`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "Idempotency-Key": data.idempotencyKey },
      body: JSON.stringify({ customerRef: context.userId, restaurantId: built.restaurantId, cityId: zones[0].city_id, zoneId: built.zoneId, paymentMethod: data.paymentMethod, foodPaise: q.foodSubtotalPaise, restaurantDiscountPaise: q.restaurantDiscountPaise, platformDiscountPaise: q.platformDiscountPaise, deliveryFeePaise: q.deliveryFeePaise, serviceFeePaise: q.serviceFeePaise, taxPaise: q.taxPaise, totalPaise: q.totalPaise, commissionPaise: q.commissionPaise, address: { ...data.address, lat: data.lat, lng: data.lng }, notes: data.notes, lines: built.pricedLines.map((line) => ({ itemId: line.itemId, name: line.name, qty: line.quantity, unitPaise: line.unitPaise })) }),
    });
    const payload = (await response.json().catch(() => ({}))) as { data?: { orderId: string; status: string; paymentStatus: string; totalPaise: number; dataMode: string }; error?: string };
    if (!response.ok || !payload.data) throw new Error(payload.error ?? `HDmaster order creation failed (${response.status})`);
    return { orderId: payload.data.orderId, publicId: payload.data.orderId, duplicate: false, authoritative: "HDmaster" as const, status: payload.data.status };
  });

export const cancelOrderViaHDmaster = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { orderId: string; reason?: string; idempotencyKey: string }) => input)
  .handler(async ({ context, data }) => {
    if (!data.orderId || !data.idempotencyKey || data.idempotencyKey.length < 8) throw new Error("Order ID and idempotency key are required.");
    const { baseUrl, token } = hdmasterConfig();
    const response = await fetch(`${baseUrl}/v1/admin/customer-orders/${encodeURIComponent(data.orderId)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "Idempotency-Key": data.idempotencyKey },
      body: JSON.stringify({ customerRef: context.userId, reason: data.reason }),
    });
    const payload = (await response.json().catch(() => ({}))) as { data?: { orderId: string; status: string; authoritative: "HDmaster" }; error?: string };
    if (!response.ok || !payload.data) throw new Error(payload.error ?? `HDmaster cancellation failed (${response.status})`);
    return payload.data;
  });
