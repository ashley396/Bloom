import { useEffect } from "react";
import { DollarSign, ShoppingBag, Truck, Users } from "lucide-react";
import {
  PagePhotoRegistry,
  validateTodayPhotoAssignments,
} from "../lib/floral-asset-library";
import { BloomMoment } from "../components/today/bloom-moment";
import { BusinessSnapshot } from "../components/today/business-snapshot";
import { DailyAtelierFlow } from "../components/today/daily-atelier-flow";
import { DailyInsight } from "../components/today/daily-insight";
import { DeliveryTimeline } from "../components/today/delivery-timeline";
import { DesignQueue } from "../components/today/design-queue";
import { InventoryAlertsSection } from "../components/today/inventory-alert-card";
import { LilyRecommendation } from "../components/today/lily-recommendation";
import { MetricCard } from "../components/today/metric-card";
import { QuickActions } from "../components/today/quick-actions";
import { RoseInsight } from "../components/today/rose-insight";
import { TodayHeader } from "../components/today/today-header";
import { TodayHeroPhoto } from "../components/today/today-hero-photo";
import { UpNextCard } from "../components/today/up-next-card";
import { todayPageData } from "../lib/today-sample";

export function TodayPage() {
  const d = todayPageData;

  useEffect(() => {
    validateTodayPhotoAssignments("/today");
  }, []);

  return (
    <PagePhotoRegistry pageId="today">
      <div className="mx-auto max-w-6xl space-y-12 lg:space-y-16">
        <div className="space-y-8">
          <TodayHeader />
          <TodayHeroPhoto
            photoId={d.heroPhoto.photoId}
            pageSlot={d.heroPhoto.photoSlot}
            firstName={d.user.firstName}
            dateLabel={d.dateLabel}
          />
        </div>

        <BloomMoment className="animate-fade-in" />

        <UpNextCard order={d.upNext} className="animate-fade-in" />

        <section
          aria-label="Daily summary"
          className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6"
        >
          <MetricCard label="Orders today" value={d.metrics.ordersToday} icon={ShoppingBag} />
          <MetricCard label="Deliveries" value={d.metrics.deliveries} icon={Truck} />
          <MetricCard label="Revenue" value={d.metrics.revenue} icon={DollarSign} />
          <MetricCard label="Staff clocked in" value={d.metrics.staffClockedIn} icon={Users} />
        </section>

        <div className="grid gap-8 xl:grid-cols-12 xl:gap-10">
          <div className="space-y-8 xl:col-span-7">
            <DailyAtelierFlow items={d.atelierFlow} />
            <DesignQueue orders={d.designQueue} />
          </div>
          <div className="space-y-8 xl:col-span-5">
            <RoseInsight summary={d.rose.summary} metrics={d.rose.metrics} />
            <LilyRecommendation
              message={d.lily.message}
              primaryAction={d.lily.primaryAction}
              dismissAction={d.lily.dismissAction}
            />
            <InventoryAlertsSection alerts={d.inventoryAlerts} />
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-2 xl:gap-10">
          <DeliveryTimeline stops={d.deliverySchedule} />
          <QuickActions actions={d.quickActions} />
        </div>

        <BusinessSnapshot metrics={d.businessSnapshot} />

        <DailyInsight message={d.dailyInsight} />
      </div>
    </PagePhotoRegistry>
  );
}
