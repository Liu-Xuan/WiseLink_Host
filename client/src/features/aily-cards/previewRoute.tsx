import { Route } from 'react-router-dom';

import AilyCardsPreviewPage from '../../pages/AilyCardsPreviewPage/AilyCardsPreviewPage';

/**
 * DEV/QA harness route only. The production app entry must not import this
 * module because doing so would pull the preview renderer and mock fixtures
 * into the hosted bundle even when the route is conditionally hidden.
 */
export const ailyCardsPreviewRoute = (
  <Route path="aily-cards" element={<AilyCardsPreviewPage />} />
);
