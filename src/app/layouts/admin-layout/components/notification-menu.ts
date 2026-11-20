import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { AppNotification, NotificationFeedService } from '@core/services/notification-feed.service';

/** Header bell + dropdown feed. Shows an unread badge and an empty state until data lands. */
@Component({
  selector: 'app-notification-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatMenuModule],
  template: `
    <button class="nm__btn" [matMenuTriggerFor]="menu" aria-label="Notifications">
      <mat-icon>notifications</mat-icon>
      @if (feed.unreadCount() > 0) {
        <span class="nm__badge">{{ feed.unreadCount() > 9 ? '9+' : feed.unreadCount() }}</span>
      }
    </button>

    <mat-menu #menu="matMenu" class="nm__menu">
      <div class="nm__head" (click)="$event.stopPropagation()">
        <span class="text-h3">Notifications</span>
        @if (feed.unreadCount() > 0) {
          <button class="nm__mark" (click)="feed.markAllRead()">Mark all read</button>
        }
      </div>

      @if (feed.items().length === 0) {
        <div class="nm__empty">
          <mat-icon>notifications_off</mat-icon>
          <p>You're all caught up</p>
          <span>New notifications will appear here.</span>
        </div>
      } @else {
        <div class="nm__list">
          @for (n of feed.items(); track n.id) {
            <button class="nm__item" [class.nm__item--unread]="!n.read" (click)="open(n)">
              <mat-icon class="nm__item-icon" [attr.data-level]="n.level ?? 'info'">{{ n.icon }}</mat-icon>
              <span class="nm__item-body">
                <span class="nm__item-title">{{ n.title }}</span>
                <span class="nm__item-msg">{{ n.message }}</span>
              </span>
            </button>
          }
        </div>
      }
    </mat-menu>
  `,
  styles: [`
    .nm__btn { position:relative; display:grid; place-items:center; width:40px; height:40px;
      border-radius:12px; border:0; background:transparent; color:var(--content-muted); cursor:pointer; transition:background .15s, box-shadow .15s; }
    .nm__btn:hover { background:var(--surface-muted); color:var(--content-fg); box-shadow:var(--shadow-clay-inset); }
    .nm__badge { position:absolute; top:5px; right:5px; min-width:16px; height:16px; padding:0 4px;
      border-radius:999px; background:var(--danger); color:#fff; font:700 13px var(--font-sans);
      display:grid; place-items:center; }
    .nm__head { display:flex; align-items:center; justify-content:space-between; padding:12px 16px;
      border-bottom:1px solid var(--surface-border); }
    .nm__mark { border:0; background:transparent; color:var(--brand-600); font:600 15px var(--font-sans); cursor:pointer; }
    .nm__empty { display:flex; flex-direction:column; align-items:center; gap:4px; padding:32px 24px; text-align:center; }
    .nm__empty mat-icon { color:var(--content-muted); font-size:32px; width:32px; height:32px; margin-bottom:4px; }
    .nm__empty p { margin:0; font:600 17px var(--font-sans); color:var(--content-fg); }
    .nm__empty span { font:400 15px var(--font-sans); color:var(--content-muted); }
    .nm__list { max-height:360px; overflow-y:auto; }
    .nm__item { display:flex; gap:12px; width:100%; padding:12px 16px; border:0; background:transparent;
      text-align:left; cursor:pointer; border-bottom:1px solid var(--surface-border); }
    .nm__item:hover { background:var(--surface-muted); }
    .nm__item--unread { background:var(--brand-50); }
    .nm__item-icon { flex-shrink:0; }
    .nm__item-body { display:flex; flex-direction:column; gap:2px; min-width:0; }
    .nm__item-title { font:600 16px var(--font-sans); color:var(--content-fg); }
    .nm__item-msg { font:400 15px var(--font-sans); color:var(--content-muted); }
  `]
})
export class NotificationMenu {
  protected readonly feed = inject(NotificationFeedService);
  private readonly router = inject(Router);

  open(n: AppNotification): void {
    this.feed.markRead(n.id);
    if (n.ticketId) this.router.navigate(['/support/tickets', n.ticketId]);
    else if (n.followUpId) this.router.navigate(['/follow-ups', n.followUpId]);
  }
}
