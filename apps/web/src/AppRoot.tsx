import { RouterProvider, useRouterState } from "@tanstack/react-router";

import { BrowserProfileReporter } from "./browser/BrowserProfileReporter";
import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";

/**
 * Owns renderer-wide providers. The Electron browser host intentionally sits
 * outside the router so its webviews survive route transitions, but it must
 * share the same atom registry as routed UI. The desktop Control window loads
 * this same app, so it skips them: the main window already hosts the browser
 * and handles its link and quit events.
 */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  const controlWindow = useRouterState({
    router,
    select: (state) => state.location.pathname === "/control-window",
  });
  return (
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
      {!controlWindow && (
        <>
          <ElectronBrowserHost />
          <BrowserProfileReporter />
          <QuitHoldOverlay />
        </>
      )}
    </AppAtomRegistryProvider>
  );
}
