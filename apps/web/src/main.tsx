import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@xyflow/react/dist/style.css";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "katex/dist/katex.min.css";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, retry: 1 }, mutations: { retry: 0 } },
});

const theme = createTheme({
  primaryColor: "teal",
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  headings: { fontFamily: "Georgia, 'Times New Roman', serif" },
  defaultRadius: "md",
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <ModalsProvider>
          <Notifications position="bottom-right" />
          <App />
        </ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
