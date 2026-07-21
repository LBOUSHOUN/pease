import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ProductListRow, ProductLookup, SafeUser } from "@maktaba/shared-types";
import { ApiFailure, request } from "./api";
import { useScanner } from "./use-scanner";

type ReceiptResult = { productId: number; quantityAdded: number; newStock: number; duplicate: boolean };

export default function StockReceiving({ user }: { user: SafeUser }) {
  const [barcode, setBarcode] = useState("");
  const [product, setProduct] = useState<ProductListRow>();
  const [quantity, setQuantity] = useState("1");
  const [unknown, setUnknown] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const focusScanner = () => requestAnimationFrame(() => input.current?.focus());
  const lookup = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    setBarcode(code);
    setError("");
    setSuccess("");
    setUnknown("");
    try {
      const found = (await request<ProductLookup>(`/products/lookup/${encodeURIComponent(code)}`)).product;
      if (found.productType !== "physical_product" || !found.trackStock)
        throw new Error("Ce produit ne gère pas de stock.");
      if (!found.isActive) throw new Error("Ce produit est inactif.");
      if (found.inventoryMode === "serialized")
        throw new Error("Ce produit utilise le suivi avancé par unité.");
      setProduct(found);
      setQuantity("1");
    } catch (reason) {
      setProduct(undefined);
      if (reason instanceof ApiFailure && reason.status === 404) setUnknown(code);
      else setError(reason instanceof Error ? reason.message : "Produit introuvable.");
    } finally {
      focusScanner();
    }
  }, []);

  useScanner((code) => void lookup(code), { duplicateWindowMs: 0 });
  useEffect(() => { focusScanner(); }, []);

  const confirmReceipt = async (event: FormEvent) => {
    event.preventDefault();
    if (!product) return;
    const amount = Number(quantity);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) {
      setError("Saisissez une quantité entière positive.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await request<ReceiptResult>("/stock/receipts", {
        method: "POST",
        json: { productId: product.id, quantity: amount, idempotencyKey: crypto.randomUUID() },
      });
      setSuccess(`${result.quantityAdded} unité(s) ajoutée(s). Nouveau stock : ${result.newStock}.`);
      setProduct(undefined);
      setBarcode("");
      setQuantity("1");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "La réception a échoué.");
    } finally {
      setSubmitting(false);
      focusScanner();
    }
  };

  const amount = Number(quantity);
  const projected = product && Number.isInteger(amount) && amount > 0 ? product.currentStock + amount : product?.currentStock;
  return (
    <main className="page stock-receiving-page" data-scanner-workflow="receiving">
      <div className="page-header">
        <div><h1>Réception de stock</h1><p>Scannez un produit, indiquez la quantité reçue, puis confirmez.</p></div>
        <Link className="button secondary" to="/stock">Retour au stock</Link>
      </div>
      <section className="section-card receiving-scanner">
        <label htmlFor="receiving-barcode">Code-barres du produit</label>
        <div className="inline-actions">
          <input
            id="receiving-barcode"
            ref={input}
            data-scanner-input="true"
            autoComplete="off"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void lookup(barcode); } }}
            placeholder="Scannez ou saisissez un code-barres"
          />
          <button type="button" onClick={() => void lookup(barcode)}>Rechercher</button>
        </div>
        <small>Le scanner reste prêt pour la réception suivante.</small>
      </section>
      {error && <div className="error" role="alert">{error}</div>}
      {success && <div className="notice" role="status">{success}</div>}
      {unknown && (
        <section className="section-card" role="alert">
          <h2>Produit inconnu</h2><p>Le code <strong>{unknown}</strong> ne correspond à aucun produit.</p>
          {user.permissions.includes("products.create")
            ? <Link className="button" to={`/products/new?barcode=${encodeURIComponent(unknown)}`}>Créer ce produit</Link>
            : <p>Vous ne disposez pas de la permission nécessaire pour créer un produit.</p>}
        </section>
      )}
      {product && (
        <form className="section-card receiving-confirm" onSubmit={confirmReceipt}>
          <div><span>Produit</span><strong>{product.name}</strong></div>
          <div><span>Stock actuel</span><strong>{product.currentStock}</strong></div>
          <label>Quantité reçue
            <input type="number" min="1" max="100000" step="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </label>
          <div><span>Nouveau stock</span><strong>{projected}</strong></div>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => { setProduct(undefined); setBarcode(""); focusScanner(); }}>Annuler</button>
            <button type="submit" disabled={submitting}>{submitting ? "Enregistrement…" : "Confirmer la réception"}</button>
          </div>
        </form>
      )}
    </main>
  );
}
