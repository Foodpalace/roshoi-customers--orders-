import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CustomerShell } from "@/components/market/shell";
import { QuoteLines } from "@/components/market/quote-lines";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { advanceSimulatedOrder, cancelMyOrder, getMyOrder } from "@/lib/server/orders";
import { getMyHDmasterOrder } from "@/lib/server/hdmaster-order-read";
import { loadConfig } from "@/lib/server/load-config";
import { CUSTOMER_TRACK_STEPS } from "@/lib/orders/state";
import { formatPaise } from "@/lib/money";

export const Route = createFileRoute("/orders/$id")({ component: OrderDetailPage });

function OrderDetailPage() {
  const { id } = Route.useParams();
  const { t, lang } = useT();
  const locale = lang === "bn" ? "bn-IN" : "en-IN";
  const { user, isPending } = useCurrentUserState();
  const detail = useQuery({
    queryKey: ["order", id],
    queryFn: async () => {
      const cfg = await loadConfig();
      return cfg.marketplace.launchMode === "live" ? getMyHDmasterOrder({ data: { orderId: id } }) : getMyOrder({ data: { orderId: id } });
    },
    enabled: Boolean(user),
    refetchInterval: 4000,
  });
  const cancel = useMutation({ mutationFn: () => cancelMyOrder({ data: { orderId: id } }), onSuccess: () => void detail.refetch() });
  const advance = useMutation({ mutationFn: () => advanceSimulatedOrder({ data: { orderId: id } }), onSuccess: () => void detail.refetch() });

  if (isPending) return <CustomerShell><div className="p-6">{t("common.loading")}</div></CustomerShell>;
  if (!user) return <RedirectToSignIn />;
  const order = detail.data?.order;
  if (detail.isPending) return <CustomerShell><div className="p-6">{t("common.loading")}</div></CustomerShell>;
  if (!order) return <CustomerShell><p className="p-6">{t("common.empty")}</p></CustomerShell>;

  const idx = CUSTOMER_TRACK_STEPS.indexOf(order.status as (typeof CUSTOMER_TRACK_STEPS)[number]);
  const labels: Record<string, string> = { PLACED: t("orders.placed"), ACCEPTED: t("orders.accepted"), PREPARING: t("orders.preparing"), READY: t("orders.ready"), RIDER_ASSIGNED: t("orders.riderAssigned"), PICKED_UP: t("orders.pickedUp"), ON_THE_WAY: t("orders.onTheWay"), DELIVERED: t("orders.delivered") };

  return (
    <CustomerShell>
      <div className="px-4 py-5">
        <p className="text-sm text-muted">{t("orders.copyId", { id: order.summary.publicId })}</p>
        <h1 className="font-display text-3xl">{order.summary.restaurantName}</h1>
        <ol className="mt-6 space-y-3">{CUSTOMER_TRACK_STEPS.map((step, i) => <li key={step} className={i <= idx || order.status === step ? "text-fg" : "text-subtle"}><span className="font-medium">{labels[step]}</span></li>)}</ol>
        {order.status === "CANCELLED" ? <p className="mt-4 text-danger">{t("orders.cancelled")}</p> : null}
        {order.deliveryOtp && !["DELIVERED", "CANCELLED"].includes(order.status) ? <p className="mt-4 rounded-[var(--radius-lg)] bg-surface p-3 font-medium">{t("orders.otp", { code: order.deliveryOtp })}<span className="mt-1 block text-sm font-normal text-muted">{t("orders.otpHint")}</span></p> : null}
        {order.summary.dataLabel === "LIVE" ? <p className="mt-4 text-sm text-muted">Live status is synchronized from Order King Command.</p> : <p className="mt-4 text-sm text-muted">{t("orders.noGps")}</p>}
        <div className="mt-6 rounded-[var(--radius-xl)] bg-surface p-4">
          <h2 className="mb-3 font-medium">{t("orders.invoice")}</h2>
          <ul className="mb-3 space-y-1 text-sm">{order.items.map((it) => <li key={it.name} className="flex justify-between gap-3"><span>{it.quantity} × {it.name}</span><span className="tabular-nums">{formatPaise(it.lineTotalPaise, { locale })}</span></li>)}</ul>
          <QuoteLines lines={order.lines} locale={locale} />
        </div>
        {order.restaurantSimulated && !["DELIVERED", "CANCELLED", "REJECTED"].includes(order.status) ? <div className="mt-4 rounded-[var(--radius-lg)] border border-border p-3"><p className="text-sm text-muted">{t("orders.simulateHint")}</p><Button className="mt-2" variant="outline" disabled={advance.isPending} onClick={() => advance.mutate()}>{t("orders.simulate")}</Button></div> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {order.canCancel ? <Button variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t("orders.cancelOrder")}</Button> : null}
          <Button variant="outline" asChild><Link to="/r/$slug" params={{ slug: order.summary.restaurantSlug }}>{t("orders.reorder")}</Link></Button>
          <Button variant="ghost" asChild><Link to="/support">{t("orders.help")}</Link></Button>
        </div>
      </div>
    </CustomerShell>
  );
}
