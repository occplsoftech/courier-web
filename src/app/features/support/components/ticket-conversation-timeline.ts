import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import {
  TicketAssignmentHistoryEntry, TicketMessage, TicketStatusHistoryEntry
} from '@core/models/ticket.model';

interface Entry {
  at: string;
  kind: 'message' | 'status' | 'assignment';
  icon: string;
  title: string;
  body?: string;
  internal: boolean;
}

/** Merged conversation + status + assignment timeline, one vertical line — same markup/CSS
 *  as `ShipmentTimeline`, fed ticket events instead of fixed shipment steps. Internal notes
 *  are visually distinct; the backend has already stripped them for a non-staff caller, so
 *  anything with `internalNote: true` reaching this component is safe to render. */
@Component({
  selector: 'app-ticket-conversation-timeline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatIconModule],
  template: `
    <div class="tl">
      @if (entries().length === 0) {
        <p class="text-caption tl__empty">No activity yet.</p>
      }
      @for (e of entries(); track e.at + e.title) {
        <div class="tl__row" [class.tl__row--internal]="e.internal">
          <div class="tl__icon"><mat-icon>{{ e.icon }}</mat-icon></div>
          <div class="tl__body">
            <div class="tl__head">
              <strong>{{ e.title }}</strong>
              @if (e.internal) { <span class="tl__badge">Internal</span> }
              <span class="text-caption">{{ e.at | date: 'medium' }}</span>
            </div>
            @if (e.body) { <p class="tl__text">{{ e.body }}</p> }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .tl { display:flex; flex-direction:column; }
    .tl__empty { padding:24px 0; text-align:center; }
    .tl__row { display:flex; gap:16px; align-items:flex-start; padding:14px 4px; position:relative; }
    .tl__row:not(:last-child)::before { content:''; position:absolute; left:21px; top:48px; bottom:-2px; width:3px;
      border-radius:3px; background:var(--surface-border); }
    .tl__icon { width:42px; height:42px; border-radius:16px; background:var(--surface-muted); color:var(--content-muted);
      display:grid; place-items:center; flex:0 0 auto; z-index:1; box-shadow:var(--shadow-clay-inset); }
    .tl__row--internal .tl__icon { background:linear-gradient(155deg, #fbbf24, var(--warning)); color:#fff; }
    .tl__body { display:flex; flex-direction:column; gap:4px; padding-top:6px; flex:1; }
    .tl__head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .tl__head strong { font:600 17px var(--font-sans); color:var(--content-fg); }
    .tl__badge { display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:999px;
      background:var(--warning-bg); color:var(--warning); font:700 14px var(--font-sans); text-transform:uppercase; }
    .tl__text { margin:0; font:400 17px var(--font-sans); color:var(--content-fg); white-space:pre-wrap; }
    .tl__row--internal .tl__text { background:var(--warning-bg); padding:8px 12px; border-radius:var(--r-field); }
  `]
})
export class TicketConversationTimeline {
  readonly messages = input<TicketMessage[]>([]);
  readonly statusHistory = input<TicketStatusHistoryEntry[]>([]);
  readonly assignmentHistory = input<TicketAssignmentHistoryEntry[]>([]);
  /** userId -> display name, for author/actor labels. */
  readonly userNames = input<Map<string, string>>(new Map());

  readonly entries = computed<Entry[]>(() => {
    const names = this.userNames();
    const who = (id: string) => names.get(id) ?? 'Someone';

    const messageEntries: Entry[] = this.messages().map((m) => ({
      at: m.createdAt, kind: 'message', icon: m.internalNote ? 'lock' : 'chat_bubble',
      title: `${who(m.authorUserId)} ${m.internalNote ? 'added an internal note' : 'replied'}`,
      body: m.body, internal: m.internalNote
    }));

    const statusEntries: Entry[] = this.statusHistory().map((h) => ({
      at: h.createdAt, kind: 'status', icon: 'flag',
      title: h.fromStatus
        ? `${who(h.changedByUserId)} moved the ticket from ${format(h.fromStatus)} to ${format(h.toStatus)}`
        : `${who(h.changedByUserId)} raised the ticket`,
      body: h.remarks ?? undefined, internal: false
    }));

    const assignmentEntries: Entry[] = this.assignmentHistory().map((h) => ({
      at: h.createdAt, kind: 'assignment', icon: h.action === 'ESCALATED' ? 'priority_high' : 'person_add',
      title: `${who(h.assignedByUserId)} ${verb(h.action)} ${who(h.assignedToUserId)}`,
      body: h.remarks ?? undefined, internal: false
    }));

    return [...messageEntries, ...statusEntries, ...assignmentEntries]
      .sort((a, b) => a.at.localeCompare(b.at));
  });
}

function format(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function verb(action: string): string {
  if (action === 'ASSIGNED') return 'assigned to';
  if (action === 'REASSIGNED') return 'reassigned to';
  return 'escalated to';
}
