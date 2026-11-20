import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { CommunicationChannel, CommunicationEventType, CommunicationTemplate } from '@core/models/communication.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { CommunicationService } from './communication.service';
import { apiMessage } from './api-error';
import { channelLabel, eventLabel, eventNote, freeChannels, freeEvents } from './template-catalog';

/**
 * Create a template for an event + channel that has none yet (there is one template per
 * combination, so only free ones are offered). Picking the combination fills in a starter —
 * the app's own seeded text where there is one, otherwise a short message that already passes
 * Meta's rules — which you then edit. Header, buttons, formatting and the rest are on the
 * template's own page, where this one sends you the moment it is created.
 */
@Component({
  selector: 'app-template-new',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatIconModule, UiCard, UiInput, UiSelect, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div class="tn__title">
          <app-button variant="text" icon="arrow_back" (pressed)="back()">Templates</app-button>
          <h1 class="text-h1">New template</h1>
        </div>
      </header>

      @if (loading()) {
        <app-card><p class="text-caption">Loading…</p></app-card>
      } @else if (!events().length) {
        <app-card title="Nothing left to create">
          <p class="text-caption">Every event already has a template on every channel. Open one from the list to edit it.</p>
        </app-card>
      } @else {
        <app-card title="Event and channel" subtitle="Each event has one template per channel.">
          <form [formGroup]="form" class="tn__form" (ngSubmit)="create()">
            <div class="tn__row">
              <app-select [control]="c('eventType')" label="Event" [options]="eventOptions()" />
              <app-select [control]="c('channel')" label="Channel" [options]="channelOptions()" />
            </div>

            @if (note()) { <div class="note"><mat-icon>info</mat-icon><span>{{ note() }}</span></div> }

            <app-input [control]="c('templateName')"
              [label]="channelValue() === 'WHATSAPP' ? 'Meta template name' : 'Template name'"
              [placeholder]="channelValue() === 'WHATSAPP' ? 'lowercase_with_underscores' : 'e.g. Shipment Cancelled - SMS'"
              [maxLength]="150" />

            @if (channelValue() === 'EMAIL') {
              <app-input [control]="c('subject')" label="Subject" [maxLength]="255" />
            }

            <div class="field">
              <label class="text-caption" for="tn-content">Message</label>
              <textarea id="tn-content" class="tn__textarea" [formControl]="c('content')" rows="8"></textarea>
              <span class="text-caption">
                {{ starterSeeded() ? 'Starts as the app’s own default text.' : 'A starter message — change it to say what you need.' }}
                Use <code>{{ '{{customerName}}' }}</code>-style variables; formatting, header, footer and buttons come next, on the template’s page.
              </span>
            </div>

            <div class="tn__actions">
              <app-button variant="stroked" type="button" (pressed)="back()">Cancel</app-button>
              <app-button type="submit" icon="add" [loading]="saving()" [disabled]="form.invalid || !channelValue()">Create template</app-button>
            </div>
          </form>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .tn__title { display:flex; align-items:center; gap:12px; }
    .tn__title h1 { margin:0; }
    .tn__form { display:flex; flex-direction:column; gap:16px; max-width:760px; }
    .tn__row { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .field { display:flex; flex-direction:column; gap:6px; }
    .tn__textarea { width:100%; box-sizing:border-box; padding:12px 14px; border-radius:var(--r-field);
      border:1px solid var(--surface-border); background:var(--surface); font:400 17px/1.5 var(--font-sans);
      color:var(--content-fg); resize:vertical; min-height:160px; }
    .tn__textarea:focus { outline:2px solid var(--brand-300, var(--brand-500)); outline-offset:0; }
    .note { display:flex; gap:10px; align-items:flex-start; padding:10px 14px; border-radius:var(--r-field);
      background:var(--warning-bg); font:400 16px var(--font-sans); }
    .note mat-icon { color:var(--warning); font-size:18px; width:18px; height:18px; flex-shrink:0; }
    .tn__actions { display:flex; justify-content:flex-end; gap:10px; }
    code { font-family:var(--font-mono, ui-monospace); font-size:15px; background:var(--surface-muted); padding:1px 6px; border-radius:6px; }
    @media (max-width: 640px) { .tn__row { grid-template-columns:1fr; } }
  `]
})
export class TemplateNew implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly service = inject(CommunicationService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  private readonly existing = signal<CommunicationTemplate[]>([]);
  protected readonly starterSeeded = signal(false);

  protected readonly form: FormGroup = this.fb.group({
    eventType: ['' as CommunicationEventType | ''],
    channel: ['' as CommunicationChannel | ''],
    templateName: ['', [Validators.required, Validators.maxLength(150)]],
    subject: ['', Validators.maxLength(255)],
    content: ['', Validators.required]
  });

  private readonly eventValue = signal<CommunicationEventType | ''>('');
  protected readonly channelValue = signal<CommunicationChannel | ''>('');

  protected readonly events = computed(() => freeEvents(this.existing()));
  protected readonly eventOptions = computed<SelectOption[]>(() =>
    this.events().map((e) => ({ value: e, label: eventLabel(e) })));
  protected readonly channelOptions = computed<SelectOption[]>(() => {
    const e = this.eventValue();
    return e ? freeChannels(e, this.existing()).map((c) => ({ value: c, label: channelLabel(c) })) : [];
  });
  protected readonly note = computed(() => (this.eventValue() ? eventNote(this.eventValue() as CommunicationEventType) : null));

  constructor() {
    this.c('eventType').valueChanges.pipe(takeUntilDestroyed()).subscribe((e: CommunicationEventType | '') => {
      this.eventValue.set(e);
      const channels = e ? freeChannels(e, this.existing()) : [];
      // Keep the current channel if it is still free for this event, else take the first free one.
      const keep = channels.includes(this.c('channel').value) ? this.c('channel').value : (channels[0] ?? '');
      this.c('channel').setValue(keep);
    });
    this.c('channel').valueChanges.pipe(takeUntilDestroyed()).subscribe((ch: CommunicationChannel | '') => {
      this.channelValue.set(ch);
      this.loadStarter();
    });
  }

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Communication' }, { label: 'Templates', route: '/communication/templates' }, { label: 'New' }]);
    this.service.listTemplates().subscribe({
      next: (rows) => {
        this.existing.set(rows);
        this.loading.set(false);
        const first = freeEvents(rows)[0];
        if (first) this.c('eventType').setValue(first);
      },
      error: () => { this.existing.set([]); this.loading.set(false); }
    });
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  protected back(): void { void this.router.navigateByUrl('/communication/templates'); }

  protected create(): void {
    if (this.form.invalid || !this.eventValue() || !this.channelValue()) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.service.createTemplate({
      eventType: v.eventType, channel: v.channel, templateName: v.templateName.trim(),
      subject: v.channel === 'EMAIL' ? (v.subject || null) : null, content: v.content
    }).subscribe({
      next: (t) => {
        this.saving.set(false);
        this.notify.success('Template created.');
        void this.router.navigate(['/communication/templates', t.id]);
      },
      error: (e) => { this.saving.set(false); this.notify.error(apiMessage(e, 'Could not create the template.')); }
    });
  }

  private loadStarter(): void {
    const event = this.eventValue();
    const channel = this.channelValue();
    if (!event || !channel) return;
    this.service.templateStarter(event, channel).subscribe({
      next: (s) => {
        this.starterSeeded.set(s.seeded);
        this.form.patchValue({ templateName: s.templateName, subject: s.subject ?? '', content: s.content }, { emitEvent: false });
      },
      error: () => undefined
    });
  }
}
