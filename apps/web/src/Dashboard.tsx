import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardReport, SafeUser } from "@maktaba/shared-types";
import { request } from "./api";
import { centsToMad } from "./money";

export default function Dashboard({ user }: { user: SafeUser }) {
  const [data, setData] = useState<DashboardReport>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    request<DashboardReport>("/reports/dashboard", { signal: controller.signal })
      .then(setData)
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Erreur");
      });
    return () => controller.abort();
  }, []);
  if (error)
    return <main className="page"><div className="error error-state" role="alert"><strong>Tableau de bord indisponible</strong><span>{error}</span></div></main>;
  if (!data)
    return <main className="page"><div className="loading-state" role="status">Chargement du tableau de bord…</div></main>;

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
    cards.splice(3, 0, ["Marge brute estimée", centsToMad(data.estimatedProfitTodayCents)]);

  return (
    <main className="page dashboard-page">
      <div className="page-header">
        <div><h1>Tableau de bord</h1><p>Vue d’ensemble de l’activité du magasin aujourd’hui.</p></div>
        {user.permissions.includes("pos.use") && <Link className="button" to="/pos">Nouvelle vente</Link>}
      </div>
      <section className="metrics" aria-label="Indicateurs principaux">
        {cards.map(([label, value]) => (
          <article className="metric-card" key={label}>
            <span className="metric-label">{label}</span>
            <strong className="metric-value">{value}</strong>
          </article>
        ))}
      </section>
      {user.permissions.includes("sales.view") && (
        <section className="section-card">
          <div className="section-header">
            <div><h2>Ventes récentes</h2><p>Dernières opérations enregistrées.</p></div>
            <Link to="/sales">Voir toutes les ventes</Link>
          </div>
          {data.recentSales.length === 0 ? <div className="empty-state">Aucune vente récente.</div> : (
            <div className="activity-list">{data.recentSales.map((sale) => (
              <div className="activity-row" key={sale.id}>
                <Link to={`/sales/${sale.id}`}>{sale.saleNumber}</Link>
                <strong>{centsToMad(sale.totalCents)}</strong>
              </div>
            ))}</div>
          )}
        </section>
      )}
    </main>
  );
}
