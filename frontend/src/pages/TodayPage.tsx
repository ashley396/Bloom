import { useEffect } from "react";
import { DollarSign, ShoppingBag, Truck, Users } from "lucide-react";
import { BusinessSnapshot } from "../components/today/business-snapshot";
import { DailyInsight } from "../components/today/daily-insight";
import { DeliveryTimeline } from "../components/today/delivery-timeline";
import { DesignQueue } from "../components/today/design-queue";
import { InventoryAlertsSection } from "../components/today/inventory-alert-card";
import { LilyRecommendation } from "../components/today/lily-recommendation";
import { MetricCard } from "../components/today/metric-card";
import { QuickActions } from "../components/today/quick-actions";
import { TodayHeader } from "../components/today/today-header";
import { TodayHeroPhoto } from "../components/today/today-hero-photo";
import { UpNextCard } from "../components/today/up-next-card";
import {
  assertUniquePhotosOnPage,
  collectTodayPagePhotoUrls,
} from "../lib/floristry-photos";
import { todayPageData } from "../lib/today-sample";

export function TodayPage() {
  const d = todayPageData;

  useEffect(() => {
    assertUniquePhotosOnPage(collectTodayPagePhotoUrls(), "/today");
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-8 lg:space-y-10">
      <TodayHeader firstName={d.user.firstName} dateLabel={d.dateLabel} />

      <TodayHeroPhoto
        src={d.heroPhoto.src}
        licensedFallbackSrc={d.heroPhoto.fallbackSrc}
      />

      <section
        aria-label="Daily summary"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <MetricCard label="Orders today" value={d.metrics.ordersToday} icon={ShoppingBag} />
        <MetricCard label="Deliveries" value={d.metrics.deliveries} icon={Truck} />
        <MetricCard label="Revenue" value={d.metrics.revenue} icon={DollarSign} />
        <MetricCard label="Staff clocked in" value={d.metrics.staffClockedIn} icon={Users} />
      </section>

      <UpNextCard order={d.upNext} />

      <div className="grid gap-6 xl:grid-cols-12 xl:gap-8">
        <div className="xl:col-span-7">
          <DesignQueue orders={d.designQueue} />
        </div>
        <div className="space-y-6 xl:col-span-5">
          <LilyRecommendation
            message={d.lily.message}
            primaryAction={d.lily.primaryAction}
            dismissAction={d.lily.dismissAction}
          />
          <InventoryAlertsSection alerts={d.inventoryAlerts} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:gap-8">
        <DeliveryTimeline stops={d.deliverySchedule} />
        <QuickActions actions={d.quickActions} />
      </div>

      <BusinessSnapshot metrics={d.businessSnapshot} />

      <DailyInsight message={d.dailyInsight} />
    </div>
  );
}
