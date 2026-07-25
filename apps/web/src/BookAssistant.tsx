import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  CategoryListResponse,
  ProductListRow,
  SafeUser,
} from "@maktaba/shared-types";
import { request } from "./api";
import CameraScanner from "./CameraScanner";
import {
  findIsbnInText,
  normalizeIsbn,
  ocrSuggestions,
  validateBookImage,
} from "./book-assistant";

type BarcodeDetectorLike = {
  detect(source: ImageBitmap): Promise<Array<{ rawValue: string }>>;
};
type TextDetectorLike = {
  detect(source: ImageBitmap): Promise<Array<{ rawValue: string }>>;
};

export default function BookAssistant({ user }: { user: SafeUser }) {
  const navigate = useNavigate(),
    [categories, setCategories] = useState<CategoryListResponse["rows"]>([]),
    [isbn10, setIsbn10] = useState(""),
    [isbn13, setIsbn13] = useState(""),
    [title, setTitle] = useState(""),
    [author, setAuthor] = useState(""),
    [publisher, setPublisher] = useState(""),
    [description, setDescription] = useState(""),
    [status, setStatus] = useState("Saisie manuelle disponible."),
    [error, setError] = useState(""),
    [duplicates, setDuplicates] = useState<ProductListRow[]>([]),
    [preview, setPreview] = useState(""),
    [camera, setCamera] = useState(false),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    previewRef = useRef("");

  const clearTemporaryImage = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setPreview("");
    setStatus("Saisie manuelle disponible.");
    setError("");
  };
  const cancelAssistant = () => {
    clearTemporaryImage();
    setIsbn10("");
    setIsbn13("");
    setTitle("");
    setAuthor("");
    setPublisher("");
    setDescription("");
    setDuplicates([]);
    setConfirmed(false);
  };

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  useEffect(() => {
    void request<CategoryListResponse>("/categories?status=active&pageSize=100")
      .then((result) => setCategories(result.rows))
      .catch(() => setError("Impossible de charger les catégories."));
  }, []);

  const applyIsbn = async (raw: string) => {
    const normalized = normalizeIsbn(raw);
    if (!normalized) {
      setError("ISBN invalide.");
      return;
    }
    setIsbn10(normalized.isbn10 ?? "");
    setIsbn13(normalized.isbn13 ?? "");
    setStatus("ISBN détecté.");
    setError("");
    const params = new URLSearchParams();
    if (normalized.isbn10) params.set("isbn10", normalized.isbn10);
    if (normalized.isbn13) params.set("isbn13", normalized.isbn13);
    const result = await request<{ rows: ProductListRow[] }>(
      `/products/book-duplicates?${params}`,
    );
    setDuplicates(result.rows);
    if (result.rows.length) setStatus("Produit déjà existant.");
  };

  const analyze = async (file?: File) => {
    if (!file) return;
    const validation = validateBookImage(file);
    if (validation) return setError(validation);
    setBusy(true);
    setError("");
    setStatus("Analyse de l’image…");
    const objectUrl = URL.createObjectURL(file);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = objectUrl;
    setPreview(objectUrl);
    try {
      const bitmap = await createImageBitmap(file);
      if (
        bitmap.width < 50 ||
        bitmap.height < 50 ||
        bitmap.width > 8000 ||
        bitmap.height > 8000
      )
        throw new Error("Dimensions d’image non prises en charge.");
      const scope = window as typeof window & {
        BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
        TextDetector?: new () => TextDetectorLike;
      };
      if (scope.BarcodeDetector) {
        const detector = new scope.BarcodeDetector({
          formats: ["ean_13", "ean_8", "code_128"],
        });
        for (const code of await detector.detect(bitmap)) {
          const isbn = normalizeIsbn(code.rawValue);
          if (isbn) {
            await applyIsbn(code.rawValue);
            bitmap.close();
            return;
          }
        }
      }
      if (scope.TextDetector) {
        const detected = await new scope.TextDetector().detect(bitmap);
        const rawText = detected.map((item) => item.rawValue).join("\n");
        const isbn = findIsbnInText(rawText);
        if (isbn) await applyIsbn(isbn.isbn13 ?? isbn.isbn10!);
        else {
          const suggestion = ocrSuggestions(rawText);
          if (!title && suggestion.title) setTitle(suggestion.title);
          setStatus(
            suggestion.title
              ? "Informations proposées par OCR — vérifiez-les."
              : "Aucun ISBN détecté — saisie manuelle disponible.",
          );
        }
      } else {
        setStatus(
          "Aucun ISBN détecté — OCR indisponible dans ce navigateur, saisie manuelle disponible.",
        );
      }
      bitmap.close();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Échec de lecture — saisie manuelle disponible.",
      );
      setStatus("Échec de lecture — saisie manuelle disponible.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const duplicateParams = new URLSearchParams({ title });
      if (author) duplicateParams.set("author", author);
      if (isbn10) duplicateParams.set("isbn10", isbn10);
      if (isbn13) duplicateParams.set("isbn13", isbn13);
      const existing = await request<{ rows: ProductListRow[] }>(
        `/products/book-duplicates?${duplicateParams}`,
      );
      if (existing.rows.length) {
        setDuplicates(existing.rows);
        setStatus("Produit déjà existant.");
        return;
      }
      const created = await request<ProductListRow>("/products", {
        method: "POST",
        json: {
          categoryId: Number(form.get("categoryId")),
          name: title,
          description: description || null,
          author: author || null,
          isbn10: isbn10 || null,
          isbn13: isbn13 || null,
          publisher: publisher || null,
          publicationYear: form.get("publicationYear")
            ? Number(form.get("publicationYear"))
            : null,
          bookLanguage: form.get("bookLanguage") || null,
          productType: "physical_product",
          inventoryMode: "quantity",
          sku: null,
          manufacturerBarcode: isbn13 || isbn10 || null,
          purchasePriceCents: Math.round(Number(form.get("purchasePrice")) * 100),
          sellingPriceCents: Math.round(Number(form.get("sellingPrice")) * 100),
          wholesalePriceCents: 0,
          wholesaleMinQuantity: 1,
          initialQuantity: Number(form.get("initialQuantity")),
          minimumStock: 0,
          unit: "unité",
          shelfLocation: form.get("shelfLocation") || null,
          trackStock: true,
        },
      });
      navigate(`/products/${created.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page book-assistant" data-scanner-blocking="true">
      <div className="page-header"><div><h1>Ajouter un livre</h1><p>Les informations détectées restent modifiables avant confirmation.</p></div></div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="notice" role="status">{status}</div>
      <section className="section-card assistant-inputs">
        <label>Photo de couverture<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(event) => void analyze(event.target.files?.[0])} /></label>
        {user.permissions.includes("scanner.camera") && <button type="button" className="secondary" onClick={() => setCamera(true)}>Scanner avec la caméra</button>}
        <label>ISBN manuel<input value={isbn13 || isbn10} onChange={(event) => { setIsbn13(event.target.value); setIsbn10(""); }} /></label>
        <button type="button" onClick={() => void applyIsbn(isbn13 || isbn10)}>Vérifier l’ISBN</button>
        {preview && <div className="book-cover-local">
          <img className="book-cover-preview" src={preview} alt="Aperçu local de la couverture" />
          <p>La photo sert uniquement à détecter le nom du livre.<br />Elle ne sera ni enregistrée ni envoyée au serveur.</p>
          <button type="button" className="secondary" onClick={clearTemporaryImage}>Retirer la photo</button>
        </div>}
      </section>
      {camera && <CameraScanner close={() => setCamera(false)} onScan={(code) => { setCamera(false); void applyIsbn(code); }} />}
      {duplicates.length > 0 && <section className="section-card"><h2>Produit déjà existant</h2>{duplicates.map((product) => <p key={product.id}><Link to={`/products/${product.id}`}>{product.name}</Link>{user.permissions.includes("stock.adjust") && <> · <Link to={`/stock/receive?productId=${product.id}`}>Ajouter du stock</Link></>}</p>)}</section>}
      <form className="section-card grid-form" onSubmit={submit}>
        <h2>Informations proposées</h2>
        <label>Titre<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Auteur<input maxLength={300} value={author} onChange={(event) => setAuthor(event.target.value)} /></label>
        <label>ISBN-10<input value={isbn10} onChange={(event) => setIsbn10(event.target.value)} /></label>
        <label>ISBN-13<input value={isbn13} onChange={(event) => setIsbn13(event.target.value)} /></label>
        <label>Éditeur<input maxLength={200} value={publisher} onChange={(event) => setPublisher(event.target.value)} /></label>
        <label>Année<input name="publicationYear" type="number" min="1000" max="2200" /></label>
        <label>Langue<input name="bookLanguage" maxLength={40} /></label>
        <label>Catégorie<select name="categoryId" required defaultValue=""><option value="" disabled>Choisir</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Prix d’achat<input name="purchasePrice" type="number" min="0" step=".01" required /></label>
        <label>Prix de vente<input name="sellingPrice" type="number" min="0" step=".01" required /></label>
        <label>Stock initial<input name="initialQuantity" type="number" min="0" step="1" defaultValue="0" required /></label>
        <label>Rayon<input name="shelfLocation" maxLength={100} /></label>
        <label className="full">Description<textarea maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label className="full"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> J’ai vérifié les informations avant l’enregistrement.</label>
        <div className="actions"><Link className="button secondary" to="/products" onClick={cancelAssistant}>Annuler</Link><button type="submit" disabled={!confirmed || busy || duplicates.length > 0}>{busy ? "Enregistrement…" : "Confirmer et créer"}</button></div>
      </form>
    </main>
  );
}
