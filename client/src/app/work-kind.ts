export const workKindOptions = [
  { value: 'film', label: 'Film' },
  { value: 'livre', label: 'Livre' },
  { value: 'musique', label: 'Musique' },
  { value: 'jeu vidéo', label: 'Jeu vidéo' },
  { value: 'other', label: 'Autre œuvre' },
] as const;

export function workKindLabel(kind?: string): string {
  return workKindOptions.find((option) => option.value === kind)?.label ?? (kind && kind !== 'other' ? kind : 'Œuvre');
}
