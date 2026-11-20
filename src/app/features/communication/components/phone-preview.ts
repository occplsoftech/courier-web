import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { CommunicationChannel } from '@core/models/communication.model';
import { PreviewSegment } from '../template-preview';

/**
 * A received message as it would look on an iPhone — WhatsApp (white bubble on the beige chat
 * wallpaper), SMS (iMessage-style grey bubble) or Email (a mail card). Purely presentational:
 * the caller passes already-filled segments, so what shows here is the message the typed
 * template would actually produce.
 */
@Component({
  selector: 'app-phone-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    @if (channel() === 'EMAIL') {
      <div class="mail">
        <div class="mail__bar"><mat-icon>mail</mat-icon><span>Inbox</span></div>
        <div class="mail__head">
          <div class="mail__avatar">{{ initial() }}</div>
          <div class="mail__meta">
            <strong>{{ name() }}</strong>
            <span>to me · {{ time() }}</span>
          </div>
        </div>
        <h4 class="mail__subject">{{ subject() || '(no subject)' }}</h4>
        <div class="mail__body" [innerHTML]="emailHtml()"></div>
      </div>
    } @else {
      <div class="phone" [attr.data-channel]="channel()">
        <div class="phone__island"></div>
        <div class="screen">
          <div class="status">
            <span class="status__time">{{ time() }}</span>
            <span class="status__icons">
              <mat-icon>signal_cellular_alt</mat-icon><mat-icon>wifi</mat-icon><mat-icon>battery_full</mat-icon>
            </span>
          </div>

          @if (channel() === 'WHATSAPP') {
            <div class="wa-head">
              <mat-icon class="wa-head__back">arrow_back_ios_new</mat-icon>
              <div class="avatar">
                @if (logo(); as src) { <img [src]="src" alt="" /> } @else { {{ initial() }} }
              </div>
              <div class="wa-head__who">
                <strong>{{ name() }}</strong>
                <span>business account</span>
              </div>
              <mat-icon>videocam</mat-icon><mat-icon>call</mat-icon>
            </div>
            <div class="chat">
              <div class="chip">TODAY</div>
              <div class="msg">
                <div class="bubble bubble--wa">
                  @if (header()) { <div class="bubble__header">{{ header() }}</div> }
                  <div class="bubble__text">
                    @for (s of segments(); track $index) {
                      <span [class.b]="s.bold" [class.i]="s.italic" [class.s]="s.strike" [class.m]="s.mono"
                        [class.l]="s.link">{{ s.text }}</span>
                    }
                  </div>
                  @if (footer()) { <div class="bubble__footer">{{ footer() }}</div> }
                  <span class="bubble__time">{{ time() }}</span>
                </div>
                @for (b of buttons(); track $index) {
                  <div class="wa-btn">
                    <mat-icon>{{ b.type === 'URL' ? 'open_in_new' : 'call' }}</mat-icon>
                    <span>{{ b.text || (b.type === 'URL' ? 'Open link' : 'Call') }}</span>
                  </div>
                }
              </div>
            </div>
            <div class="wa-input">
              <mat-icon>add</mat-icon>
              <div class="wa-input__field">Message</div>
              <mat-icon>photo_camera</mat-icon><mat-icon>mic</mat-icon>
            </div>
          } @else {
            <div class="sms-head">
              <mat-icon class="sms-head__back">arrow_back_ios_new</mat-icon>
              <div class="avatar avatar--sms">
                @if (logo(); as src) { <img [src]="src" alt="" /> } @else { {{ initial() }} }
              </div>
              <span class="sms-head__name">{{ name() }}</span>
            </div>
            <div class="chat chat--sms">
              <div class="sms-stamp">Text Message<br />Today {{ time() }}</div>
              <div class="bubble bubble--sms">
                @for (s of segments(); track $index) {
                  <span [class.l]="s.link">{{ s.text }}</span>
                }
              </div>
            </div>
            <div class="sms-input">
              <mat-icon>add_circle</mat-icon>
              <div class="sms-input__field">Text Message</div>
            </div>
          }
          <div class="home"></div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display:block; }
    mat-icon { font-size:18px; width:18px; height:18px; }

    /* ---- iPhone frame ---- */
    .phone { position:relative; width:300px; height:620px; margin:0 auto; background:#0e0e10; border-radius:46px;
      padding:10px; box-sizing:border-box; box-shadow:0 24px 50px rgba(15,23,42,.28), inset 0 0 0 2px #2b2b30; }
    .phone__island { position:absolute; top:19px; left:50%; transform:translateX(-50%); width:86px; height:24px;
      background:#000; border-radius:14px; z-index:3; }
    .screen { position:relative; height:100%; border-radius:36px; overflow:hidden; display:flex; flex-direction:column;
      background:#fff; font-family:-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif; color:#111; }
    .status { display:flex; justify-content:space-between; align-items:center; padding:14px 22px 6px;
      font-size:16px; font-weight:600; background:#f6f6f6; }
    .status__icons { display:flex; gap:3px; align-items:center; }
    .status__icons mat-icon { font-size:15px; width:15px; height:15px; }
    .avatar { width:34px; height:34px; border-radius:50%; background:#d9e4ec; color:#355; display:flex;
      align-items:center; justify-content:center; font-weight:600; flex-shrink:0; overflow:hidden; }
    .avatar img { width:100%; height:100%; object-fit:cover; }
    .home { position:absolute; bottom:6px; left:50%; transform:translateX(-50%); width:104px; height:4px;
      border-radius:3px; background:#111; opacity:.85; }

    /* ---- WhatsApp ---- */
    .wa-head { display:flex; align-items:center; gap:9px; padding:6px 12px 8px; background:#f6f6f6;
      border-bottom:1px solid #e3e3e3; }
    .wa-head__back { color:#007aff; font-size:17px; width:17px; height:17px; }
    .wa-head__who { display:flex; flex-direction:column; flex:1; min-width:0; line-height:1.15; }
    .wa-head__who strong { font-size:17px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .wa-head__who span { font-size:14px; color:#6b7280; }
    .wa-head > mat-icon:not(.wa-head__back) { color:#007aff; }
    .chat { flex:1; overflow:hidden; padding:10px 10px 0; background-color:#efeae2;
      background-image:radial-gradient(rgba(0,0,0,.045) 1px, transparent 1.4px); background-size:14px 14px; }
    .chip { width:max-content; margin:2px auto 10px; padding:3px 10px; border-radius:8px; background:#fff;
      font-size:14px; color:#54656f; letter-spacing:.03em; box-shadow:0 1px 1px rgba(0,0,0,.08); }
    .msg { max-width:86%; width:fit-content; display:flex; flex-direction:column; gap:2px; }
    .bubble { position:relative; width:fit-content; min-width:0; padding:7px 9px 6px; font-size:16.5px; line-height:1.32;
      box-shadow:0 1px .5px rgba(11,20,26,.13); word-break:break-word; }
    .bubble--wa { background:#fff; border-radius:0 8px 8px 8px; }
    .bubble--wa::before { content:''; position:absolute; top:0; left:-7px; border-style:solid;
      border-width:0 8px 8px 0; border-color:transparent #fff transparent transparent; }
    .bubble__text { white-space:pre-wrap; }
    .bubble__header { font-weight:700; margin-bottom:3px; font-size:17px; }
    .bubble__footer { margin-top:4px; font-size:14.5px; color:#667781; }
    .wa-btn { display:flex; align-items:center; justify-content:center; gap:6px; padding:8px 10px; background:#fff;
      border-radius:8px; color:#027eb5; font-size:16.5px; font-weight:500; box-shadow:0 1px .5px rgba(11,20,26,.13); }
    .wa-btn mat-icon { font-size:16px; width:16px; height:16px; }
    .bubble__time { display:block; text-align:right; font-size:13.5px; color:#667781; margin-top:2px; }
    .b { font-weight:700; } .i { font-style:italic; } .s { text-decoration:line-through; }
    .m { font-family:ui-monospace, Menlo, monospace; font-size:15.5px; }
    .l { color:#027eb5; text-decoration:underline; }
    .wa-input { display:flex; align-items:center; gap:10px; padding:8px 12px 24px; background:#f6f6f6; color:#007aff; }
    .wa-input__field { flex:1; background:#fff; border:1px solid #d8d8d8; border-radius:18px; padding:5px 12px;
      font-size:16px; color:#9aa0a6; }

    /* ---- SMS (Messages) ---- */
    .sms-head { display:flex; flex-direction:column; align-items:center; gap:3px; padding:4px 12px 8px;
      background:#f6f6f6; border-bottom:1px solid #e3e3e3; position:relative; }
    .sms-head__back { position:absolute; left:12px; top:14px; color:#007aff; font-size:17px; width:17px; height:17px; }
    .avatar--sms { width:36px; height:36px; background:#b5bcc6; color:#fff; }
    .sms-head__name { font-size:14.5px; color:#333; }
    .chat--sms { background:#fff; background-image:none; padding:12px 12px 0; }
    .sms-stamp { text-align:center; font-size:13.5px; color:#8e8e93; margin-bottom:10px; line-height:1.3; }
    .bubble--sms { background:#e9e9eb; border-radius:18px; padding:8px 12px; font-size:16.5px; white-space:pre-wrap;
      box-shadow:none; }
    .sms-input { display:flex; align-items:center; gap:8px; padding:8px 12px 24px; color:#9aa0a6; }
    .sms-input__field { flex:1; border:1px solid #d1d1d6; border-radius:18px; padding:5px 12px; font-size:16px; }

    /* ---- Email ---- */
    .mail { width:100%; box-sizing:border-box; border:1px solid var(--surface-border); border-radius:16px;
      background:#fff; color:#111; box-shadow:0 10px 30px rgba(15,23,42,.10); overflow:hidden;
      font-family:-apple-system, 'Helvetica Neue', Arial, sans-serif; }
    .mail__bar { display:flex; align-items:center; gap:8px; padding:10px 14px; background:#f6f6f6;
      border-bottom:1px solid #e3e3e3; font-size:16px; color:#007aff; }
    .mail__head { display:flex; gap:10px; align-items:center; padding:14px 16px 4px; }
    .mail__avatar { width:36px; height:36px; border-radius:50%; background:#d9e4ec; display:flex;
      align-items:center; justify-content:center; font-weight:600; }
    .mail__meta { display:flex; flex-direction:column; font-size:15px; color:#6b7280; }
    .mail__meta strong { font-size:17px; color:#111; }
    .mail__subject { margin:8px 16px 4px; font-size:19px; }
    .mail__body { padding:6px 16px 18px; font-size:17px; line-height:1.5; }
    .mail__body :is(p) { margin:0 0 10px; }
  `]
})
export class PhonePreview {
  readonly channel = input.required<CommunicationChannel>();
  /** The business name shown in the chat header. */
  readonly name = input('Your Company');
  readonly logo = input<string | null>(null);
  readonly segments = input<PreviewSegment[]>([]);
  readonly time = input('9:41 AM');
  readonly subject = input<string | null>(null);
  /** WhatsApp only: bold line above the text, grey line below it, and the rows under the bubble. */
  readonly header = input<string | null>(null);
  readonly footer = input<string | null>(null);
  readonly buttons = input<{ type: string; text: string }[]>([]);
  /** Email body (HTML). Angular's sanitiser strips anything dangerous at render. */
  readonly emailHtml = input('');

  protected readonly initial = computed(() => (this.name().trim()[0] ?? '?').toUpperCase());
}
