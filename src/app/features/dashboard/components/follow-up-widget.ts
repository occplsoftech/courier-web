import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import { FollowUpService } from '@core/services/follow-up.service';
import { FollowUpDashboardStats } from '@core/models/follow-up.model';
import { UiCard } from '@shared/components/ui-card/ui-card';

interface Tile { key: keyof FollowUpDashboardStats; label: string; icon: string; tone: 'danger' | 'warning' | 'info' | 'success'; filter: Record<string, string>; }

const TILES: Tile[] = [
  { key: 'overdue', label: 'Overdue', icon: 'warning', tone: 'danger', filter: { overdue: 'true' } },
  { key: 'urgent', label: 'Urgent', icon: 'priority_high', tone: 'warning', filter: { priority: 'URGENT' } },
  { key: 'dueToday', label: 'Due Today', icon: 'today', tone: 'info', filter: { dueDate: today() } },
  { key: 'upcoming', label: 'Upcoming', icon: 'event_upcoming', tone: 'success', filter: {} }
];

function today(): string { return new Date().toISOString().substring(0, 10); }

/** Operations Dashboard's Follow-up widget — four live buckets (overdue/urgent/due
 *  today/upcoming), each clicking through to the filtered Follow-up list. Self-contained:
 *  fetches its own counts rather than riding the generic `DashboardSummary` aggregate,
 *  same posture as `TrackBox`. */
@Component({
  selector: 'app-follow-up-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard],
  template: `
    <app-card title="Follow-ups" subtitle="Operational tasks needing manual action">
      <div class="fw__grid">
        @for (t of tiles; track t.key) {
          <button type="button" class="fw__tile fw__tile--{{ t.tone }}" (click)="open(t)">
            <i class="material-icons">{{ t.icon }}</i>
            <span class="fw__count">{{ loading() ? '—' : stats()[t.key] }}</span>
            <span class="fw__label">{{ t.label }}</span>
          </button>
        }
      </div>
    </app-card>
  `,
  styles: [`
    .fw__grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:14px; }
    .fw__tile { display:flex; flex-direction:column; align-items:center; gap:4px; padding:16px 10px;
      border:0; border-radius:var(--r-field); background:var(--surface-muted); box-shadow:var(--shadow-clay-sm);
      cursor:pointer; font:600 15px var(--font-sans); }
    .fw__tile:active { box-shadow:var(--shadow-clay-inset); }
    .fw__tile i { font-size:25px; }
    .fw__count { font:700 25px var(--font-sans); color:var(--content-fg); }
    .fw__label { color:var(--content-muted); text-transform:uppercase; letter-spacing:.03em; font-size:14px; }
    .fw__tile--danger i { color:var(--danger); }
    .fw__tile--warning i { color:var(--warning); }
    .fw__tile--info i { color:var(--info); }
    .fw__tile--success i { color:var(--success); }
    @media (max-width:560px){ .fw__grid{ grid-template-columns:repeat(2,1fr); } }
  `]
})
export class FollowUpWidget implements OnInit {
  private readonly service = inject(FollowUpService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly stats = signal<FollowUpDashboardStats>({ overdue: 0, dueToday: 0, upcoming: 0, urgent: 0 });
  readonly tiles = TILES;

  ngOnInit(): void {
    this.service.dashboard().pipe(
      catchError(() => of({ overdue: 0, dueToday: 0, upcoming: 0, urgent: 0 } as FollowUpDashboardStats))
    ).subscribe((s) => { this.stats.set(s); this.loading.set(false); });
  }

  open(t: Tile): void {
    this.router.navigate(['/follow-ups'], { queryParams: t.filter });
  }
}
