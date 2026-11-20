import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { ActivityLogService } from '@core/services/activity-log.service';
import { UserService } from '@features/users/user.service';
import { loginEventLabel, UserActivitySummary } from '@core/models/activity-log.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';

/**
 * User Activity screen (requirement 7): pick a user, see their login history, logout
 * history, recent activities, modules accessed, last activity and any currently active
 * session — all from one backend call, `GET /users/{id}/activity`.
 */
@Component({
  selector: 'app-user-activity',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DatePipe, UiCard, UiAutocomplete, StatusBadge, UiLoader],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">User Activity</h1>
          <p class="text-caption">One user's sign-in history, recent actions and active sessions.</p></div>
      </header>

      <app-card>
        <app-autocomplete [control]="userControl" label="User" [options]="userOptions()" placeholder="Select a user…" />
      </app-card>

      @if (loading()) {
        <app-loader />
      } @else if (summary(); as s) {
        <div class="grid">
          <app-card title="Overview">
            <div class="kv"><span>Last Activity</span><strong>{{ s.lastActivityAt ? (s.lastActivityAt | date: 'medium') : 'No activity yet' }}</strong></div>
            <div class="kv"><span>Modules Accessed</span><strong>{{ s.modulesAccessed.length ? s.modulesAccessed.join(', ') : '—' }}</strong></div>
            <div class="kv"><span>Active Sessions</span><strong>{{ s.activeSessions.length }}</strong></div>
          </app-card>

          <app-card title="Active Sessions">
            @if (!s.activeSessions.length) {
              <p class="text-caption">No active session.</p>
            }
            @for (session of s.activeSessions; track session.id) {
              <div class="session-row">
                <div>
                  <strong>{{ session.deviceType || 'Unknown device' }}</strong>
                  <span class="text-caption"> · {{ session.browser || '—' }} · {{ session.os || '—' }} · {{ session.ipAddress }}</span>
                </div>
                <span class="text-caption">Last seen {{ session.lastSeenAt | date: 'short' }}</span>
              </div>
            }
          </app-card>

          <app-card title="Login / Logout History">
            <table class="mini-table">
              <thead><tr><th>Event</th><th>Date/Time</th><th>IP</th><th>Device</th><th>Status</th></tr></thead>
              <tbody>
                @for (h of s.loginHistory; track h.id) {
                  <tr>
                    <td>{{ eventLabel(h.eventType) }}</td>
                    <td class="text-caption">{{ h.occurredAt | date: 'medium' }}</td>
                    <td class="text-caption">{{ h.ipAddress || '—' }}</td>
                    <td class="text-caption">{{ h.device || '—' }} · {{ h.browser || '—' }} · {{ h.os || '—' }}</td>
                    <td>
                      <app-status-badge [value]="h.success ? 'OK' : (h.failureReason || 'FAILED')"
                        [tone]="h.success ? 'success' : 'danger'" />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </app-card>

          <app-card title="Recent Activities">
            <table class="mini-table">
              <thead><tr><th>Date/Time</th><th>Module</th><th>Action</th><th>Description</th><th>Status</th></tr></thead>
              <tbody>
                @for (a of s.recentActivities; track a.id) {
                  <tr>
                    <td class="text-caption">{{ a.occurredAt | date: 'medium' }}</td>
                    <td>{{ a.module || '—' }}</td>
                    <td>{{ a.action }}</td>
                    <td class="text-caption">{{ a.description || '—' }}</td>
                    <td><app-status-badge [value]="a.status" [tone]="a.status === 'SUCCESS' ? 'success' : 'danger'" /></td>
                  </tr>
                }
              </tbody>
            </table>
          </app-card>
        </div>
      } @else if (userControl.value) {
        <p class="text-caption">No activity found for this user.</p>
      }
    </div>
  `,
  styles: [`
    .grid { display:flex; flex-direction:column; gap:16px; margin-top:16px; }
    .kv { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--surface-border); }
    .kv span { color:var(--content-muted); }
    .session-row { display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--surface-border); }
    .mini-table { width:100%; border-collapse:collapse; }
    .mini-table th { text-align:left; font:600 15px var(--font-sans); color:var(--content-muted); padding:8px 6px; border-bottom:1px solid var(--surface-border); }
    .mini-table td { padding:8px 6px; border-bottom:1px solid var(--surface-border); font-size:16px; }
  `]
})
export class UserActivity implements OnInit {
  private readonly service = inject(ActivityLogService);
  private readonly users = inject(UserService);
  private readonly breadcrumb = inject(BreadcrumbService);

  readonly loading = signal(false);
  readonly summary = signal<UserActivitySummary | null>(null);
  readonly userOptions = signal<SelectOption[]>([]);
  readonly userControl = new FormControl<string | null>(null);

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Settings' }, { label: 'User Activity' }]);

    this.users.list({ page: 0, size: 200, sort: 'displayName,asc' }).subscribe((p) => {
      this.userOptions.set(p.content.map((u) => ({ value: u.id, label: u.displayName })));
    });

    this.userControl.valueChanges.subscribe((userId) => {
      if (!userId) { this.summary.set(null); return; }
      this.loading.set(true);
      this.service.userActivity(userId).subscribe({
        next: (s) => { this.summary.set(s); this.loading.set(false); },
        error: () => { this.summary.set(null); this.loading.set(false); }
      });
    });
  }

  eventLabel(type: Parameters<typeof loginEventLabel>[0]): string { return loginEventLabel(type); }
}
