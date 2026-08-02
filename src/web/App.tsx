import { useQuery } from "@tanstack/react-query";
import { Route, Routes } from "react-router";

type HealthResponse = {
  status: string;
};

async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health");

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}.`);
  }

  return (await response.json()) as HealthResponse;
}

function HomePage() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    retry: false
  });

  let healthMessage = "API接続を確認中…";
  if (healthQuery.isError) {
    healthMessage = "API接続に失敗しました。Fastifyが起動しているか確認してください。";
  } else if (healthQuery.isSuccess) {
    healthMessage = `API接続: 正常 (${healthQuery.data.status})`;
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
