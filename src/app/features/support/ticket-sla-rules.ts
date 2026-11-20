import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { TicketService } from '@core/services/ticket.service';
import { SlaRule, TicketPriority, TICKET_PRIORITIES } from '@core/models/ticket.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { StatusBadge } from '@shared/components/status-badge/status-badge';

interface RuleForm {
  priority: TicketPriority;
  existing: SlaRule | null;
  group: FormGroup<{
    firstResponseMinutes: FormControl<number>;
    resolutionMinutes: FormControl<number>;
  }>;
}

function minutesLabel(m: number): string {
  if (m < 60) return `${m}m`;
  if (m % 1440 === 0) return `${m / 1440}d`;
  if (m % 60 === 0) return `${m / 60}h`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** COMPANY_ADMIN's SLA targets — one row per TicketPriority, upserted by priority (the
 *  backend has no separate "create" for a fifth row; LOW/MEDIUM/HIGH/CRITICAL is the
 *  whole set). A row with no saved rule yet just has empty defaults and no Active badge. */
@Component({
  selector: 'app-ticket-sla-rules',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiButton, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">SLA Rules</h1><p class="text-caption">First-response and resolution targets, by ticket priority. New tickets compute their due dates from the active rule at creation time — changes here don't retroactively move an already-open ticket.</p></div>
      </header>

      <app-card>
        @if (loading()) {
          <p class="text-caption">Loading…</p>
        } @else {
          <table class="tbl">
            <thead>
              <tr><th>Priority</th><th>First Response</th><th>Resolution</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.priority) {
                <tr [formGroup]="r.group">
                  <td><strong>{{ r.priority }}</strong></td>
                  <td>
                    <input class="tbl__i" type="number" min="1" formControlName="firstResponseMinutes" />
                    <span class="text-caption"> min ({{ minutesLabel(r.group.value.firstResponseMinutes ?? 0) }})</span>
                  </td>
                  <td>
                    <input class="tbl__i" type="number" min="1" formControlName="resolutionMinutes" />
                    <span class="text-caption"> min ({{ minutesLabel(r.group.value.resolutionMinutes ?? 0) }})</span>
                  </td>
                  <td>
                    @if (r.existing) {
                      <app-status-badge [value]="r.existing.active ? 'ACTIVE' : 'INACTIVE'" />
                    } @else {
                      <span class="text-caption">Not set</span>
                    }
                  </td>
                  <td class="row-actions">
                    <app-button variant="stroked" [loading]="saving() === r.priority" [disabled]="r.group.invalid" (pressed)="save(r)">Save</app-button>
                    @if (r.existing) {
                      <app-button variant="text" [icon]="r.existing.active ? 'toggle_off' : 'toggle_on'" (pressed)="toggle(r)">
                        {{ r.existing.active ? 'Deactivate' : 'Activate' }}
                      </app-button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </app-card>
    </div>
  `,
  styles: [`
    .tbl { width:100%; border-collapse:collapse; }
    .tbl th { text-align:left; font:600 15px var(--font-sans); color:var(--content-muted); text-transform:uppercase;
      letter-spacing:.03em; padding:8px 10px; border-bottom:1px solid var(--surface-border); }
    .tbl td { padding:10px; border-bottom:1px solid var(--surface-border); vertical-align:middle; }
    .tbl__i { width:90px; height:36px; padding:0 10px; border:0; border-radius:var(--r-field);
      background:var(--surface-muted); box-shadow:var(--shadow-clay-inset); font:400 17px var(--font-sans); color:var(--content-fg); }
    .row-actions { display:flex; gap:6px; align-items:center; }
  `]
})
export class TicketSlaRules implements OnInit {
  private readonly service = inject(TicketService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);

  readonly loading = signal(true);
  readonly saving = signal<TicketPriority | null>(null);
  readonly rows = signal<RuleForm[]>([]);
  minutesLabel = minutesLabel;

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Support' }, { label: 'SLA Rules' }]);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.slaRules().subscribe({
      next: (existing) => {
        const byPriority = new Map(existing.map((r) => [r.priority, r]));
        this.rows.set(TICKET_PRIORITIES.map((priority) => {
          const rule = byPriority.get(priority) ?? null;
          return {
            priority, existing: rule,
            group: new FormGroup({
              firstResponseMinutes: new FormControl(rule?.firstResponseMinutes ?? 60,
                { nonNullable: true, validators: [Validators.required, Validators.min(1)] }),
              resolutionMinutes: new FormControl(rule?.resolutionMinutes ?? 1440,
                { nonNullable: true, validators: [Validators.required, Validators.min(1)] })
            })
          };
        }));
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  save(r: RuleForm): void {
    if (r.group.invalid) return;
    this.saving.set(r.priority);
    this.service.upsertSlaRule({ priority: r.priority, ...r.group.getRawValue() }).subscribe({
      next: () => { this.saving.set(null); this.notify.success(`${r.priority} SLA rule saved.`); this.load(); },
      error: (err: HttpErrorResponse) => { this.saving.set(null); this.notify.error(err.error?.message ?? 'Could not save the rule.'); }
    });
  }

  toggle(r: RuleForm): void {
    if (!r.existing) return;
    this.service.setSlaRuleActive(r.existing.id, !r.existing.active).subscribe({
      next: () => { this.notify.success(r.existing!.active ? 'Rule deactivated.' : 'Rule activated.'); this.load(); },
      error: (err: HttpErrorResponse) => this.notify.error(err.error?.message ?? 'Could not update the rule.')
    });
  }
}
