import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { BranchOverview as BranchOverviewData } from '../models/dashboard.model';

interface ActionItem {
  key: string;
  label: string;
  count: number;
  icon: string;
  tone: 'brand' | 'warning' | 'danger' | 'info';
  actionLabel: string;
  route: string;
}

/** Tone shading for the pipeline stepper, earliest to latest stage. */
const STAGE_TONES: Record<string, 'brand' | 'info' | 'warning' | 'success'> = {
  BOOKED: 'brand', READY_FOR_MANIFEST: 'info', MANIFEST_CREATED: 'info',
  DISPATCHED: 'warning', IN_SCAN: 'warning', OUT_FOR_DELIVERY: 'warning', DELIVERED: 'success'
};

/**
 * Branch-scoped sibling of `CompanyOverview`: the shipment pipeline and action-required
 * backlog for the caller's own branch specifically (BRANCH_MANAGER/BRANCH_OPERATOR),
 * each item routing straight to the real page that clears it — same actionable shape as
 * the company-wide version, just scoped down. Every figure comes from
 * `DashboardSummaryResponse.branchOverview` — no client-side computation.
 */
@Component({
  selector: 'app-branch-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, UiCard, UiLoader],
  template: `
    @if (loading()) {
      <app-card title="Branch Overview">
        <app-loader [minHeight]="160" />
      </app-card>
    } @else if (!data()) {
      <app-card title="Branch Overview">
        <div class="bo-empty">
          <mat-icon>bar_chart</mat-icon>
          <p class="text-caption">No branch data yet</p>
        </div>
      </app-card>
    } @else {
      <app-card tone="brand" title="Shipment Pipeline" subtitle="This month, stage by stage — this branch">
        <div class="bo-pipeline">
          @for (stage of data()!.pipeline; track stage.stage; let last = $last) {
            <a class="bo-pipeline__stage" [routerLink]="['/shipments']">
              <span class="bo-pipeline__badge" [attr.data-tone]="stageTone(stage.stage)">{{ stage.count }}</span>
              <span class="bo-pipeline__label">{{ stageLabel(stage.stage) }}</span>
            </a>
            @if (!last) { <span class="bo-pipeline__connector" [attr.data-tone]="stageTone(stage.stage)"></span> }
          }
        </div>
      </app-card>

      <app-card tone="warning" title="Action Required" subtitle="Clear this branch's operational backlog">
        @if (actionItems().length === 0) {
          <div class="bo-empty">
            <mat-icon>task_alt</mat-icon>
            <p class="text-caption">Nothing pending — all clear</p>
          </div>
        } @else {
          <ul class="bo-actions">
            @for (a of actionItems(); track a.key) {
              <li class="bo-actions__item bo-actions__item--{{ a.tone }}">
                <span class="bo-actions__icon" [attr.data-tone]="a.tone"><mat-icon>{{ a.icon }}</mat-icon></span>
                <div class="bo-actions__body">
                  <p class="bo-actions__count">{{ a.count }}</p>
                  <p class="text-caption">{{ a.label }}</p>
                </div>
                <a class="bo-actions__btn" [attr.data-tone]="a.tone" [routerLink]="[a.route]">
                  {{ a.actionLabel }} <mat-icon>arrow_forward</mat-icon>
                </a>
              </li>
            }
          </ul>
        }
      </app-card>

      @if (agingBuckets().length) {
        <app-card tone="danger" title="Delivery Pending Aging" subtitle="Time since received at this branch, not since booking">
          <div class="bo-aging">
            @for (b of agingBuckets(); track b.label) {
              <a class="bo-aging__tile" [attr.data-hot]="b.count > 0" [routerLink]="['/movement/pending-delivery']">
                <span class="bo-aging__count">{{ b.count }}</span>
                <span class="bo-aging__label">{{ b.label }}</span>
              </a>
            }
          </div>
        </app-card>
      }

      @if (data()!.rejectedPods.length) {
        <app-card tone="danger" title="Rejected POD" subtitle="Needs a re-upload">
          <ul class="bo-rejected">
            @for (r of data()!.rejectedPods; track r.shipmentId) {
              <li class="bo-rejected__item">
                <div class="bo-rejected__body">
                  <p class="bo-rejected__number">{{ r.shipmentNumber ?? '—' }}</p>
                  <p class="text-caption">{{ r.receiverName ?? '—' }} @if (r.reason) { · {{ r.reason }} }</p>
                </div>
                <a class="bo-actions__btn" data-tone="danger"
                  [routerLink]="['/movement/delivery']" [queryParams]="{ trackingNumber: r.shipmentNumber }">
                  Upload <mat-icon>arrow_forward</mat-icon>
                </a>
              </li>
            }
          </ul>
        </app-card>
      }
    }
  `,
  styles: [`
    /* Host renders as plain content so the two cards become real siblings in the
       parent's own flex/grid layout, stacked full-width rather than fighting a shared
       grid row height — see CompanyOverview's own note on this same pitfall. */
    :host { display:contents; }

    .bo-empty { display:flex; flex-direction:column; align-items:center; gap:6px; padding:20px 0; color:var(--content-muted); }
    .bo-empty mat-icon { font-size:34px; width:34px; height:34px; opacity:.45; }

    .bo-pipeline { display:flex; align-items:center; gap:0; flex-wrap:wrap; row-gap:20px; }
    .bo-pipeline__stage { display:flex; flex-direction:column; align-items:center; gap:8px;
      padding:10px 2px; border-radius:16px; text-decoration:none; color:inherit;
      transition:transform .15s ease; }
    .bo-pipeline__stage:hover { transform:translateY(-2px); }
    .bo-pipeline__badge { display:grid; place-items:center; width:40px; height:40px; border-radius:50%;
      font:700 18px var(--font-sans); color:#fff; box-shadow:var(--shadow-clay-sm); flex-shrink:0; }
    .bo-pipeline__badge[data-tone="brand"]   { background:linear-gradient(155deg, var(--brand-400),   var(--brand-600)); }
    .bo-pipeline__badge[data-tone="info"]    { background:linear-gradient(155deg, #60a5fa, var(--info)); }
    .bo-pipeline__badge[data-tone="warning"] { background:linear-gradient(155deg, #fbbf24, var(--warning)); }
    .bo-pipeline__badge[data-tone="success"] { background:linear-gradient(155deg, #4ade80, var(--success)); }
    .bo-pipeline__label { font:600 13.5px var(--font-sans); color:var(--content-muted); text-align:center;
      max-width:64px; }
    .bo-pipeline__connector { flex:1; min-width:16px; max-width:56px; height:3px; border-radius:2px; margin:0 -2px 26px;
      background:var(--surface-border); }
    .bo-pipeline__connector[data-tone="brand"]   { background:linear-gradient(90deg, var(--brand-400),   var(--brand-300)); }
    .bo-pipeline__connector[data-tone="info"]    { background:linear-gradient(90deg, var(--info), #93c5fd); }
    .bo-pipeline__connector[data-tone="warning"] { background:linear-gradient(90deg, var(--warning), #fde68a); }
    .bo-pipeline__connector[data-tone="success"] { background:linear-gradient(90deg, var(--success), #86efac); }

    .bo-actions { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:10px; }
    .bo-actions__item { display:flex; align-items:center; gap:14px; padding:12px; border-radius:18px;
      background:var(--surface-muted); transition:transform .15s ease, box-shadow .15s ease; }
    .bo-actions__item:hover { transform:translateY(-1px); box-shadow:var(--shadow-clay-sm); }
    .bo-actions__item--warning { background:var(--warning-bg); }
    .bo-actions__item--danger { background:var(--danger-bg); }
    .bo-actions__item--brand { background:var(--brand-50); }
    .bo-actions__item--info { background:var(--info-bg); }
    .bo-actions__icon { display:grid; place-items:center; width:40px; height:40px; border-radius:14px;
      flex-shrink:0; box-shadow:var(--shadow-clay-sm); }
    .bo-actions__icon mat-icon { font-size:20px; color:#fff; }
    .bo-actions__icon[data-tone="warning"] { background:linear-gradient(155deg, #fbbf24, var(--warning)); }
    .bo-actions__icon[data-tone="danger"]  { background:linear-gradient(155deg, #f87171, var(--danger)); }
    .bo-actions__icon[data-tone="brand"]   { background:linear-gradient(155deg, var(--brand-400), var(--brand-600)); }
    .bo-actions__icon[data-tone="info"]    { background:linear-gradient(155deg, #60a5fa, var(--info)); }
    .bo-actions__body { flex:1; min-width:0; }
    .bo-actions__count { font:700 21px var(--font-sans); margin:0; }
    .bo-actions__btn { flex-shrink:0; display:inline-flex; align-items:center; gap:2px; padding:6px 8px 6px 14px;
      border-radius:var(--r-pill); font:600 15px var(--font-sans); text-decoration:none; color:#fff; }
    .bo-actions__btn mat-icon { font-size:16px; width:16px; height:16px; }
    .bo-actions__btn[data-tone="warning"] { background:linear-gradient(155deg, #fbbf24, var(--warning)); }
    .bo-actions__btn[data-tone="danger"]  { background:linear-gradient(155deg, #f87171, var(--danger)); }
    .bo-actions__btn[data-tone="brand"]   { background:linear-gradient(155deg, var(--brand-400), var(--brand-600)); }
    .bo-actions__btn[data-tone="info"]    { background:linear-gradient(155deg, #60a5fa, var(--info)); }

    .bo-aging { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; }
    .bo-aging__tile { display:flex; flex-direction:column; align-items:center; gap:4px; padding:14px 8px;
      border-radius:16px; background:var(--surface-muted); text-decoration:none; color:inherit;
      transition:transform .15s ease, box-shadow .15s ease; }
    .bo-aging__tile:hover { transform:translateY(-1px); box-shadow:var(--shadow-clay-sm); }
    .bo-aging__tile[data-hot="true"] { background:var(--danger-bg); }
    .bo-aging__count { font:700 25px var(--font-sans); }
    .bo-aging__tile[data-hot="true"] .bo-aging__count { color:var(--danger); }
    .bo-aging__label { font:600 14px var(--font-sans); color:var(--content-muted); text-align:center; }

    .bo-rejected { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:10px; }
    .bo-rejected__item { display:flex; align-items:center; justify-content:space-between; gap:14px;
      padding:12px; border-radius:18px; background:var(--danger-bg); }
    .bo-rejected__body { min-width:0; }
    .bo-rejected__number { font:700 17px var(--font-sans); margin:0; }
  `]
})
export class BranchOverview {
  readonly loading = input(false);
  readonly data = input<BranchOverviewData | null>(null);

