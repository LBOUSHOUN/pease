import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardReport, SafeUser } from "@maktaba/shared-types";
import { request } from "./api";
import { centsToMad } from "./money";

export default function Dashboard({ user }: { user: SafeUser }) {
  const [data, setData] = useState<DashboardReport>(),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    request<DashboardReport>("/reports/dashboard", {
      signal: controller.signal,
    })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError")
          setError(e instanceof Error ? e.message : "Erreur");
      });
    return () => controller.abort();
  }, []);
  if (error)
    return (
      <main className="page">
        <div className="error">{error}</div>
      </main>
    );
  if (!data) return <main className="page">Chargement…</main>;
  const cards: [string, string | number][] = [
    ["Ventes aujourd’hui", centsToMad(data.salesTodayCents)],
    ["Retours aujourd’hui", centsToMad(data.returnsTodayCents)],
    ["Ventes nettes", centsToMad(data.netSalesTodayCents)],
    ["Dette clients", centsToMad(data.customerDebtCents)],
    ["Dette fournisseurs", centsToMad(data.supplierDebtCents)],
    ["Dépenses aujourd’hui", centsToMad(data.expensesTodayCents)],
    ["Stock faible", data.lowStockCount],
    ["Ruptures", data.outOfStockCount],
    ["Caisses ouvertes", data.openRegisters],
  ];
  if (data.estimatedProfitTodayCents !== null)
    cards.splice(3, 0, [
      "Marge brute estimée",
      centsToMad(data.estimatedProfitTodayCents),
    ]);
  return (
    <main className="page">
      <h1>Tableau de bord</h1>
      <div className="metrics">
        {cards.map(([label, value]) => (
          <div className="card" key={label}>
            <small>{label}</small>
            <b>{value}</b>
          </div>
        ))}
      </div>
      {user.permissions.includes("sales.view") && (
        <>
          <h2>Ventes récentes</h2>
          {data.recentSales.length === 0 ? (
            <p>Aucune vente récente.</p>
          ) : (
            data.recentSales.map((s) => (
              <p key={s.id}>
                <Link to={`/sales/${s.id}`}>{s.saleNumber}</Link> ·{" "}
                {centsToMad(s.totalCents)}
              </p>
            ))
          )}
        </>
      )}
    </main>
  );
}
