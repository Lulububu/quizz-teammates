import { Component, Input } from '@angular/core';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CircleCheck, Clock3, Copy,
  Crown, Download, Eye, EyeOff, Film, Image, Link, List, LockKeyhole, Maximize,
  MoreHorizontal, Music2, Pencil, Play, Plus, QrCode, Search, Settings2,
  Trash2, Upload, UserRound, X, RefreshCw, LucideAngularModule,
} from 'lucide-angular';

const icons = {
  'arrow-down': ArrowDown, 'arrow-left': ArrowLeft, 'arrow-right': ArrowRight,
  'arrow-up': ArrowUp, check: Check, success: CircleCheck, clock: Clock3, copy: Copy,
  crown: Crown, download: Download, eye: Eye, 'eye-off': EyeOff, film: Film,
  image: Image, link: Link, list: List, lock: LockKeyhole, maximize: Maximize,
  more: MoreHorizontal, music: Music2, pencil: Pencil, play: Play, plus: Plus,
  qr: QrCode, search: Search, settings: Settings2, trash: Trash2, upload: Upload,
  person: UserRound, x: X, refresh: RefreshCw,
};
export type IconName = keyof typeof icons;

@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [LucideAngularModule],
  template: `<lucide-icon [img]="icons[name]" [size]="size" [strokeWidth]="1.8" aria-hidden="true" />`,
  host: { 'aria-hidden': 'true' },
})
export class IconComponent {
  @Input() name: IconName = 'image';
  @Input() size = 20;
  readonly icons = icons;
}