  readonly actionItems = computed<ActionItem[]>(() => {
    const d = this.data();
    if (!d) return [];
    const items: ActionItem[] = [];
    if (d.readyForManifest > 0) {
      items.push({ key: 'manifest', label: 'Ready for manifest', count: d.readyForManifest,
        icon: 'inventory', tone: 'brand', actionLabel: 'Create Manifest', route: '/movement/loading-sheet' });
    }
    if (d.manifestsAwaitingDispatch > 0) {
      items.push({ key: 'dispatch', label: 'Manifests awaiting dispatch', count: d.manifestsAwaitingDispatch,
        icon: 'local_shipping', tone: 'info', actionLabel: 'Dispatch', route: '/movement/trip-hire-challan' });
    }
    if (d.inScanPending > 0) {
      items.push({ key: 'inScan', label: 'In scan pending', count: d.inScanPending,
        icon: 'move_to_inbox', tone: 'warning', actionLabel: 'In Scan', route: '/movement/in-scan' });
    }
    if (d.pendingDelivery > 0) {
      items.push({ key: 'delivery', label: 'Pending delivery', count: d.pendingDelivery,
        icon: 'call_received', tone: 'warning', actionLabel: 'View', route: '/movement/pending-delivery' });
    }
    if (d.delayedShipments > 0) {
      items.push({ key: 'delayed', label: 'Delayed shipments', count: d.delayedShipments,
        icon: 'schedule', tone: 'danger', actionLabel: 'View', route: '/shipments' });
    }
    if (d.toPayAwaitingDelivery > 0) {
      items.push({ key: 'toPay', label: 'TO_PAY awaiting delivery', count: d.toPayAwaitingDelivery,
        icon: 'payments', tone: 'info', actionLabel: 'View', route: '/movement/pending-delivery' });
    }
    return items;
  });

  /** Always 4 buckets from the backend (even all-zero) — empty only when there's no
   *  branch data at all, which the template's outer `@if (!data())` branch already covers. */
  readonly agingBuckets = computed(() => this.data()?.deliveryPendingAging ?? []);

  stageLabel(stage: string): string {
    return stage.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
  }

  stageTone(stage: string): string {
    return STAGE_TONES[stage] ?? 'brand';
  }
}
