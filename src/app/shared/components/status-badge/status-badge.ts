import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Pill for statuses (ACTIVE, PENDING, SUSPENDED …). Maps common values to a tone. */
@Component({
  selector: 'app-status-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [attr.data-tone]="resolvedTone()">{{ label() || value() }}</span>`,
  styles: [`
    .badge { display:inline-flex; align-items:center; height:24px; padding:0 11px;
      border-radius:var(--r-pill); font:700 15px/1 var(--font-sans); text-transform:capitalize; }
    .badge[data-tone="success"] { background:var(--success-bg); color:var(--success); }
    .badge[data-tone="warning"] { background:var(--warning-bg); color:var(--warning); }
    .badge[data-tone="danger"]  { background:var(--danger-bg);  color:var(--danger); }
    .badge[data-tone="info"]    { background:var(--info-bg);    color:var(--info); }
    .badge[data-tone="neutral"] { background:var(--neutral-bg); color:var(--neutral); }
  `]
})
export class StatusBadge {
  readonly value = input<string>('');
  readonly label = input<string>('');
  readonly tone = input<Tone | null>(null);

  readonly resolvedTone = computed<Tone>(() => {
    if (this.tone()) return this.tone()!;
    const v = this.value().toUpperCase();
    if (['ACTIVE', 'DELIVERED', 'PAID', 'APPROVED'].includes(v)) return 'success';
    if (['PENDING', 'TRIAL', 'IN_TRANSIT'].includes(v)) return 'warning';
    if (['INACTIVE', 'SUSPENDED', 'EXPIRED', 'LOCKED', 'DISABLED', 'REJECTED', 'RTO'].includes(v)) return 'danger';
    return 'neutral';
  });
}
