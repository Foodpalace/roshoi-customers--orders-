import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { newId, publicOrderCode } from "@/lib/ids";
import { canTransition, customerMayCancel, SIMULATED_ADVANCE, type OrderStatus } from "@/lib/orders/state";
import type { CartLineInput, OrderDetail, OrderSummary } from "@/lib/market-types";
import { loadConfig } from "./load-config";
import { buildQuote } from "./quote";

const buckets = new Map<string, number[]>();
function rateLimit(key: string, n: number, windowMs: number): boolean { const now = Date.now(); const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs); if (arr.length >= n) return false; arr.push(now); buckets.set(key, arr); return true; }
async function isFirstOrder(userId: string): Promise<boolean> { const sql = await getSql(); const rows = await sql<{ c: number }>`select count(*)::int as c from orders where user_id = ${userId} and status not in ('FAILED_PAYMENT','CANCELLED')`; return (rows[0]?.c ?? 0) === 0; }
async function writeEvent(orderId: string, fromStatus: string | null, toStatus: string, actorUserId: string, actorRole: string, note?: string) { const sql = await getSql(); await sql`insert into order_events (id, order_id, from_status, to_status, actor_user_id, actor_role, note) values (${newId("oev")}, ${orderId}, ${fromStatus}, ${toStatus}, ${actorUserId}, ${actorRole}, ${note ?? null})`; }

