import { useEffect, useState } from "react";
import { request } from "./api";
type DashboardData = { message: string };
let dashboardRequest: Promise<DashboardData> | undefined;
function loadDashboard() {
  dashboardRequest ??= request<DashboardData>("/dashboard").catch((error) => {
    dashboardRequest = undefined;
    throw error;
  });
  return dashboardRequest;
}
export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loadDashboard()
      .then((value) => active && setData(value))
      .catch(
        (reason) =>
          active &&
          setError(
            reason instanceof Error ? reason.message : "Chargement impossible",
          ),
      );
    return () => {
      active = false;
    };
  }, []);
  return (
    <main className="page">
      <h1>Tableau de bord</h1>
      <p>
        Fondation de la version en ligne. Aucun module métier n’est encore
        activé.
      </p>
      {error ? (
        <div className="error">{error}</div>
      ) : (
        <div className="card">{data?.message ?? "Chargement…"}</div>
      )}
    </main>
  );
}
