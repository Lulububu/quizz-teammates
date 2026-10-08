import { Directive, ElementRef, HostListener } from '@angular/core';

@Directive({ selector: 'details[appDismissPopover]', standalone: true })
export class DismissPopoverDirective {
  constructor(private element: ElementRef<HTMLDetailsElement>) {}

  @HostListener('document:click', ['$event'])
  onOutsideClick(event: MouseEvent): void {
    const details = this.element.nativeElement;
    if (details.open && !event.composedPath().includes(details)) details.open = false;
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    const details = this.element.nativeElement;
    if (!details.open) return;
    details.open = false;
    details.querySelector('summary')?.focus();
    event.preventDefault();
  }
}
