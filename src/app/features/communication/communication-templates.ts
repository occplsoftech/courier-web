import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { CommunicationTemplate } from '@core/models/communication.model';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { sampleValues, whatsappChecks } from './template-preview';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { NotificationService } from '@core/services/notification.service';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { CommunicationService } from './communication.service';
import { apiMessage } from './api-error';

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** One row per (event, channel) — e.g. "SHIPMENT_BOOKED + WHATSAPP". Opening a row goes to its
 *  own page (edit, live phone preview, Meta approval); the default events are seeded
 *  server-side on first load. */
@Component({
  selector: 'app-communication-templates',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatSlideToggleModule, UiTable, UiButton, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Notification Templates</h1><p class="text-caption">One message per event and channel — {{ '{{variable}}' }} placeholders are filled in at send time.</p></div>
        <div class="page__actions"><app-button icon="add" (pressed)="create()">New template</app-button></div>
      </header>

      <app-table
        [columns]="columns" [rows]="templates()" [loading]="loading()"
        emptyTitle="No templates" emptyHint="Templates seed automatically on first load."
        (rowClick)="edit($event)">
        <ng-template #row let-t>
          <td>{{ eventLabel(t.eventType) }}</td>
          <td>{{ t.channel }}</td>
          <td>
            {{ t.templateName }}
            @if (fixes(t).length) {
              <span class="fix" [title]="fixes(t).join('\n')">Fix before submitting</span>
            }
          </td>
          <td>
            <!-- stopPropagation: flipping the switch must not also open the row. -->
            <span class="sw" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
              <mat-slide-toggle [checked]="t.status === 'ACTIVE'" [disabled]="isBusy(t.id)"
                [attr.aria-label]="'Sending for ' + eventLabel(t.eventType) + ' ' + t.channel"
                (change)="setSending(t, $event.checked)" />
              <span class="sw__text" [class.on]="t.status === 'ACTIVE'">{{ t.status === 'ACTIVE' ? 'On' : 'Off' }}</span>
            </span>
          </td>
          <td>
            @if (t.channel === 'WHATSAPP') {
              @if (t.metaStatus) { <app-status-badge [value]="t.metaStatus" [tone]="metaTone(t.metaStatus)" /> }
              @else { <span class="text-caption">Not submitted</span> }
            } @else { <span class="text-caption">—</span> }
          </td>
          <td class="text-caption">{{ t.updatedAt | date: 'medium' }}</td>
        </ng-template>
      </app-table>
    </div>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; }
    .fix { margin-left:8px; font:600 14px var(--font-sans); padding:2px 8px; border-radius:999px;
      background:var(--warning-bg); color:var(--warning); cursor:help; white-space:nowrap; }
    .sw { display:inline-flex; align-items:center; gap:8px; }
    .sw__text { font:600 15px var(--font-sans); color:var(--content-muted); min-width:22px; }
    .sw__text.on { color:var(--success); }
  `]
})
export class CommunicationTemplates implements OnInit {
  private readonly service = inject(CommunicationService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly busy = signal<Set<string>>(new Set());

  readonly loading = signal(true);
  readonly templates = signal<CommunicationTemplate[]>([]);

  readonly columns: TableColumn<CommunicationTemplate>[] = [
    { key: 'eventType', header: 'Event' },
    { key: 'channel', header: 'Channel' },
    { key: 'templateName', header: 'Template Name' },
    { key: 'status', header: 'Sending' },
    { key: 'metaStatus', header: 'Meta approval' },
    { key: 'updatedAt', header: 'Updated' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Communication' }, { label: 'Templates' }]);
    this.load();
  }

  eventLabel(e: string): string { return label(e); }

  create(): void {
    void this.router.navigateByUrl('/communication/templates/new');
  }

  /** The Meta rules a WhatsApp template not yet submitted still breaks — empty once it is clean or submitted. */
  fixes(t: CommunicationTemplate): string[] {
    if (t.channel !== 'WHATSAPP' || t.metaStatus) return [];
    return whatsappChecks({
      name: t.templateName, body: t.content, header: t.headerText ?? '', footer: t.footerText ?? '',
      buttons: t.buttons ?? [], known: Object.keys(sampleValues())
    }).filter((c) => !c.ok).map((c) => c.text);
  }

  isBusy(id: string): boolean { return this.busy().has(id); }

  /** Turns one template's sending on or off immediately; the row snaps back if it fails. */
  setSending(template: CommunicationTemplate, on: boolean): void {
    this.busy.update((b) => new Set(b).add(template.id));
    this.service.setTemplateStatus(template.id, on ? 'ACTIVE' : 'INACTIVE').subscribe({
      next: (updated) => {
        this.templates.update((rows) => rows.map((r) => (r.id === template.id
          ? { ...r, status: updated.status, version: updated.version, updatedAt: updated.updatedAt } : r)));
        this.release(template.id);
        this.notify.success(`${this.eventLabel(template.eventType)} · ${template.channel}: sending turned ${on ? 'on' : 'off'}.`);
      },
      error: (e) => {
        this.templates.update((rows) => [...rows]);
        this.release(template.id);
        this.notify.error(apiMessage(e, 'Could not change whether this template sends.'));
      }
    });
  }

  private release(id: string): void {
    this.busy.update((b) => { const n = new Set(b); n.delete(id); return n; });
  }

  metaTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
    if (status === 'APPROVED') return 'success';
    if (status === 'PENDING' || status === 'IN_APPEAL') return 'warning';
    if (status === 'REJECTED' || status === 'DISABLED' || status === 'PAUSED') return 'danger';
    return 'neutral';
  }

  edit(template: CommunicationTemplate): void {
    void this.router.navigate(['/communication/templates', template.id]);
  }

  private load(): void {
    this.loading.set(true);
    this.service.listTemplates().subscribe({
      next: (rows) => { this.templates.set(rows); this.loading.set(false); },
      error: () => { this.templates.set([]); this.loading.set(false); }
    });
  }
}
