import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { ME_KEY } from "./api/auth";
import { isApiError } from "./api/client";
import { RequireAuth } from "./auth/RequireAuth";
import { Layout } from "./components/Layout";
import { TelematicsProvider } from "./hooks/telematics";
import "./index.css";
import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { StatusPage } from "./pages/StatusPage";

const queryClient: QueryClient = new QueryClient({
  // any 401 means the session expired or was revoked: drop the user, RequireAuth redirects to /login
  queryCache: new QueryCache({
    onError: (err, query) => {
      if (isApiError(err, 401) && query.queryKey !== ME_KEY) {
        queryClient.setQueryData(ME_KEY, null);
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: (count, err) => !isApiError(err, 401) && !isApiError(err, 403) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <TelematicsProvider>
                  <Layout />
                </TelematicsProvider>
              </RequireAuth>
            }
          >
            <Route index element={<StatusPage />} />
            <Route
              path="admin"
              element={
                <RequireAuth roles={["admin"]}>
                  <AdminPage />
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
