import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  CategoryListResponse,
  ProductListRow,
  SafeUser,
} from "@maktaba/shared-types";
import { request } from "./api";
import CameraScanner from "./CameraScanner";
import BookCoverCamera from "./BookCoverCamera";
import BookTitleCrop from "./BookTitleCrop";
import {
  normalizeIsbn,
  validateBookImage,
} from "./book-assistant";
import {
  analyzeBookCover,
  getNativeOcrStatus,
  type BookOcrResult,
  type OcrStatus,
} from "./native-ocr";

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
    [isbnCamera, setIsbnCamera] = useState(false),
    [coverCamera, setCoverCamera] = useState(false),
    [selectedImage, setSelectedImage] = useState<File>(),
    [cropMode, setCropMode] = useState(false),
    [ocrResult, setOcrResult] = useState<BookOcrResult>(),
    [ocrStatus, setOcrStatus] = useState<OcrStatus>(),
    [ocrBusy, setOcrBusy] = useState(false),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    previewRef = useRef(""),
    ocrRunning = useRef(false),
    titleEdited = useRef(false);

  const clearTemporaryImage = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setPreview("");
    setSelectedImage(undefined);
    setCropMode(false);
    setOcrResult(undefined);
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
    void getNativeOcrStatus().then(setOcrStatus);
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
    try {
      const result = await request<{ rows: ProductListRow[] }>(
        `/products/book-duplicates?${params}`,
      );
      setDuplicates(result.rows);
      if (result.rows.length) setStatus("Produit déjà existant.");
    } catch {
      setError(
        "ISBN détecté, mais la vérification des doublons nécessite une connexion.",
      );
    }
  };

  const selectImage = (file?: File) => {
    if (!file) return;
    const validation = validateBookImage(file);
    if (validation) return setError(validation);
    setError("");
    setStatus("Photo prête pour l’analyse locale.");
    const objectUrl = URL.createObjectURL(file);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = objectUrl;
    setPreview(objectUrl);
    setSelectedImage(file);
    setCropMode(false);
    setOcrResult(undefined);
  };

  const analyze = async (image = selectedImage, titleRegion = false) => {
    if (!image || ocrRunning.current) return;
    ocrRunning.current = true;
    setOcrBusy(true);
    setError("");
    setStatus("Préparation de l’image…");
    try {
      setStatus("Lecture du texte…");
      const result = await analyzeBookCover(image, { titleRegion });
      setStatus("Recherche du titre…");
      setOcrResult(result);
      if (result.title && !titleEdited.current) setTitle(result.title);
      if (result.author) setAuthor(result.author);
      if (result.isbn10) setIsbn10(result.isbn10);
      if (result.isbn13) setIsbn13(result.isbn13);
      if (result.isbn10 || result.isbn13)
        await applyIsbn(result.isbn13 ?? result.isbn10!);
      setStatus(
        result.title
          ? "Titre détecté — vérifiez et corrigez le titre."
          : "Le titre n’a pas été détecté avec suffisamment de fiabilité.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "L’analyse locale a échoué. Réessayez avec une photo plus nette.",
      );
      setStatus("Saisie manuelle disponible.");
    } finally {
      ocrRunning.current = false;
      setOcrBusy(false);
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
      clearTemporaryImage();
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
      {ocrStatus?.errorCode === "BROWSER_NOT_NATIVE" && (
        <div className="notice">
          L’analyse locale avancée est disponible dans l’application Windows.
          La saisie manuelle et le scan ISBN restent disponibles.
        </div>
      )}
      {ocrStatus && ocrStatus.errorCode !== "BROWSER_NOT_NATIVE" && !ocrStatus.available && (
        <div className="error" role="alert">
          Le module de lecture locale n’est pas disponible sur cet appareil.
        </div>
      )}
      <section className="section-card assistant-inputs">
        <label>Importer une image<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(event) => selectImage(event.target.files?.[0])} /></label>
        {user.permissions.includes("scanner.camera") && <button type="button" className="secondary" onClick={() => setCoverCamera(true)}>Photographier le livre</button>}
        {user.permissions.includes("scanner.camera") && <button type="button" className="secondary" onClick={() => setIsbnCamera(true)}>Scanner l’ISBN</button>}
        <label>ISBN manuel<input value={isbn13 || isbn10} onChange={(event) => { setIsbn13(event.target.value); setIsbn10(""); }} /></label>
        <button type="button" onClick={() => void applyIsbn(isbn13 || isbn10)}>Vérifier l’ISBN</button>
        {preview && <div className="book-cover-local">
          <img className="book-cover-preview" src={preview} alt="Aperçu local de la couverture" />
          <p>La photo est analysée uniquement sur cet appareil. Elle ne sera ni envoyée ni enregistrée.</p>
          <div className="actions">
            <button type="button" disabled={!ocrStatus?.available || ocrBusy} aria-busy={ocrBusy} onClick={() => void analyze(selectedImage, false)}>
              {ocrBusy ? "Lecture du texte…" : ocrResult ? "Réessayer" : "Analyser la couverture"}
            </button>
            <button type="button" className="secondary" disabled={ocrBusy} onClick={() => setCropMode((value) => !value)}>
              {cropMode ? "Masquer le recadrage" : "Encadrer le titre"}
            </button>
            <button type="button" className="secondary" disabled={ocrBusy} onClick={clearTemporaryImage}>Effacer la photo</button>
          </div>
        </div>}
        {preview && cropMode && (
          <BookTitleCrop
            imageUrl={preview}
            onReset={() => undefined}
            onCrop={(file) => {
              void analyze(file, true);
            }}
          />
        )}
      </section>
      {coverCamera && <BookCoverCamera close={() => setCoverCamera(false)} captured={selectImage} />}
      {isbnCamera && <CameraScanner close={() => setIsbnCamera(false)} onScan={(code) => { setIsbnCamera(false); void applyIsbn(code); }} />}
      {ocrResult && (
        <section className="section-card ocr-suggestions" aria-labelledby="ocr-results-title">
          <h2 id="ocr-results-title">Suggestions détectées</h2>
          <dl>
            <dt>Nom détecté</dt><dd dir="auto">{ocrResult.title ?? "—"}{ocrResult.titleConfidence !== null && ` (${Math.round(ocrResult.titleConfidence)} %)`}</dd>
            <dt>Auteur détecté</dt><dd>{ocrResult.author ?? "—"}</dd>
            <dt>ISBN détecté</dt><dd>{ocrResult.isbn13 ?? ocrResult.isbn10 ?? "—"}</dd>
          </dl>
          {ocrResult.alternatives.length > 0 && <div><h3>Autres noms possibles</h3>{ocrResult.alternatives.map((alternative) => (
            <article className="ocr-candidate" key={`${alternative.language ?? "?"}-${alternative.text}`}>
              <span dir="auto">{alternative.text}</span>
              {alternative.confidence !== null && alternative.confidence < 70 && <small>Résultat incertain</small>}
              <button type="button" className="link" onClick={() => { titleEdited.current = true; setTitle(alternative.text); }}>Utiliser ce titre</button>
            </article>
          ))}</div>}
        </section>
      )}
      {duplicates.length > 0 && <section className="section-card"><h2>Produit déjà existant</h2>{duplicates.map((product) => <p key={product.id}><Link to={`/products/${product.id}`}>{product.name}</Link>{user.permissions.includes("stock.adjust") && <> · <Link to={`/stock/receive?productId=${product.id}`}>Ajouter du stock</Link></>}</p>)}</section>}
      <form className="section-card grid-form" onSubmit={submit}>
        <h2>Informations proposées</h2>
        <label>Titre<input dir="auto" required maxLength={200} value={title} onChange={(event) => { titleEdited.current = true; setTitle(event.target.value); }} /></label>
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
        <div className="actions"><Link className="button secondary" to="/products" onClick={cancelAssistant}>Annuler</Link><button type="submit" disabled={!confirmed || busy || ocrBusy || duplicates.length > 0}>{busy ? "Enregistrement…" : "Confirmer et créer"}</button></div>
      </form>
    </main>
  );
}
