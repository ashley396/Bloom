import { DollarSign, ShoppingBag, Truck, Users } from "lucide-react";
import { FadeIn } from "../components/motion/FadeIn";
import { BusinessSnapshot } from "../components/today/business-snapshot";
import { DeliveryTimeline } from "../components/today/delivery-timeline";
import { DesignQueue } from "../components/today/design-queue";
import { InventoryAlerts } from "../components/today/inventory-alerts";
import { KpiStatCard } from "../components/today/kpi-stat-card";
import { LilyInsightCard } from "../components/today/lily-insight-card";
import { QuickActions } from "../components/today/quick-actions";
import { RecentActivity } from "../components/today/recent-activity";
import { TodayHero } from "../components/today/today-hero";
import {
  deliveryTimeline,
  designQueue,
  inventoryAlerts,
  quickActions,
  recentActivity,
  todayBriefing,
} from "../lib/today-data";

export function TodayPage() {
  const { firstName, dateLabel, briefingLine, kpis, lily } = todayBriefing;

  return (
    <div className="space-y-8 lg:space-y-10 xl:space-y-12">
      <FadeIn>
        <TodayHero
          firstName={firstName}
          dateLabel={dateLabel}
          briefingLine={briefingLine}
        />
      </FadeIn>

      <section
        aria-label="Morning key figures"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5"
      >
        <KpiStatCard
          label="Orders"
          value={kpis.orders.value}
          detail={kpis.orders.detail}
          trend={{ direction: "up", label: kpis.orders.trend }}
          icon={ShoppingBag}
        />
        <KpiStatCard
          label="Revenue"
          value={kpis.revenue.value}
          detail={kpis.revenue.detail}
          trend={{ direction: "neutral", label: kpis.revenue.trend }}
          icon={DollarSign}
        />
        <KpiStatCard
          label="Deliveries"
          value={kpis.deliveries.value}
          detail={kpis.deliveries.detail}
          trend={{ direction: "up", label: kpis.deliveries.trend }}
          icon={Truck}
        />
        <KpiStatCard
          label="Staff"
          value={kpis.staff.value}
          detail={kpis.staff.detail}
          trend={{ direction: "neutral", label: kpis.staff.trend }}
          icon={Users}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-12 xl:gap-8">
        <FadeIn className="xl:col-span-7">
          <DesignQueue items={designQueue} />
        </FadeIn>
        <FadeIn className="xl:col-span-5">
          <LilyInsightCard headline={lily.headline} body={lily.body} cta={lily.cta} />
        </FadeIn>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:gap-8">
        <FadeIn>
          <DeliveryTimeline stops={deliveryTimeline} />
        </FadeIn>
        <FadeIn>
          <QuickActions actions={quickActions} />
        </FadeIn>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:gap-8">
        <FadeIn>
          <InventoryAlerts alerts={inventoryAlerts} />
        </FadeIn>
        <FadeIn>
          <BusinessSnapshot />
        </FadeIn>
      </div>

      <FadeIn>
        <RecentActivity items={recentActivity} />
      </FadeIn>
    </div>
  );
}
