import React from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import DocumentParsingPage from './pages/DocumentParsingPage/DocumentParsingPage';
import NotFound from './pages/NotFound/NotFound';
import RuntimeProbePage from './pages/RuntimeProbePage/RuntimeProbePage';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DocumentParsingPage />} />
        <Route path="runtime-probe" element={<RuntimeProbePage />} />
        <Route
          path="work-items/:workItemId/documents"
          element={<DocumentParsingPage />}
        />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
