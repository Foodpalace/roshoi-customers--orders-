import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { OrderDetail } from "@/lib/market-types";
import { loadConfig } from "./load-config";

const statusMap: Record<string, OrderDetail["status"]> = {
  PENDING: "PLACED", CONFIRMED: "ACCEPTED", PREPARING: "PREPARING", READY: "READY", RIDER_ASSIGNED: "RIDER_ASSIGNED",
  PICKED_UP: "PICKED_UP", ON_THE_WAY: "ON_THE_WAY", ARRIVING: "ARRIVING", DELIVERED: "DELIVERED", CANCELLED: "CANCELLED",
  RESTAURANT_REJECTED: "REJECTED", PAYMENT_FAILED: "FAILED_PAYMENT", DELIVERY_FAILED: "DELIVERY_FAILED", CUSTOMER_UNAVAILABLE: "DELIVERY_FAILED",
  REFUNDED: "REFUNDED", REFUND_PENDING: "REFUND_PENDING", DISPUTED: "DISPUTED",
};

export const getMyHDmasterOrder = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { orderId: string }) => input)
  .handler(async ({ context, data }) => {
    const cfg = await loadConfig();
    if (cfg.marketplace.launchMode !== "live") return { order: null as OrderDetail | null };
    const baseUrl = process.env.HDMASTER_URL?.replace(/\/$/, "");
    const token = process.env.ROSHOI_SERVICE_TOKEN?.trim();
    if (!baseUrl || !token) throw new Error("HDmaster integration is not configured.");
    const response = await fetch(`${baseUrl}/v1/admin/customer-order?orderId=${encodeURIComponent(data.orderId)}&customerRef=${encodeURIComponent(context.userId)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { data?: any; error?: string };
    if (!response.ok) throw new Error(payload.error ?? `HDmaster order read failed (${response.status})`);
    const row = payload.data;
    if (!row) return { order: null as OrderDetail | null };
    const status = statusMap[row.status] ?? "PLACED";
    const lines = (row.items ?? []).map((item: any) => ({ code: "ITEM", name: item.name, amountPaise: Number(item.unit_paise) * Number(item.qty), source: "item" as const, fundedBy: "CUSTOMER" as const, reason: "Ordered item" }));
    lines.push({ code: "TOTAL", name: "Total", amountPaise: Number(row.total_paise), source: "service" as const, fundedBy: "CUSTOMER" as const, reason: "Order total" });
    const address = row.delivery_address_json ? JSON.stringify(row.delivery_address_json) : "";
    return {
      order: {
        summary: { id: row.id, publicId: row.id, status, restaurantName: row.restaurant_name, restaurantSlug: row.restaurant_slug, totalPaise: Number(row.total_paise), placedAt: row.placed_at, itemPreview: (row.items ?? []).map((i: any) => i.name).join(", "), dataLabel: row.data_mode === "PRODUCTION" ? "LIVE" : "SIMULATED" },
        status,
        paymentMethod: row.payment_method,
        paymentStatus: row.payment_status,
        deliveryOtp: row.delivery_otp,
        notes: null,
        address,
        lines,
        items: (row.items ?? []).map((i: any) => ({ name: i.name, quantity: Number(i.qty), lineTotalPaise: Number(i.qty) * Number(i.unit_paise), instructions: null })),
        events: (row.events ?? []).map((e: any) => ({ toStatus: statusMap[e.to_status] ?? e.to_status, createdAt: e.created_at, note: e.note })),
        restaurantSimulated: false,
        canCancel: ["PLACED", "ACCEPTED"].includes(status),
      } as OrderDetail,
    };
  });