export const placeOrder = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((input: { restaurantId: string; zoneId: string; lat: number; lng: number; coupon?: string | null; lines: CartLineInput[]; address: { line1: string; area: string; landmark?: string; instructions?: string; label?: string }; paymentMethod: "COD" | "UPI_SANDBOX"; notes?: string; idempotencyKey: string }) => input).handler(async ({ context, data }) => {
  if (!rateLimit(`order:${context.userId}`, 5, 60_000)) throw new Error("Too many order attempts. Wait a minute.");
  if (!data.address.line1.trim()) throw new Error("Delivery address is required.");
  if (data.lines.length === 0) throw new Error("Cart is empty.");
  const sql = await getSql();
  const existing = await sql<{ id: string; public_id: string }>`select id, public_id from orders where idempotency_key = ${data.idempotencyKey} and user_id = ${context.userId}`;
  if (existing[0]) return { orderId: existing[0].id, publicId: existing[0].public_id, duplicate: true };
  const first = await isFirstOrder(context.userId);
  const built = await buildQuote({ restaurantId: data.restaurantId, zoneId: data.zoneId, lat: data.lat, lng: data.lng, coupon: data.coupon, lines: data.lines }, first);
  if (built.result.quote.blockers.length) throw new Error(`Order blocked: ${built.result.quote.blockers.join(", ")}`);
  const cfg = await loadConfig();
  if (cfg.marketplace.launchMode === "live") throw new Error("LIVE customer orders must be created by HDmaster; local customer order creation is disabled.");
  const orderId = newId("ord"); const publicId = publicOrderCode(cfg.marketplace.orderPrefix); const otp = String(Math.floor(1000 + Math.random() * 9000)); const method = data.paymentMethod; const paymentStatus = method === "COD" ? "pending_collection" : "sandbox_paid"; const q = built.result.quote;
  const addressSnapshot = JSON.stringify({ ...data.address, lat: data.lat, lng: data.lng, zoneId: data.zoneId });
  await sql`insert into orders (id, public_id, user_id, restaurant_id, outlet_id, zone_id, address_snapshot, status, payment_method, payment_status, idempotency_key, food_subtotal_paise, restaurant_discount_paise, platform_discount_paise, delivery_fee_paise, service_fee_paise, tax_paise, packaging_paise, total_paise, commission_bps, commission_paise, restaurant_payable_paise, promotion_id, notes, delivery_otp, data_label) values (${orderId}, ${publicId}, ${context.userId}, ${built.restaurantId}, ${built.outletId}, ${built.zoneId}, ${addressSnapshot}, ${"PLACED"}, ${method}, ${paymentStatus}, ${data.idempotencyKey}, ${q.foodSubtotalPaise}, ${q.restaurantDiscountPaise}, ${q.platformDiscountPaise}, ${q.deliveryFeePaise}, ${q.serviceFeePaise}, ${q.taxPaise}, ${q.packagingPaise}, ${q.totalPaise}, ${q.commissionBps}, ${q.commissionPaise}, ${q.restaurantPayablePaise}, ${built.promo?.id ?? null}, ${(data.notes ?? "").slice(0, 240)}, ${otp}, ${built.dataLabel})`;
  for (const line of built.pricedLines) await sql`insert into order_items (id, order_id, item_id, variant_id, name_snapshot, quantity, unit_price_paise, addons_snapshot, instructions, line_total_paise) values (${newId("oit")}, ${orderId}, ${line.itemId}, ${line.variantId}, ${line.name}, ${line.quantity}, ${line.unitPaise}, ${JSON.stringify(line.addons)}, ${line.instructions || null}, ${line.unitPaise * line.quantity})`;
  for (let i = 0; i < q.lines.length; i++) { const line = q.lines[i]!; await sql`insert into order_price_lines (id, order_id, code, name, amount_paise, source, funded_by, reason, sort_order) values (${newId("opl")}, ${orderId}, ${line.code}, ${line.name}, ${line.amountPaise}, ${line.source}, ${line.fundedBy}, ${line.reason}, ${i})`; }
  await sql`insert into payments (id, order_id, provider, status, amount_paise, currency, idempotency_key, raw_payload) values (${newId("pay")}, ${orderId}, ${method === "COD" ? "COD" : "UPI_SANDBOX"}, ${method === "COD" ? "pending" : "sandbox_paid"}, ${q.totalPaise}, ${"INR"}, ${`${data.idempotencyKey}:pay`}, ${method === "UPI_SANDBOX" ? JSON.stringify({ sandbox: true, note: "Not a real UPI transfer" }) : null})`;
  if (built.promo) await sql`insert into promotion_redemptions (id, promotion_id, user_id, order_id) values (${newId("red")}, ${built.promo.id}, ${context.userId}, ${orderId})`;
  const points = Math.floor(q.foodSubtotalPaise / 10000);
  await sql`insert into loyalty_accounts (user_id, points, lifetime_points, tier) values (${context.userId}, ${points}, ${points}, ${"starter"}) on conflict (user_id) do update set points = loyalty_accounts.points + ${points}, lifetime_points = loyalty_accounts.lifetime_points + ${points}, updated_at = now()`;
  await sql`insert into loyalty_transactions (id, user_id, order_id, delta, reason) values (${newId("loy")}, ${context.userId}, ${orderId}, ${points}, ${"order_placed"})`;
  await writeEvent(orderId, null, "PLACED", context.userId, "customer", "Order placed");
  await sql`insert into notifications (id, user_id, title, body, kind, entity_id) values (${newId("ntf")}, ${context.userId}, ${"Order confirmed"}, ${`Order ${publicId} is confirmed. Pay ${method === "COD" ? "on delivery" : "was marked sandbox-paid"}.`}, ${"ORDER_PLACED"}, ${orderId})`;
  await sql`insert into notification_outbox (id, channel, status, payload) values (${newId("nbox")}, ${"sms"}, ${"pending"}, ${JSON.stringify({ reason: "provider_not_connected", event: "ORDER_PLACED", orderId })})`;
  await sql`insert into audit_logs (id, actor_user_id, actor_role, action, entity, entity_id, metadata) values (${newId("aud")}, ${context.userId}, ${"customer"}, ${"order.place"}, ${"order"}, ${orderId}, ${JSON.stringify({ publicId, method })})`;
  await sql`insert into analytics_events (id, user_id, name, payload) values (${newId("evt")}, ${context.userId}, ${"order_placed"}, ${JSON.stringify({ orderId })})`;
  return { orderId, publicId, duplicate: false, deliveryOtp: otp };
});

async function getOwnedOrder(userId: string, orderId: string) { const sql = await getSql(); const rows = await sql<{ id: string; public_id: string; user_id: string; restaurant_id: string; status: OrderStatus; payment_method: string; payment_status: string; total_paise: number; placed_at: string; notes: string | null; delivery_otp: string | null; address_snapshot: string; data_label: string }>`select id, public_id, user_id, restaurant_id, status, payment_method, payment_status, total_paise, placed_at::text as placed_at, notes, delivery_otp, address_snapshot, data_label from orders where id = ${orderId} and user_id = ${userId}`; return rows[0] ?? null; }

export const listMyOrders = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
  const sql = await getSql();
  const rows = await sql<{ id: string; public_id: string; status: OrderStatus; total_paise: number; placed_at: string; data_label: string; restaurant_name: string; restaurant_slug: string; preview: string | null }>`select o.id, o.public_id, o.status, o.total_paise, o.placed_at::text as placed_at, o.data_label, r.name as restaurant_name, r.slug as restaurant_slug, (select string_agg(name_snapshot, ', ') from (select name_snapshot from order_items where order_id = o.id limit 3) s) as preview from orders o join restaurants r on r.id = o.restaurant_id where o.user_id = ${context.userId} order by o.placed_at desc limit 50`;
  const orders: OrderSummary[] = rows.map((r) => ({ id: r.id, publicId: r.public_id, status: r.status, restaurantName: r.restaurant_name, restaurantSlug: r.restaurant_slug, totalPaise: r.total_paise, placedAt: r.placed_at, itemPreview: r.preview ?? "", dataLabel: r.data_label as OrderSummary["dataLabel"] }));
  return { orders };
});

