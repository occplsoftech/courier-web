import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { AuthService } from '@core/auth/auth.service';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { CommunicationTemplate, TemplateButton } from '@core/models/communication.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { CommunicationService } from './communication.service';
import { apiMessage } from './api-error';
import { PhonePreview } from './components/phone-preview';
import {
  CATEGORIES, EMOJI_GROUPS, LANGUAGES, WrapKind, fillVariables, insertAt, parsePlain, parseWhatsApp, sampleValues,
  usedVariables, variablesFor, whatsappChecks, wrapSelection
} from './template-preview';

function words(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const MAX_LINKS = 2;
const MAX_CALLS = 1;

/**
 * One template as a page. Left: everything that makes up the message — name, category and
 * language, header, the formatted body (bold / italic / strike / mono and emoji), footer, call-to-
 * action buttons and the sample value for each {{variable}}. Right: the message exactly as the
 * recipient's phone would show it, rebuilt on every keystroke. Nothing reaches the backend until
 * Save / Submit to Meta — except the Sending switch, which is deliberately immediate.
 */
@Component({
  selector: 'app-template-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ReactiveFormsModule, MatIconModule, MatSlideToggleModule, UiCard, UiInput, UiSelect, UiButton,
    StatusBadge, PhonePreview],
  template: `
    <div class="page">
      <header class="page__head">
        <div class="td__title">
          <app-button variant="text" icon="arrow_back" (pressed)="back()">Templates</app-button>
          @if (template(); as t) {
            <h1 class="text-h1">{{ title() }}</h1>
            <span class="td__chan">{{ t.channel }}</span>
            @if (dirty()) { <span class="td__dirty">Unsaved changes</span> }
          }
        </div>
        @if (template(); as t) {
          <div class="page__actions">
            <label class="send" [class.send--on]="t.status === 'ACTIVE'"
              [title]="t.status === 'ACTIVE' ? 'Messages are being sent' : 'Nothing is sent from this template'">
              <mat-slide-toggle [checked]="t.status === 'ACTIVE'" [disabled]="switching()"
                (change)="toggleSending($event.checked)" />
              <span class="send__text">
                <strong>Sending {{ t.status === 'ACTIVE' ? 'ON' : 'OFF' }}</strong>
                <em>{{ t.status === 'ACTIVE' ? 'Turn off to stop these messages' : 'Turn on to start sending' }}</em>
              </span>
            </label>
            <app-button variant="text" icon="restart_alt" [loading]="resetting()" (pressed)="resetToDefault()">Reset to default</app-button>
            <app-button variant="stroked" [disabled]="!dirty() || saving()" (pressed)="discard()">Discard</app-button>
            <app-button icon="save" [loading]="saving()" [disabled]="!dirty()" (pressed)="save()">Save</app-button>
          </div>
        }
      </header>

      @if (loadError()) {
        <app-card><p class="text-caption">{{ loadError() }}</p></app-card>
      } @else if (!template()) {
        <app-card><p class="text-caption">Loading template…</p></app-card>
      } @else {
        @if (resetsApproval()) {
          <div class="warn"><mat-icon>info</mat-icon>
            <span>Saving these changes resets the Meta approval ({{ template()!.metaStatus }}). The template will need to be submitted to Meta again before it can send.</span>
          </div>
        }
        <div class="td">
          <div class="td__main">
            @if (isWhatsApp()) {
              <app-card title="Template" subtitle="How this template is identified and filed with Meta.">
                <div class="td__form">
                  <app-input [control]="c('templateName')" label="Meta template name"
                    placeholder="lowercase_with_underscores, e.g. shipment_booked" [maxLength]="150" />
                  <div class="td__row">
                    <app-select [control]="c('category')" label="Category" [options]="categories" />
                    <app-select [control]="c('language')" label="Language" [options]="languages" />
                  </div>
                  <p class="text-caption td__hint">The language must match the one the template is approved in — messages are sent in it. Utility is the right category for shipment updates; Meta may re-categorise a template it considers marketing.</p>
                </div>
              </app-card>
            }

            <app-card title="Message" [subtitle]="subtitle()">
              <form [formGroup]="form" class="td__form" (ngSubmit)="save()">
                @if (template()!.channel === 'EMAIL') {
                  <app-input [control]="c('subject')" label="Subject" placeholder="Your shipment has been booked" [maxLength]="255" />
                }
                @if (isWhatsApp()) {
                  <div class="field">
                    <div class="td__label-row">
                      <label class="text-caption" for="tpl-header">Header <em>(optional)</em></label>
                      <span class="text-caption">{{ headerLength() }} / 60</span>
                    </div>
                    <input id="tpl-header" class="td__input" [formControl]="c('headerText')" maxlength="60"
                      placeholder="e.g. Shipment {{ '{{shipmentNumber}}' }}" />
                  </div>
                }

                <div class="field">
                  <div class="td__label-row">
                    <label class="text-caption" for="tpl-content">Message</label>
                    @if (isWhatsApp()) {
                      <span class="text-caption" [class.over]="bodyLength() > 1024">{{ bodyLength() }} / 1024</span>
                    }
                  </div>
                  @if (isWhatsApp() || template()!.channel === 'SMS') {
                    <div class="tb" role="toolbar" aria-label="Formatting">
                      @if (isWhatsApp()) {
                        <button type="button" class="tb__btn" title="Bold (Ctrl/⌘ B)" (click)="wrap('bold')"><b>B</b></button>
                        <button type="button" class="tb__btn" title="Italic (Ctrl/⌘ I)" (click)="wrap('italic')"><i>I</i></button>
                        <button type="button" class="tb__btn" title="Strikethrough" (click)="wrap('strike')"><s>S</s></button>
                        <button type="button" class="tb__btn tb__btn--mono" title="Monospace" (click)="wrap('mono')">&lt;/&gt;</button>
                        <span class="tb__sep"></span>
                      }
                      <button type="button" class="tb__btn" title="Insert emoji" (click)="emojiOpen.set(!emojiOpen())">
                        <mat-icon>sentiment_satisfied_alt</mat-icon>
                      </button>
                      @if (emojiOpen()) {
                        <div class="emoji-backdrop" (click)="emojiOpen.set(false)"></div>
                        <div class="emoji" role="dialog" aria-label="Emoji">
                          @for (g of emojiGroups; track g.name) {
                            <div class="emoji__name">{{ g.name }}</div>
                            <div class="emoji__grid">
                              @for (e of g.items; track e) {
                                <button type="button" class="emoji__item" (click)="addEmoji(e)">{{ e }}</button>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                  <textarea #contentBox id="tpl-content" class="td__textarea" [formControl]="c('content')" rows="11"
                    (keydown)="onKey($event)"></textarea>
                </div>

                <div class="td__vars">
                  <span class="text-caption">Insert variable:</span>
                  @for (v of variables(); track v) {
                    <button type="button" class="chip" (click)="insertVariable(v)">{{ '{{' + v + '}}' }}</button>
                  }
                </div>

                @if (isWhatsApp()) {
                  <div class="field">
                    <div class="td__label-row">
                      <label class="text-caption" for="tpl-footer">Footer <em>(optional, no variables)</em></label>
                      <span class="text-caption">{{ footerLength() }} / 60</span>
                    </div>
                    <input id="tpl-footer" class="td__input" [formControl]="c('footerText')" maxlength="60"
                      placeholder="e.g. Thank you for choosing us" />
                  </div>
                }
              </form>
            </app-card>

            @if (isWhatsApp()) {
              <app-card title="Buttons" subtitle="Optional. Up to 2 link buttons and 1 call button appear under the message.">
                <div class="btns">
                  @for (b of buttons(); track $index; let i = $index) {
                    <div class="btn-row">
                      <select class="td__input btn-row__type" [value]="b.type" (change)="setButton(i, { type: $any($event.target).value })">
                        <option value="URL">Link</option>
                        <option value="PHONE_NUMBER">Call</option>
                      </select>
                      <input class="td__input btn-row__label" maxlength="25" placeholder="Label, e.g. Track shipment"
                        [value]="b.text" (input)="setButton(i, { text: $any($event.target).value })" />
                      @if (b.type === 'URL') {
                        <input class="td__input btn-row__target" placeholder="https://courier.skra.in/track/{{ '{{trackingNumber}}' }}"
                          [value]="b.url ?? ''" (input)="setButton(i, { url: $any($event.target).value })" />
                      } @else {
                        <input class="td__input btn-row__target" placeholder="+919876543210"
                          [value]="b.phoneNumber ?? ''" (input)="setButton(i, { phoneNumber: $any($event.target).value })" />
                      }
                      <button type="button" class="icon-btn" title="Remove button" (click)="removeButton(i)"><mat-icon>close</mat-icon></button>
                    </div>
                  }
                  <div class="btns__add">
                    <app-button variant="stroked" icon="link" [disabled]="linkCount() >= ${MAX_LINKS}" (pressed)="addButton('URL')">Add link button</app-button>
                    <app-button variant="stroked" icon="call" [disabled]="callCount() >= ${MAX_CALLS}" (pressed)="addButton('PHONE_NUMBER')">Add call button</app-button>
                  </div>
                  <p class="text-caption td__hint">A link may end in one variable — e.g. <code>https://courier.skra.in/track/{{ '{{trackingNumber}}' }}</code> sends each customer to their own shipment.</p>
                </div>
              </app-card>
            }

            @if (usedList().length) {
              <app-card title="Sample values" subtitle="Used in the preview, and shown to Meta's reviewer as the example for each variable.">
                <div class="samples">
                  @for (v of usedList(); track v) {
                    <label class="sample">
                      <span class="sample__name">{{ '{{' + v + '}}' }}</span>
                      <input class="td__input" [value]="sampleFor(v)" [placeholder]="defaultSample(v)" maxlength="200"
                        (input)="setSample(v, $any($event.target).value)" />
                    </label>
                  }
                </div>
              </app-card>
            }

            @if (isWhatsApp()) {
              <app-card title="Before you submit" subtitle="Meta's rules, checked as you type.">
                <ul class="checks">
                  @for (ck of checks(); track ck.text) {
                    <li [class.bad]="!ck.ok"><mat-icon>{{ ck.ok ? 'check_circle' : 'error' }}</mat-icon><span>{{ ck.text }}</span></li>
                  }
                </ul>
              </app-card>

              <app-card title="Meta approval" subtitle="Meta only delivers WhatsApp messages from templates it has approved.">
                <div class="meta">
                  <div class="meta__status">
                    @if (template()!.metaStatus; as ms) {
                      <app-status-badge [value]="ms" [tone]="metaTone(ms)" />
                      @if (template()!.metaSubmittedAt) { <span class="text-caption">submitted {{ template()!.metaSubmittedAt | date: 'medium' }}</span> }
                    } @else {
                      <span class="text-caption">Not submitted yet</span>
                    }
                  </div>
                  @if (template()!.metaStatusDetail) { <p class="text-caption">{{ template()!.metaStatusDetail }}</p> }
                  <p class="text-caption">Submitting saves your changes, then files the template with Meta; review takes minutes to a day. Changing the name, text, header, footer, buttons, category or language afterwards means submitting again.</p>
                  <div class="meta__actions">
                    <app-button variant="stroked" [loading]="metaBusy()" [disabled]="!!template()!.metaStatus"
                      (pressed)="submitToMeta()">Submit to Meta</app-button>
                    <app-button variant="stroked" [loading]="metaBusy()" (pressed)="refreshMeta()">Check status</app-button>
                  </div>
                </div>
              </app-card>
            }
          </div>

          <aside class="td__side">
            <div class="td__side-head">
              <strong>Live preview</strong>
              <div class="seg" role="group" aria-label="Preview mode">
                <button type="button" [class.on]="!showRaw()" (click)="showRaw.set(false)">Sample data</button>
                <button type="button" [class.on]="showRaw()" (click)="showRaw.set(true)">Variables</button>
              </div>
            </div>
            <app-phone-preview [channel]="template()!.channel" [name]="company()" [logo]="logo()"
              [segments]="segments()" [time]="time" [subject]="previewSubject()" [emailHtml]="emailHtml()"
              [header]="previewHeader()" [footer]="typed().footer || null" [buttons]="previewButtons()" />
            <p class="text-caption td__note">
              How the recipient sees it. {{ showRaw() ? 'Placeholders shown as typed.' : 'Placeholders filled with your sample values.' }}
            </p>
          </aside>
        </div>
      }
    </div>
  `,
  styles: [`
    .td__title { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
    .td__title h1 { margin:0; }
    .td__chan { font:600 14px var(--font-sans); letter-spacing:.04em; padding:3px 10px; border-radius:999px;
      background:var(--brand-50); color:var(--brand-600, var(--brand-500)); }
    .td__dirty { font:600 14px var(--font-sans); padding:3px 10px; border-radius:999px;
      background:var(--warning-bg); color:var(--warning); }
    .send { display:flex; align-items:center; gap:10px; padding:6px 14px 6px 10px; border-radius:999px;
      border:1px solid var(--surface-border); background:var(--surface); cursor:pointer; }
    .send--on { border-color:var(--success); background:var(--success-bg); }
    .send__text { display:flex; flex-direction:column; line-height:1.15; }
    .send__text strong { font:600 16px var(--font-sans); }
    .send__text em { font-style:normal; font-size:14px; color:var(--content-muted); }
    .warn { display:flex; gap:10px; align-items:flex-start; padding:10px 14px; border-radius:var(--r-field);
      background:var(--warning-bg); color:var(--warning); font:500 16px var(--font-sans); }
    .warn mat-icon { font-size:18px; width:18px; height:18px; flex-shrink:0; }
    .td { display:grid; grid-template-columns:minmax(0, 1fr) 360px; gap:20px; align-items:start; }
    .td__main { display:flex; flex-direction:column; gap:20px; min-width:0; }
    .td__form { display:flex; flex-direction:column; gap:14px; }
    .td__row { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .td__hint { margin:0; }
    .field { display:flex; flex-direction:column; gap:6px; }
    .td__label-row { display:flex; justify-content:space-between; align-items:baseline; }
    .td__label-row em { font-style:normal; opacity:.7; }
    .over { color:var(--danger); font-weight:600; }
    .td__input { width:100%; box-sizing:border-box; padding:9px 12px; border-radius:var(--r-field);
      border:1px solid var(--surface-border); background:var(--surface); font:400 17px var(--font-sans); color:var(--content-fg); }
    .td__input:focus, .td__textarea:focus { outline:2px solid var(--brand-300, var(--brand-500)); outline-offset:0; }
    .td__textarea { width:100%; box-sizing:border-box; padding:12px 14px; border-radius:0 0 var(--r-field) var(--r-field);
      border:1px solid var(--surface-border); background:var(--surface); font:400 17px/1.5 var(--font-sans);
      color:var(--content-fg); resize:vertical; min-height:200px; }
    .tb { position:relative; display:flex; align-items:center; gap:2px; padding:4px 6px; border:1px solid var(--surface-border);
      border-bottom:0; border-radius:var(--r-field) var(--r-field) 0 0; background:var(--surface-muted); }
    .tb + .td__textarea { border-top-left-radius:0; border-top-right-radius:0; }
    .tb__btn { min-width:32px; height:30px; border:0; border-radius:8px; background:transparent; cursor:pointer;
      color:var(--content-fg); font:500 17px var(--font-sans); display:inline-flex; align-items:center; justify-content:center; }
    .tb__btn:hover { background:var(--brand-50); }
    .tb__btn--mono { font:600 15px var(--font-mono, ui-monospace); }
    .tb__btn mat-icon { font-size:20px; width:20px; height:20px; }
    .tb__sep { width:1px; height:18px; background:var(--surface-border); margin:0 6px; }
    .emoji-backdrop { position:fixed; inset:0; z-index:20; }
    .emoji { position:absolute; top:100%; left:0; z-index:21; width:320px; max-height:300px; overflow:auto; padding:10px 12px;
      border:1px solid var(--surface-border); border-radius:var(--r-card); background:var(--surface);
      box-shadow:var(--shadow-clay-hover, 0 12px 30px rgba(15,23,42,.18)); }
    .emoji__name { font:600 14px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.04em; margin:6px 0 4px; }
    .emoji__grid { display:grid; grid-template-columns:repeat(8, 1fr); gap:2px; }
    .emoji__item { border:0; background:transparent; font-size:23px; padding:4px 0; border-radius:8px; cursor:pointer; }
    .emoji__item:hover { background:var(--brand-50); }
    .td__vars { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
    .chip { font:500 14px var(--font-mono, ui-monospace); padding:3px 8px; border-radius:999px;
      border:1px solid var(--surface-border); background:var(--surface-muted); cursor:pointer; color:var(--content-fg); }
    .chip:hover { background:var(--brand-50); }
    .btns { display:flex; flex-direction:column; gap:10px; }
    .btn-row { display:grid; grid-template-columns:96px minmax(120px, 1fr) minmax(160px, 2fr) 36px; gap:8px; align-items:center; }
    .icon-btn { width:34px; height:34px; border:0; border-radius:8px; background:transparent; cursor:pointer; color:var(--content-muted); }
    .icon-btn:hover { background:var(--danger-bg); color:var(--danger); }
    .btns__add { display:flex; gap:10px; flex-wrap:wrap; }
    .samples { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:12px 16px; }
    .sample { display:flex; flex-direction:column; gap:4px; }
    .sample__name { font:500 14px var(--font-mono, ui-monospace); color:var(--content-muted); }
    .checks { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
    .checks li { display:flex; gap:8px; align-items:center; font:400 16px var(--font-sans); color:var(--success); }
    .checks li span { color:var(--content-fg); }
    .checks li.bad { color:var(--danger); }
    .checks li.bad span { font-weight:600; }
    .checks mat-icon { font-size:18px; width:18px; height:18px; }
    .meta { display:flex; flex-direction:column; gap:10px; }
    .meta p { margin:0; }
    .meta__status { display:flex; align-items:center; gap:10px; }
    .meta__actions { display:flex; gap:10px; flex-wrap:wrap; }
    .td__side { position:sticky; top:16px; display:flex; flex-direction:column; gap:12px; }
    .td__side-head { display:flex; justify-content:space-between; align-items:center; gap:10px; }
    .seg { display:inline-flex; border:1px solid var(--surface-border); border-radius:999px; overflow:hidden; background:var(--surface); }
    .seg button { border:0; background:transparent; padding:5px 12px; font:500 15px var(--font-sans); color:var(--content-muted); cursor:pointer; }
    .seg button.on { background:var(--brand-500); color:#fff; }
    .td__note { text-align:center; margin:0; }
    code { font-family:var(--font-mono, ui-monospace); font-size:15px; }
    @media (max-width: 1040px) {
      .td { grid-template-columns:minmax(0, 1fr); }
      .td__side { position:static; order:-1; }
    }
    @media (max-width: 640px) {
      .td__row { grid-template-columns:1fr; }
      .btn-row { grid-template-columns:1fr 36px; }
      .btn-row__type, .btn-row__label, .btn-row__target { grid-column:1 / -1; }
    }
  `]
})
export class TemplateDetail implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(CommunicationService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(DialogService);

  private readonly contentBox = viewChild<ElementRef<HTMLTextAreaElement>>('contentBox');

  protected readonly categories = CATEGORIES;
  protected readonly languages = LANGUAGES;
  protected readonly emojiGroups = EMOJI_GROUPS;

  protected readonly template = signal<CommunicationTemplate | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly metaBusy = signal(false);
  protected readonly switching = signal(false);
  protected readonly resetting = signal(false);
  protected readonly showRaw = signal(false);
  protected readonly emojiOpen = signal(false);
  protected readonly time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  protected readonly form: FormGroup = this.fb.group({
    templateName: ['', [Validators.required, Validators.maxLength(150)]],
    subject: ['', Validators.maxLength(255)],
    content: ['', Validators.required],
    category: ['UTILITY'],
    language: ['en_US'],
    headerText: ['', Validators.maxLength(60)],
    footerText: ['', Validators.maxLength(60)]
  });

  /** Buttons and samples live outside the reactive form, as plain signals edited immutably. */
  protected readonly buttons = signal<TemplateButton[]>([]);
  private readonly samples = signal<Record<string, string>>({});
  private readonly extraDirty = signal(false);
  private readonly formDirty = signal(false);

  /** Mirror of the form as a signal, so everything derived from it recomputes per keystroke. */
  protected readonly typed = signal({ name: '', subject: '', content: '', header: '', footer: '', category: 'UTILITY', language: 'en_US' });

  protected readonly dirty = computed(() => this.formDirty() || this.extraDirty());
  protected readonly isWhatsApp = computed(() => this.template()?.channel === 'WHATSAPP');
  protected readonly company = computed(() => this.auth.companyName() ?? 'Your Company');
  protected readonly logo = computed(() => this.auth.companyLogo());
  protected readonly variables = computed(() => variablesFor(this.template()?.eventType ?? ''));
  protected readonly title = computed(() => words(this.template()?.eventType ?? ''));
  protected readonly linkCount = computed(() => this.buttons().filter((b) => b.type === 'URL').length);
  protected readonly callCount = computed(() => this.buttons().filter((b) => b.type === 'PHONE_NUMBER').length);
  protected readonly bodyLength = computed(() => this.typed().content.trim().length);
  protected readonly headerLength = computed(() => this.typed().header.length);
  protected readonly footerLength = computed(() => this.typed().footer.length);
  protected readonly subtitle = computed(() => this.template()?.eventType === 'DAILY_BUSINESS_SUMMARY'
    ? "Sent every morning at 9:00 AM (IST) with yesterday's figures, to the numbers in Channel Settings → WhatsApp → Daily report numbers."
    : 'Fill in {{variables}} wherever the shipment’s own details should appear.');

  /** Variables actually used by this message (body, header, button links) — one sample row each. */
  protected readonly usedList = computed(() => usedVariables(
    this.typed().content, this.typed().header, ...this.buttons().map((b) => b.url)));

  private readonly values = computed(() => {
    const merged = sampleValues(this.auth.companyName());
    for (const [k, v] of Object.entries(this.samples())) if (v?.trim()) merged[k] = v.trim();
    return merged;
  });

  private readonly filled = computed(() =>
    this.showRaw() ? this.typed().content : fillVariables(this.typed().content, this.values()));

  protected readonly segments = computed(() =>
    this.isWhatsApp() ? parseWhatsApp(this.filled()) : parsePlain(this.filled()));
  protected readonly previewSubject = computed(() =>
    this.showRaw() ? this.typed().subject : fillVariables(this.typed().subject, this.values()));
  protected readonly emailHtml = computed(() => this.filled());
  protected readonly previewHeader = computed(() => {
    const h = this.typed().header;
    if (!this.isWhatsApp() || !h) return null;
    return this.showRaw() ? h : fillVariables(h, this.values());
  });
  protected readonly previewButtons = computed(() =>
    this.isWhatsApp() ? this.buttons().map((b) => ({ type: b.type, text: b.text })) : []);

  protected readonly checks = computed(() => whatsappChecks({
    name: this.typed().name, body: this.typed().content, header: this.typed().header, footer: this.typed().footer,
    buttons: this.buttons(), known: Object.keys(sampleValues())
  }));

  /** True when saving would change something Meta approved — so the approval would be reset. */
  protected readonly resetsApproval = computed(() => {
    const t = this.template();
    if (!t?.metaStatus || !this.dirty()) return false;
    const x = this.typed();
    return x.name !== t.templateName || x.content !== t.content || x.category !== t.category
      || x.language !== t.language || x.header !== (t.headerText ?? '') || x.footer !== (t.footerText ?? '')
      || JSON.stringify(this.cleanButtons()) !== JSON.stringify(this.cleanStored(t.buttons));
  });

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.syncTyped();
      this.formDirty.set(this.form.dirty);
    });
  }

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Communication' }, { label: 'Templates', route: '/communication/templates' }, { label: 'Edit' }]);
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.service.getTemplate(id).subscribe({
      next: (t) => this.adopt(t),
      error: () => this.loadError.set('This template could not be loaded. It may have been removed.')
    });
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  protected back(): void { void this.router.navigateByUrl('/communication/templates'); }

  // ------------------------------------------------------------------ sending switch

  /** Immediate and independent of Save — "turn sending on or off whenever I need". */
  protected toggleSending(on: boolean): void {
    const t = this.template();
    if (!t || this.switching()) return;
    this.switching.set(true);
    this.service.setTemplateStatus(t.id, on ? 'ACTIVE' : 'INACTIVE').subscribe({
      next: (updated) => {
        // Only the status and version move; whatever is being typed stays.
        this.template.set({ ...t, status: updated.status, version: updated.version });
        this.switching.set(false);
        this.notify.success(on ? 'Sending turned on.' : 'Sending turned off.');
      },
      error: (e) => {
        // Re-assert the stored state so the switch snaps back.
        this.template.set({ ...t });
        this.switching.set(false);
        this.notify.error(apiMessage(e, 'Could not change whether this template sends.'));
      }
    });
  }

  // ------------------------------------------------------------------ composing

  protected wrap(kind: WrapKind): void {
    const box = this.contentBox()?.nativeElement;
    if (!box) return;
    const r = wrapSelection(this.c('content').value ?? '', box.selectionStart, box.selectionEnd, kind);
    this.applyContent(r.text, r.start, r.end);
  }

  protected onKey(event: KeyboardEvent): void {
    if (!this.isWhatsApp() || !(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'b') { event.preventDefault(); this.wrap('bold'); }
    else if (key === 'i') { event.preventDefault(); this.wrap('italic'); }
  }

  protected addEmoji(emoji: string): void {
    this.emojiOpen.set(false);
    this.insert(emoji);
  }

  protected insertVariable(variable: string): void { this.insert(`{{${variable}}}`); }

  private insert(text: string): void {
    const box = this.contentBox()?.nativeElement;
    const value = (this.c('content').value ?? '') as string;
    const r = insertAt(value, box?.selectionStart ?? value.length, box?.selectionEnd ?? value.length, text);
    this.applyContent(r.text, r.caret, r.caret);
  }

  private applyContent(text: string, selStart: number, selEnd: number): void {
    const control = this.c('content');
    control.setValue(text);
    control.markAsDirty();
    this.formDirty.set(true);
    queueMicrotask(() => {
      const box = this.contentBox()?.nativeElement;
      box?.focus();
      box?.setSelectionRange(selStart, selEnd);
    });
  }

  // ------------------------------------------------------------------ buttons & samples

  protected addButton(type: 'URL' | 'PHONE_NUMBER'): void {
    this.buttons.update((list) => [...list, type === 'URL'
      ? { type, text: '', url: 'https://' } : { type, text: '', phoneNumber: '+91' }]);
    this.extraDirty.set(true);
  }

  protected setButton(index: number, patch: Partial<TemplateButton>): void {
    this.buttons.update((list) => list.map((b, i) => (i === index ? { ...b, ...patch } : b)));
    this.extraDirty.set(true);
  }

  protected removeButton(index: number): void {
    this.buttons.update((list) => list.filter((_, i) => i !== index));
    this.extraDirty.set(true);
  }

  protected sampleFor(variable: string): string { return this.samples()[variable] ?? ''; }
  protected defaultSample(variable: string): string { return sampleValues(this.auth.companyName())[variable] ?? ''; }

  protected setSample(variable: string, value: string): void {
    this.samples.update((m) => ({ ...m, [variable]: value }));
    this.extraDirty.set(true);
  }

  // ------------------------------------------------------------------ save & Meta

  protected discard(): void {
    const t = this.template();
    if (t) this.adopt(t);
  }

  protected save(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.persist(() => this.notify.success('Template saved.'));
  }

  /** Back to the app's own text and settings for this event and channel — confirmed first, because it replaces everything typed. */
  protected resetToDefault(): void {
    const t = this.template();
    if (!t || this.resetting()) return;
    this.confirm.confirm({
      title: 'Reset to default',
      message: `The name, message${t.channel === 'WHATSAPP' ? ', category, language, header, footer, buttons and sample values' : ''} `
        + `go back to the app's default for ${this.title()} on ${t.channel}. `
        + (t.metaStatus ? `Its Meta approval (${t.metaStatus}) is dropped, so it must be submitted again. ` : '')
        + `Sending stays ${t.status === 'ACTIVE' ? 'ON' : 'OFF'}.`,
      confirmLabel: 'Reset', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.resetting.set(true);
      this.service.resetTemplateToDefault(t.id).subscribe({
        next: (reset) => {
          this.adopt(reset);
          this.resetting.set(false);
          this.notify.success('Template reset to default.');
        },
        error: (e) => { this.resetting.set(false); this.notify.error(apiMessage(e, 'Could not reset the template.')); }
      });
    });
  }

  protected metaTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
    if (status === 'APPROVED') return 'success';
    if (status === 'PENDING' || status === 'IN_APPEAL') return 'warning';
    if (status === 'REJECTED' || status === 'DISABLED' || status === 'PAUSED') return 'danger';
    return 'neutral';
  }

  /** Saves first — Meta is sent the stored row, never the unsent form. */
  protected submitToMeta(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.metaBusy.set(true);
    const submit = () => this.service.submitTemplateToMeta(this.template()!.id).subscribe({
      next: (t) => {
        this.adopt(t);
        this.metaBusy.set(false);
        this.notify.success('Submitted to Meta — use Check status to see the outcome.');
      },
      error: (e) => { this.metaBusy.set(false); this.notify.error(apiMessage(e, 'Meta did not accept the template.')); }
    });
    if (this.dirty()) this.persist(submit, () => this.metaBusy.set(false)); else submit();
  }

  protected refreshMeta(): void {
    this.metaBusy.set(true);
    this.service.refreshTemplateMetaStatus(this.template()!.id).subscribe({
      next: (t) => {
        // Only the Meta fields change; keep whatever is being typed.
        this.template.set({ ...this.template()!, metaStatus: t.metaStatus, metaStatusDetail: t.metaStatusDetail,
          metaTemplateId: t.metaTemplateId, metaCategory: t.metaCategory, metaLanguage: t.metaLanguage,
          metaSubmittedAt: t.metaSubmittedAt, version: t.version });
        this.metaBusy.set(false);
        this.notify.success(`Meta status: ${t.metaStatus ?? 'unknown'}.`);
      },
      error: (e) => { this.metaBusy.set(false); this.notify.error(apiMessage(e, 'Could not read the status from Meta.')); }
    });
  }

  private persist(onSuccess: () => void, onError: () => void = () => undefined): void {
    const t = this.template()!;
    const v = this.form.getRawValue();
    const whatsApp = t.channel === 'WHATSAPP';
    this.saving.set(true);
    this.service.updateTemplate(t.id, {
      templateName: (v.templateName || t.templateName).trim(),
      subject: t.channel === 'EMAIL' ? (v.subject || null) : null,
      content: v.content,
      status: t.status,
      version: t.version,
      ...(whatsApp ? {
        category: v.category, language: v.language,
        headerText: (v.headerText ?? '').trim(), footerText: (v.footerText ?? '').trim(),
        buttons: this.cleanButtons(), variableSamples: this.cleanSamples()
      } : {})
    }).subscribe({
      next: (updated) => { this.adopt(updated); this.saving.set(false); onSuccess(); },
      error: (e) => { this.saving.set(false); onError(); this.notify.error(apiMessage(e, 'Could not save the template.')); }
    });
  }

  private cleanButtons(): TemplateButton[] { return this.cleanStored(this.buttons()); }

  private cleanStored(list: TemplateButton[] | undefined): TemplateButton[] {
    return (list ?? []).map((b) => b.type === 'URL'
      ? { type: b.type, text: b.text.trim(), url: (b.url ?? '').trim(), phoneNumber: null }
      : { type: b.type, text: b.text.trim(), url: null, phoneNumber: (b.phoneNumber ?? '').replace(/[\s-]/g, '') });
  }

  /** Only variables still used, and only non-blank values — what the backend should keep. */
  private cleanSamples(): Record<string, string> {
    const used = this.usedList();
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.samples())) if (v?.trim() && used.includes(k)) out[k] = v.trim();
    return out;
  }

  private syncTyped(): void {
    const v = this.form.getRawValue();
    this.typed.set({
      name: v.templateName ?? '', subject: v.subject ?? '', content: v.content ?? '', header: v.headerText ?? '',
      footer: v.footerText ?? '', category: v.category ?? 'UTILITY', language: v.language ?? 'en_US'
    });
  }

  /** Load a stored template into the page, clearing every unsaved flag. */
  private adopt(t: CommunicationTemplate): void {
    this.template.set(t);
    this.form.reset({
      templateName: t.templateName, subject: t.subject ?? '', content: t.content,
      category: t.category ?? 'UTILITY', language: t.language ?? 'en_US',
      headerText: t.headerText ?? '', footerText: t.footerText ?? ''
    }, { emitEvent: false });
    this.buttons.set((t.buttons ?? []).map((b) => ({ ...b })));
    this.samples.set({ ...(t.variableSamples ?? {}) });
    this.syncTyped();
    this.form.markAsPristine();
    this.formDirty.set(false);
    this.extraDirty.set(false);
  }
}
