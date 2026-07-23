import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  DashboardReport,
  SafeUser,
  TopProductsResponse,
} from "@maktaba/shared-types";
import { request } from "./api";
import { centsToMad } from "./money";

type TopPeriod = TopProductsResponse["period"];

export default function Dashboard({ user }: { user: SafeUser }) {
  const [data, setData] = useState<DashboardReport>();
  const [topProducts, setTopProducts] = useState<TopProductsResponse>();
  const [period, setPeriod] = useState<TopPeriod>("30d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");
  const [topError, setTopError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    request<DashboardReport>("/reports/dashboard", {
      signal: controller.signal,
    })
      .then(setData)
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Erreur");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (period === "custom" && (!startDate || !endDate)) {
      setTopProducts(undefined);
      return;
    }
    setTopProducts(undefined);
    const controller = new AbortController();
    const params = new URLSearchParams({ period, limit: "10" });
    if (period === "custom") {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }
    setTopError("");
    request<TopProductsResponse>(`/reports/top-products?${params}`, {
      signal: controller.signal,
    })
      .then(setTopProducts)
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === "AbortError") return;
        setTopError(reason instanceof Error ? reason.message : "Erreur");
      });
    return () => controller.abort();
  }, [period, startDate, endDate]);

  if (error)
    return (
      <main className="page">
        <div className="error error-state" role="alert">
          <strong>Tableau de bord indisponible</strong>
          <span>{error}</span>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="page">
        <div className="loading-state" role="status">
          Chargement du tableau de bord…
        </div>
      </main>
    );

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

  const top = topProducts?.rows[0];
  const customDatesMissing = period === "custom" && (!startDate || !endDate);

  return (
    <main className="page dashboard-page">
      <div className="page-header">
        <div>
          <h1>Tableau de bord</h1>
          <p>Vue d’ensemble de l’activité du magasin aujourd’hui.</p>
        </div>
        <div className="inline-actions">
          {user.permissions.includes("pos.use") && (
            <Link className="button" to="/pos">
              Nouvelle vente
            </Link>
          )}
          {user.permissions.includes("stock.adjust") && (
            <Link className="button secondary" to="/stock/receive">
              Réception de stock
            </Link>
          )}
          {user.permissions.includes("products.create") && (
            <Link className="button secondary" to="/products/new">
              Ajouter un produit
            </Link>
          )}
          {user.permissions.includes("register.view") && (
            <Link className="button secondary" to="/register">
              Ouvrir ou fermer la caisse
            </Link>
          )}
        </div>
      </div>
      <section className="metrics" aria-label="Indicateurs principaux">
        {cards.map(([label, value]) => (
          <article className="metric-card" key={label}>
            <span className="metric-label">{label}</span>
            <strong className="metric-value">{value}</strong>
          </article>
        ))}
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h2>Produits les plus vendus</h2>
            <p>Classement net après déduction des retours.</p>
          </div>
          <label>
            Période
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value as TopPeriod)}
            >
              <option value="today">Aujourd’hui</option>
              <option value="7d">7 derniers jours</option>
              <option value="30d">30 derniers jours</option>
              <option value="month">Ce mois</option>
              <option value="custom">Période personnalisée</option>
            </select>
          </label>
        </div>
        {period === "custom" && (
          <div className="inline-actions">
            <label>
              Date de début
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>
            <label>
              Date de fin
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
          </div>
        )}
        {topError && <div className="error">{topError}</div>}
        {top && (
          <div className="notice">
            Produit le plus vendu : <b>{top.productName}</b> · {top.netQuantitySold}{" "}
            unité(s) · {centsToMad(top.netRevenueCents)}
          </div>
        )}
        {customDatesMissing ? (
          <div className="empty-state">
            Sélectionnez une date de début et une date de fin.
          </div>
        ) : !topProducts && !topError ? (
          <div className="loading-state">Chargement du classement…</div>
        ) : topProducts?.rows.length === 0 ? (
          <div className="empty-state">
            Aucune vente enregistrée pour cette période.
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Produit</th>
                  <th>Catégorie</th>
                  <th>Quantité nette vendue</th>
                  <th>Chiffre d’affaires net</th>
                  <th>Stock actuel</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {topProducts?.rows.map((row) => (
                  <tr key={row.productId}>
                    <td>#{row.rank}</td>
                    <td>{row.productName}</td>
                    <td>{row.categoryName || "—"}</td>
                    <td>{row.netQuantitySold}</td>
                    <td>{centsToMad(row.netRevenueCents)}</td>
                    <td>{row.currentStock}</td>
                    <td>{row.status === "archived" ? "Archivé" : "Actif"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {user.permissions.includes("sales.view") && (
        <section className="section-card">
          <div className="section-header">
            <div>
              <h2>Ventes récentes</h2>
              <p>Dernières opérations enregistrées.</p>
            </div>
            <Link to="/sales">Voir toutes les ventes</Link>
          </div>
          {data.recentSales.length === 0 ? (
            <div className="empty-state">Aucune vente récente.</div>
          ) : (
            <div className="activity-list">
              {data.recentSales.map((sale) => (
                <div className="activity-row" key={sale.id}>
                  <Link to={`/sales/${sale.id}`}>{sale.saleNumber}</Link>
                  <strong>{centsToMad(sale.totalCents)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
