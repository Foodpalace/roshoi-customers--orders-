import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { QuoteLines } from "@/components/market/quote-lines";
import { CustomerShell } from "@/components/market/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers";
import { formatPaise } from "@/lib/money";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { quoteCart, trackAnalytics } from "@/lib/server/quote";
import { placeOrder } from "@/lib/server/orders";
import { placeOrderViaHDmaster } from "@/lib/server/hdmaster-orders";
import { loadConfig } from "@/lib/server/load-config";
import { useCartStore } from "@/lib/stores/cart";
import { useLocationStore } from "@/lib/stores/location";
import { newId } from "@/lib/ids";

export const Route = createFileRoute("/checkout")({ component: CheckoutPage });

function CheckoutPage() {
  const { t, lang } = useT();
  const locale = lang === "bn" ? "bn-IN" : "en-IN";
  const { user, isPending } = useCurrentUserState();
  const { restaurantId, items, coupon, clear } = useCartStore();
  const location = useLocationStore((s) => s.location);
  const [method, setMethod] = useState<"COD" | "UPI_SANDBOX">("COD");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const quote = useQuery({
    queryKey: ["quote", restaurantId, items, coupon, location],
    enabled: Boolean(restaurantId && items.length),
    queryFn: () => quoteCart({ data: { restaurantId: restaurantId!, zoneId: location.zoneId, lat: location.lat, lng: location.lng, coupon, lines: items } }),
  });

  if (isPending) return <CustomerShell><div className="p-6 text-muted">{t("common.loading")}</div></CustomerShell>;
  if (!user) return <RedirectToSignIn />;

  const submit = async () => {
    if (!restaurantId || !quote.data) return;
    if (!location.line1.trim()) { toast.error(t("checkout.needAddress")); return; }
    setBusy(true);
    try {
      void trackAnalytics({ data: { name: "checkout_started" } });
      const idempotencyKey = newId("idem");
      const cfg = await loadConfig();
      const result = cfg.marketplace.launchMode === "live"
        ? await placeOrderViaHDmaster({ data: { restaurantId, zoneId: location.zoneId, lat: location.lat, lng: location.lng, coupon, lines: items, address: { line1: location.line1, area: location.zoneName, label: location.label }, paymentMethod: method, notes, idempotencyKey } })
        : await placeOrder({ data: { restaurantId, zoneId: location.zoneId, lat: location.lat, lng: location.lng, coupon, lines: items, address: { line1: location.line1, area: location.zoneName, label: location.label }, paymentMethod: method, notes, idempotencyKey } });
      clear();
      toast.success(t("orders.placed"));
      void navigate({ to: "/orders/$id", params: { id: result.orderId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("checkout.failed"));
    } finally { setBusy(false); }
  };

  return (
    <CustomerShell>
      <div className="px-4 py-5">
        <h1 className="font-display text-3xl">{t("checkout.title")}</h1>
        {!items.length ? <p className="mt-6 text-muted">{t("cart.empty")}</p> : <>
          <section className="mt-6"><h2 className="text-sm font-medium text-muted">{t("checkout.address")}</h2><p className="mt-1 font-medium">{location.label}</p><p className="text-sm text-muted">{location.line1}</p></section>
          <section className="mt-6"><h2 className="text-sm font-medium text-muted">{t("checkout.pay")}</h2>
            <label className="mt-2 flex min-h-14 items-start gap-3 rounded-[var(--radius-lg)] bg-surface p-3"><input type="radio" name="pay" checked={method === "COD"} onChange={() => setMethod("COD")} /><span><span className="block font-medium">{t("checkout.cod")}</span><span className="block text-sm text-muted">{t("checkout.codHint")}</span></span></label>
            <label className="mt-2 flex min-h-14 items-start gap-3 rounded-[var(--radius-lg)] bg-surface p-3"><input type="radio" name="pay" checked={method === "UPI_SANDBOX"} onChange={() => setMethod("UPI_SANDBOX")} /><span><span className="block font-medium">{t("checkout.upiSandbox")}</span><span className="block text-sm text-muted">{t("checkout.upiSandboxHint")}</span><span className="mt-1 block text-xs text-warn">{t("checkout.upiUnavailable")}</span></span></label>
          </section>
          <label className="mt-6 block text-sm">{t("checkout.notes")}<Input className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          <div className="mt-6 rounded-[var(--radius-xl)] bg-surface p-4">{quote.data ? <QuoteLines lines={quote.data.quote.lines} locale={locale} /> : <p>{t("common.loading")}</p>}</div>
          {quote.data?.quote.blockers.length ? <p className="mt-3 text-sm text-warn">{quote.data.quote.blockers.includes("MIN_ORDER") ? t("cart.minOrder", { amount: formatPaise(quote.data.quote.minOrderPaise, { locale }) }) : t("checkout.blocked")}</p> : null}
          <Button className="mt-6 w-full" disabled={busy || !quote.data || Boolean(quote.data.quote.blockers.length)} onClick={() => void submit()}>{busy ? t("checkout.placing") : t("checkout.place", { amount: formatPaise(quote.data?.quote.totalPaise ?? 0, { locale }) })}</Button>
        </>}
        <p className="mt-6 text-sm"><Link to="/cart" className="text-muted">← {t("cart.title")}</Link></p>
      </div>
    </CustomerShell>
  );
}
