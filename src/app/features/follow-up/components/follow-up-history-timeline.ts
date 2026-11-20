import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FollowUpHistoryEntry } from '@core/models/follow-up.model';

const ICONS: Record<string, string> = {
  CREATED: 'add_box', UPDATED: 'edit', STATUS_CHANGED: 'sync_alt',
  RESCHEDULED: 'event_repeat', ASSIGNED: 'person_add', NOTE_ADDED: 'sticky_note_2'
};

function label(v: string): string { return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

/** Follow-up's own timeline — creation, every status change, reschedule, assignment and
 *  note, oldest first. Copies `TicketConversationTimeline`'s vertical-line markup. */
@Component({
  selector: 'app-follow-up-history-timeline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    @if (entries.length === 0) {
      <p class="text-caption">No history yet.</p>
    } @else {
      <ol class="tl">
        @for (e of entries; track e.id) {
          <li class="tl__item">
            <span class="tl__dot"><i class="material-icons">{{ icon(e.action) }}</i></span>
            <div class="tl__body">
              <p class="tl__title">{{ describe(e) }}</p>
              @if (e.note) { <p class="tl__note">{{ e.note }}</p> }
              <p class="tl__meta">{{ userLabel(e.changedByUserId) }} · {{ e.createdAt | date: 'medium' }}</p>
            </div>
          </li>
        }
      </ol>
    }
  `,
  styles: [`
    .tl { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0; }
    .tl__item { display:flex; gap:12px; padding:0 0 18px 0; position:relative; }
    .tl__item:not(:last-child)::before { content:''; position:absolute; left:15px; top:32px; bottom:0;
      width:2px; background:var(--surface-border); }
    .tl__dot { flex:0 0 32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center;
      background:var(--surface-muted); box-shadow:var(--shadow-clay-inset); z-index:1; }
    .tl__dot i { font-size:19px; color:var(--brand-600); }
    .tl__body { flex:1; padding-top:4px; }
    .tl__title { margin:0; font:600 16px var(--font-sans); color:var(--content-fg); }
    .tl__note { margin:4px 0 0; font:400 16px var(--font-sans); color:var(--content-fg); white-space:pre-wrap; }
    .tl__meta { margin:4px 0 0; font:400 15px var(--font-sans); color:var(--content-muted); }
  `]
})
export class FollowUpHistoryTimeline {
  @Input() entries: FollowUpHistoryEntry[] = [];
  @Input() userNames: Map<string, string> = new Map();

  icon(action: string): string { return ICONS[action] ?? 'circle'; }
  userLabel(id?: string | null): string { return id ? (this.userNames.get(id) ?? id) : 'System'; }

  describe(e: FollowUpHistoryEntry): string {
    switch (e.action) {
      case 'CREATED': return 'Follow-up created';
      case 'UPDATED': return 'Details updated';
      case 'STATUS_CHANGED': return `Status changed ${e.fromStatus ? label(e.fromStatus) + ' → ' : ''}${label(e.toStatus ?? '')}`;
      case 'RESCHEDULED': return 'Rescheduled';
      case 'ASSIGNED': return `Assigned to ${this.userLabel(e.assignedToUserId)}`;
      case 'NOTE_ADDED': return 'Note added';
      default: return label(e.action);
    }
  }
}
