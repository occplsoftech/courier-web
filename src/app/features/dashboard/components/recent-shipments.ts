import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { RecentShipment } from '../models/dashboard.model';

/** Latest bookings table. Empty until the shipment module's endpoint ships. */
@Component({
  selector: 'app-recent-shipments',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, MatIconModule, RouterLink, UiCard, UiLoader, StatusBadge],
  template: `
    <app-card title="Recent Shipments" subtitle="Latest bookings">
      <a card-actions routerLink="/branches" class="rs__link">View all</a>
      @if (loading()) {
        <app-loader [minHeight]="220" />
      } @else if (rows().length === 0) {
        <div class="rs-empty">
          <mat-icon>inventory_2</mat-icon>
          <p class="text-h3">No shipments yet</p>
          <p class="text-caption">Booked consignments will be listed here.</p>
        </div>
      } @else {
        <div class="rs__scroll">
          <table class="rs">
            <thead>
              <tr><th>#</th><th>AWB</th><th>Consignee</th><th>Destination</th><th>Status</th><th class="r">Amount</th><th class="r">Booked</th></tr>
            </thead>
            <tbody>
              @for (s of rows(); track s.id; let i = $index) {
                <tr>
                  <td>{{ i + 1 }}</td>
                  <td class="rs__awb">{{ s.awb }}</td>
                  <td>{{ s.consignee }}</td>
                  <td>{{ s.destination }}</td>
                  <td><app-status-badge [value]="s.status" /></td>
                  <td class="r">{{ s.amount != null ? ('₹' + (s.amount | number:'1.0-2')) : '—' }}</td>
                  <td class="r text-caption">{{ s.bookedAt | date:'short' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </app-card>
  `,
  styles: [`
    .rs__link { font:600 16px var(--font-sans); color:var(--brand-600); text-decoration:none; }
    .rs-empty { display:flex; flex-direction:column; align-items:center; gap:6px; padding:28px 0; color:var(--content-muted); text-align:center; }
    .rs-empty mat-icon { font-size:40px; width:40px; height:40px; opacity:.45; }
    .rs__scroll { overflow-x:auto; border-radius:18px; background:var(--surface-muted); padding:4px; }
    .rs { width:100%; border-collapse:separate; border-spacing:0 4px; font:500 16px var(--font-sans); }
    .rs th { text-align:left; padding:8px 12px; color:var(--content-muted); font-weight:600; white-space:nowrap; }
    .rs td { padding:10px 12px; background:var(--surface); white-space:nowrap; }
    .rs tr td:first-child { border-radius:14px 0 0 14px; }
    .rs tr td:last-child { border-radius:0 14px 14px 0; }
    .rs__awb { font-weight:700; }
    .r { text-align:right; }
  `]
})
export class RecentShipments {
  readonly loading = input(false);
  readonly rows = input<RecentShipment[]>([]);
}
