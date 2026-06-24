import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-field-error',
  standalone: true,
  template: `
    @if (errors[path]?.length) {
      <p class="field-error">{{ errors[path][0] }}</p>
    }
  `,
})
export class FieldErrorComponent {
  @Input({ required: true }) errors: Record<string, string[]> = {};
  @Input({ required: true }) path = '';
}
