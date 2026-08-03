import { useQuery } from "@tanstack/react-query";
import { Route, Routes } from "react-router";

import {
  ApiClientError,
  ApiClientProtocolError,
  fetchApi
} from "./api/client";
import {
  healthResponseSchema,
  type HealthResponse
} from "../schema/api";

async function fetchHealth(): Promise<HealthResponse> {
  return fetchApi("/api/health", healthResponseSchema);
}

function getHealthErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `APIエラー: ${error.code} (HTTP ${error.status})`;
  }

  if (error instanceof ApiClientProtocolError) {
    return "APIとの通信または応答形式の確認に失敗しました。";
  }

  return "API接続に失敗しました。Fastifyが起動しているか確認してください。";
}

function HomePage() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    retry: false
  });

  let healthMessage = "API接続を確認中…";
  if (healthQuery.isError) {
    healthMessage = getHealthErrorMessage(healthQuery.error);
  } else if (healthQuery.isSuccess) {
    healthMessage = `API接続: 正常 (${healthQuery.data.data.status})`;
  }

  return (
    <main className="app-shell">
      <p className="eyebrow">P0-01</p>
      <h1>subdub</h1>
      <p>開発環境の最小画面です。</p>
      <p role="status" className={healthQuery.isError ? "health health-error" : "health"}>
        {healthMessage}
      </p>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}
