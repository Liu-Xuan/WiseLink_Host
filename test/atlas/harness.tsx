// Browser-only integration harness. Not a product route or production data provider.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CurrentUserSessionProvider } from '../../client/src/app/providers/CurrentUserSessionProvider';
import { WlThemeProvider } from '../../client/src/app/providers/ThemeProvider';
import AtlasLauncher from '../../client/src/features/atlas/AtlasLauncher';
import '../../client/src/index.css';
function Harness() {
  return (
    <MemoryRouter initialEntries={['/library']}>
      <CurrentUserSessionProvider>
        <WlThemeProvider>
          <main>
            <h1>Atlas component integration fixture</h1>
            <textarea
              aria-label="Background draft"
              defaultValue="keep this unsent draft"
            />
            <AtlasLauncher />
          </main>
        </WlThemeProvider>
      </CurrentUserSessionProvider>
    </MemoryRouter>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