export const getMyOrder = createServerFn({ method: "GET" }).middleware([authMiddleware]).validator((input: { orderId: string }) => input).handler(async ({ context, data }) => {
  const order = await getOwnedOrder(context.userId, data.orderId); if (!order) return { order: null as OrderDetail | null }; const sql = await getSql();
  const rst = await sql<{ name: string; slug: string; data_label: string }>`select name, slug, data_label from restaurants where id = ${order.restaurant_id}`;
  const items = await sql<{ name_snapshot: string; quantity: number; line_total_paise: number; instructions: string | null }>`select name_snapshot, quantity, line_total_paise, instructions from order_items where order_id = ${order.id}`;
  const lines = await sql<{ code: string; name: string; amount_paise: number; source: string; funded_by: string | null; reason: string }>`select code, name, amount_paise, source, funded_by, reason from order_price_lines where order_id = ${order.id} order by sort_order`;
  const events = await sql<{ to_status: string; created_at: string; note: string | null }>`select to_status, created_at::text as created_at, note from order_events where order_id = ${order.id} order by created_at`;
  const restaurant = rst[0];
  const detail: OrderDetail = { summary: { id: order.id, publicId: order.public_id, status: order.status, restaurantName: restaurant?.name ?? "Kitchen", restaurantSlug: restaurant?.slug ?? "", totalPaise: order.total_paise, placedAt: order.placed_at, itemPreview: items.map((i) => i.name_snapshot).join(", "), dataLabel: order.data_label as OrderSummary["dataLabel"] }, status: order.status, paymentMethod: order.payment_method, paymentStatus: order.payment_status, deliveryOtp: order.delivery_otp, notes: order.notes, address: order.address_snapshot, lines: lines.map((l) => ({ code: l.code, name: l.name, amountPaise: l.amount_paise, source: l.source as OrderDetail["lines"][number]["source"], fundedBy: (l.funded_by ?? "CUSTOMER") as OrderDetail["lines"][number]["fundedBy"], reason: l.reason })), items: items.map((i) => ({ name: i.name_snapshot, quantity: i.quantity, lineTotalPaise: i.line_total_paise, instructions: i.instructions })), events: events.map((e) => ({ toStatus: e.to_status, createdAt: e.created_at, note: e.note })), restaurantSimulated: restaurant?.data_label === "SIMULATED", canCancel: customerMayCancel(order.status) };
  return { order: detail };
});

export const cancelMyOrder = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((input: { orderId: string }) => input).handler(async ({ context, data }) => {
  const order = await getOwnedOrder(context.userId, data.orderId); if (!order) throw new Error("Order not found"); if (!customerMayCancel(order.status)) throw new Error("This order can no longer be cancelled."); if (!canTransition(order.status, "CANCELLED")) throw new Error("Illegal cancellation"); const sql = await getSql(); await sql`update orders set status = ${"CANCELLED"}, updated_at = now() where id = ${order.id} and user_id = ${context.userId}`; await writeEvent(order.id, order.status, "CANCELLED", context.userId, "customer", "Cancelled by customer"); return { ok: true };
});

export const advanceSimulatedOrder = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((input: { orderId: string }) => input).handler(async ({ context, data }) => {
  const order = await getOwnedOrder(context.userId, data.orderId); if (!order) throw new Error("Order not found"); const sql = await getSql(); const rst = await sql<{ data_label: string }>`select data_label from restaurants where id = ${order.restaurant_id}`; if (rst[0]?.data_label !== "SIMULATED") throw new Error("Only sample kitchens can be advanced in development."); const next = SIMULATED_ADVANCE[order.status]; if (!next) return { status: order.status }; if (!canTransition(order.status, next)) throw new Error("Illegal transition"); await sql`update orders set status = ${next}, updated_at = now() where id = ${order.id} and user_id = ${context.userId}`; await writeEvent(order.id, order.status, next, context.userId, "system", "Sample kitchen status advanced"); if (next === "DELIVERED") { await sql`update payments set status = ${"collected"} where order_id = ${order.id} and provider = ${"COD"}`; await sql`update orders set payment_status = ${"collected"} where id = ${order.id} and payment_method = ${"COD"}`; } return { status: next };
});
