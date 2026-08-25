/**
 * The card gallery is a design and QA surface, never a production user route.
 * Vite's standard `qa` mode allows an explicit QA build without inventing a
 * second WiseLink environment contract.
 */
export function isAilyCardsPreviewEnvironment(
  mode: string,
  isDevelopment: boolean,
): boolean {
  return isDevelopment || mode === 'qa' || mode === 'test';
}
