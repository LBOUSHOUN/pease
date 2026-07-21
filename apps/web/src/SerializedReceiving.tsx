import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ProductListResponse, SafeUser, SerializedReceivingSession } from "@maktaba/shared-types";
import { request } from "./api";
import { analyzeBarcodeImport } from "./serialized-import";

const MAX_EXPECTED_QUANTITY = 1000;

export default function SerializedReceiving({ user }: { user: SafeUser }) {
  const [params] = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const [products, setProducts] = useState<ProductListResponse["rows"]>([]);
  const [productId, setProductId] = useState(params.get("productId") ?? "");
  const [expectedQuantity, setExpectedQuantity] = useState("1");
  const [session, setSession] = useState<SerializedReceivingSession>();
  const [barcode, setBarcode] = useState("");
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState("");
  const canAdjust = user.permissions.includes("serialized_units.adjust");

  useEffect(() => {
    request<ProductListResponse>("/products?status=active&productType=physical_product&pageSize=100")
      .then((data) => setProducts(data.rows.filter((p) => p.inventoryMode === "serialized")))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (session?.status === "draft") input.current?.focus();
  }, [session]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    const quantity = Number(expectedQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_EXPECTED_QUANTITY) {
      setError(`La quantité prévue doit être un entier entre 1 et ${MAX_EXPECTED_QUANTITY}.`);
      return;
    }
    setBusy(true); setError("");
    try {
      setSession(await request<SerializedReceivingSession>("/serialized-receiving", {
        method: "POST", json: { productId: Number(productId), expectedQuantity: quantity },
      }));
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setBusy(false); }
  };

  const scan = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const next = await request<SerializedReceivingSession>(`/serialized-receiving/${session.id}/scans`, {
        method: "POST", json: { barcode },
      });
      setSession(next); setBarcode("");
      setMessage(next.remainingQuantity === 0
        ? `${next.expectedQuantity} unités scannées. Réception prête à être confirmée.`
        : `Unité ajoutée — ${next.scannedQuantity} / ${next.expectedQuantity}`);
    } catch (e) {
      const text = e instanceof Error ? e.message : "Erreur";
      if (text.includes("déjà")) setDuplicateCount((n) => n + 1);
      setError(text); setBarcode("");
    } finally { setBusy(false); setTimeout(() => input.current?.focus()); }
  };

  const remove = async (scanId: number) => {
    if (!session) return;
    await request(`/serialized-receiving/${session.id}/scans/${scanId}`, { method: "DELETE" });
    setSession(await request(`/serialized-receiving/${session.id}`));
    input.current?.focus();
  };

  const changeQuantity = async () => {
    if (!session) return;
    const value = Number(expectedQuantity);
    try {
      setSession(await request(`/serialized-receiving/${session.id}/expected-quantity`, {
        method: "PATCH", json: { expectedQuantity: value },
      }));
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
  };

  const confirm = async () => {
    if (!session || session.scannedQuantity !== session.expectedQuantity) return;
    setBusy(true);
    try {
      const done = await request<SerializedReceivingSession>(`/serialized-receiving/${session.id}/confirm`, { method: "POST" });
      setSession(done); setMessage(`Réception confirmée : ${done.scannedQuantity} unité(s) ajoutée(s).`);
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!session || !window.confirm("Annuler cette réception ? Les codes scannés ne seront pas enregistrés en stock.")) return;
    setBusy(true);
    try { setSession(await request(`/serialized-receiving/${session.id}/cancel`, { method: "POST" })); }
    catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setBusy(false); }
  };
  const analysis = analyzeBarcodeImport(importText, session?.remainingQuantity ?? 0);
  const importBatch = async () => {
    if (!session || analysis.invalid.length || analysis.duplicate.length || analysis.extra.length || !analysis.valid.length) return;
    setBusy(true); setError("");
    try {
      const next = await request<SerializedReceivingSession>(`/serialized-receiving/${session.id}/scans/batch`, {
        method: "POST", json: { barcodes: analysis.valid },
      });
      setSession(next); setImportText("");
      setMessage(`${analysis.valid.length} unité(s) ajoutée(s) au lot.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setBusy(false); }
  };

  return <main className="page serialized-receiving">
    <div className="title"><h1>Réception d’unités sérialisées</h1><Link to="/products">Produits</Link></div>
    {error && <div className="error" role="alert">{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {!session ? <form onSubmit={start} className="grid-form receiving-start">
      <label>Produit
        <select required value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Choisir un produit sérialisé</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label>Quantité prévue
        <input required type="number" min="1" max={MAX_EXPECTED_QUANTITY} step="1" value={expectedQuantity} onChange={(e) => setExpectedQuantity(e.target.value)} />
      </label>
      <button disabled={busy || !productId}>Commencer le scan</button>
    </form> : <>
      <section className="receiving-progress" aria-live="polite">
        <div><small>Produit</small><strong>{session.productName}</strong></div>
        <div><small>Unités scannées</small><strong>{session.scannedQuantity} / {session.expectedQuantity}</strong></div>
        <div><small>Restantes</small><strong>{session.remainingQuantity}</strong></div>
        <div><small>Doublons</small><strong>{duplicateCount}</strong></div>
      </section>
      {session.status === "draft" && <>
        <form onSubmit={scan} className="scanner receiving-scanner">
          <label>Code-barres de l’unité
            <input ref={input} value={barcode} onChange={(e) => setBarcode(e.target.value)} required autoComplete="off" placeholder="Scanner l’unité suivante" />
          </label>
          <button disabled={busy || session.remainingQuantity === 0}>Ajouter</button>
        </form>
        {canAdjust && <div className="receiving-adjust">
          <label>Modifier la quantité prévue <input type="number" min={session.scannedQuantity || 1} max={MAX_EXPECTED_QUANTITY} value={expectedQuantity} onChange={(e) => setExpectedQuantity(e.target.value)} /></label>
          <button type="button" className="secondary" onClick={() => void changeQuantity()}>Appliquer</button>
        </div>}
        <section className="receiving-import">
          <h2>Importer plusieurs codes</h2>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Un code-barres par ligne" rows={5} />
          <input type="file" accept=".csv,text/csv,text/plain" aria-label="Importer un fichier CSV" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void file.text().then(setImportText);
          }} />
          <p>Valides : {analysis.valid.length} · Doublons : {analysis.duplicate.length} · Invalides : {analysis.invalid.length} · En trop : {analysis.extra.length}</p>
          <button type="button" disabled={busy || !analysis.valid.length || Boolean(analysis.invalid.length || analysis.duplicate.length || analysis.extra.length)} onClick={() => void importBatch()}>
            Ajouter le lot validé
          </button>
          {(analysis.invalid.length > 0 || analysis.duplicate.length > 0 || analysis.extra.length > 0) && <p className="error">Corrigez tout le lot avant l’ajout. Aucune ligne n’a été importée.</p>}
        </section>
      </>}
      <section className="receiving-scans"><h2>Codes récemment scannés</h2>
        {!session.scans.length ? <p className="empty">Aucune unité scannée.</p> : <ul>{session.scans.map((item) => <li key={item.id}><code>{item.barcode}</code>{session.status === "draft" && <button className="link" onClick={() => void remove(item.id)}>Retirer</button>}</li>)}</ul>}
      </section>
      <div className="actions receiving-actions">
        {session.status === "draft" && <button disabled={busy || session.scannedQuantity !== session.expectedQuantity} onClick={() => void confirm()}>Confirmer la réception</button>}
        {session.status === "draft" && <button className="secondary" disabled={busy} onClick={() => void cancel()}>Annuler</button>}
        <Link className="button secondary" to={`/products/${session.productId}`}>Retour au produit</Link>
      </div>
    </>}
  </main>;
}
