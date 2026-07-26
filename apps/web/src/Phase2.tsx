import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  Category,
  CategoryListResponse,
  ProductDetail,
  ProductListResponse,
  ProductListRow,
  StockListResponse,
  StockMovementListResponse,
  SafeUser,
  RegisterStatus,
  BarcodeResolution,
} from "@maktaba/shared-types";
import { ApiFailure, downloadFile, request } from "./api";
import { centsToMad, madToCents } from "./money";
import { calculateStockAfter } from "./stock-utils";
import { enqueueGlobalScan } from "./global-scanner";
import { useScannerContext } from "./scanner-context";
import { BarcodeInput } from "./BarcodeInput";
import { isAbortError } from "./request-error";
import { applyBarcodePrefill, readBarcodePrefill } from "./product-create-flow";
import { isTauriRuntime, markCachedProductArchived, readQueueAsync, refreshOfflineCache } from "./offline-pos";
const has = (u: SafeUser, p: string) => u.permissions.includes(p);
async function refreshProductCache() {
  if (!isTauriRuntime()) return;
  const register = await request<RegisterStatus>("/register/status");
  await refreshOfflineCache({ isOpen: register.isOpen, sessionId: register.sessionId });
}
function ProductLifecycleActions({ product, user, offline, changed, showDeleteExplanation = false }: { product: ProductListRow; user: SafeUser; offline: boolean; changed: () => void; showDeleteExplanation?: boolean }) {
  const [action, setAction] = useState<"archive" | "restore" | "delete" | null>(null), [typed, setTyped] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const canDelete = has(user, "products.delete_permanently"), deleteEligible = product.canDeletePermanently === true;
  const submit = async () => {
    if (!action || busy) return;
    if (offline) return setError("Cette action nécessite une connexion au serveur.");
    if (action === "delete" && typed !== product.name) return;
    setBusy(true); setError("");
    try {
      if (action === "delete" && isTauriRuntime()) {
        const referenced = (await readQueueAsync()).some((record) => record.status !== "synced" && record.payload.items.some((item) => item.productId === product.id));
        if (referenced) throw new Error("Ce produit est référencé par une opération hors ligne et ne peut pas être supprimé.");
      }
      await request(`/products/${product.id}${action === "delete" ? "" : `/${action}`}`, { method: action === "delete" ? "DELETE" : "POST" });
      if (action === "archive") await markCachedProductArchived(product.id);
      if (action !== "delete") await refreshProductCache().catch(() => undefined);
      setAction(null); setTyped(""); changed();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Action impossible."); }
    finally { setBusy(false); }
  };
  return <>
    {product.isActive && has(user, "products.archive") && <button className="link danger-text" type="button" onClick={() => setAction("archive")}>Archiver</button>}
    {!product.isActive && has(user, "products.restore") && <button className="link" type="button" onClick={() => setAction("restore")}>Restaurer</button>}
    {canDelete && deleteEligible && <button className="link danger-text" type="button" onClick={() => setAction("delete")}>Supprimer définitivement</button>}
    {canDelete && !deleteEligible && showDeleteExplanation && <p className="action-explanation">Ce produit possède un historique et ne peut pas être supprimé. Archivez-le à la place.</p>}
    {action && <div className="scanner-unknown" role="dialog" aria-modal="true" aria-labelledby="product-action-title"><div className="section-card">
      <h2 id="product-action-title">{action === "archive" ? "Archiver ce produit ?" : action === "restore" ? "Restaurer le produit ?" : "Supprimer définitivement ce produit ?"}</h2>
      <p>{action === "archive" ? "Le produit ne sera plus disponible à la vente, mais son historique sera conservé." : action === "restore" ? "Le produit redeviendra disponible à la vente." : "Cette action est irréversible."}</p>
      {action === "delete" && <label>Saisissez exactement <strong>{product.name}</strong><input value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus /></label>}
      <ErrorBox value={error} />
      <div className="form-actions"><button type="button" className="secondary" onClick={() => { if (!busy) { setAction(null); setTyped(""); } }}>Annuler</button><button type="button" className={action === "delete" ? "danger" : ""} disabled={busy || action === "delete" && typed !== product.name} onClick={() => void submit()}>{busy ? action === "archive" ? "Archivage…" : action === "restore" ? "Restauration…" : "Suppression…" : action === "archive" ? "Archiver" : action === "restore" ? "Restaurer" : "Supprimer définitivement"}</button></div>
    </div></div>}
  </>;
}
function ProductActionsMenu({ product, user, changed }: { product: ProductListRow; user: SafeUser; changed: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <div className="action-menu">
      <button type="button" className="secondary action-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Actions
      </button>
      {open && (
        <div className="action-menu-panel" role="menu">
          <Link role="menuitem" to={`/products/${product.id}`} onClick={() => setOpen(false)}>Voir</Link>
          {product.isActive && has(user, "products.edit") && <Link role="menuitem" to={`/products/${product.id}/edit`} onClick={() => setOpen(false)}>Modifier</Link>}
          {product.isActive && has(user, "labels.print") && <Link role="menuitem" to={`/products/${product.id}/label`} onClick={() => setOpen(false)}>Imprimer l'étiquette</Link>}
          {product.isActive && product.trackStock && product.inventoryMode === "quantity" && has(user, "stock.adjust") && <Link role="menuitem" to={`/stock/adjust?productId=${product.id}`} onClick={() => setOpen(false)}>Ajuster le stock</Link>}
          <ProductLifecycleActions product={product} user={user} offline={false} changed={() => { setOpen(false); changed(); }} showDeleteExplanation />
        </div>
      )}
    </div>
  );
}
function useDebounced(value: string, ms = 300) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setResult(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return result;
}
function ErrorBox({ value }: { value: string }) {
  return value ? (
    <div className="error" role="alert">
      {value}
    </div>
  ) : null;
}
function Pager({
  page,
  total,
  set,
}: {
  page: number;
  total: number;
  set: (n: number) => void;
}) {
  return (
    <div className="pager">
      <button disabled={page <= 1} onClick={() => set(page - 1)}>
        Précédent
      </button>
      <span>
        Page {page} / {Math.max(total, 1)}
      </span>
      <button disabled={page >= total} onClick={() => set(page + 1)}>
        Suivant
      </button>
    </div>
  );
}
function DedicatedScanner({ onScan }: { onScan: (code: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="scanner"
      onSubmit={(e) => {
        e.preventDefault();
        const code = value.trim();
        if (code) onScan(code);
        setValue("");
      }}
    >
      <label>
        Scanner ou saisir un identifiant
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Code-barres, QR ou SKU"
        />
      </label>
      <button>Rechercher</button>
    </form>
  );
}
export function CategoriesPage({ user }: { user: SafeUser }) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [data, setData] = useState<CategoryListResponse>(),
    [error, setError] = useState(""),
    query = useDebounced(search);
  useEffect(() => {
    const c = new AbortController();
    let active = true;
    request<CategoryListResponse>(
      `/categories?${new URLSearchParams({ search: query, status, page: String(page) })}`,
      { signal: c.signal },
    )
      .then((result) => {
        if (!active) return;
        setData(result);
        setError("");
      })
      .catch((e: unknown) => {
        if (active && !isAbortError(e))
          setError(e instanceof Error ? e.message : "Erreur");
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [query, status, page, refresh]);
  const toggle = async (x: Category) => {
    if (!x.isActive && !confirm("Réactiver cette catégorie ?")) return;
    if (
      x.isActive &&
      !confirm(
        "Désactiver cette catégorie ? Les catégories avec des produits actifs sont protégées.",
      )
    )
      return;
    try {
      await request(
        `/categories/${x.id}/${x.isActive ? "deactivate" : "activate"}`,
        { method: "POST" },
      );
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  };
  return (
    <main className="page">
      <div className="title">
        <h1>Catégories</h1>
        {has(user, "categories.manage") && (
          <Link className="button" to="/categories/new">
            Nouvelle catégorie
          </Link>
        )}
      </div>
      <ErrorBox value={error} />
      <div className="filters">
        <input
          aria-label="Recherche"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Rechercher"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">Tous les états</option>
          <option value="active">Actives</option>
          <option value="inactive">Inactives</option>
        </select>
      </div>
      {!data ? (
        <p>Chargement…</p>
      ) : !data.rows.length ? (
        <p className="empty">Aucune catégorie.</p>
      ) : (
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Description</th>
                <th>Produits</th>
                <th>État</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td>{x.description || "—"}</td>
                  <td>{x.productCount ?? 0}</td>
                  <td>
                    <span className={`badge ${x.isActive ? "ok" : "off"}`}>
                      {x.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    {has(user, "categories.manage") && (
                      <>
                        <Link to={`/categories/${x.id}/edit`}>Modifier</Link>{" "}
                        <button className="link" onClick={() => void toggle(x)}>
                          {x.isActive ? "Désactiver" : "Activer"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={data?.totalPages ?? 1} set={setPage} />
    </main>
  );
}
export function CategoryForm({ edit = false }: { edit?: boolean }) {
  const { id } = useParams(),
    nav = useNavigate(),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (edit)
      request<Category>(`/categories/${id}`)
        .then((x) => {
          setName(x.name);
          setDescription(x.description ?? "");
        })
        .catch((e) => setError(e.message));
  }, [edit, id]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("Le nom est obligatoire.");
    setBusy(true);
    try {
      await request(edit ? `/categories/${id}` : "/categories", {
        method: edit ? "PATCH" : "POST",
        json: { name, description },
      });
      nav("/categories");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="page narrow">
      <h1>{edit ? "Modifier la catégorie" : "Nouvelle catégorie"}</h1>
      <ErrorBox value={error} />
      <form onSubmit={submit}>
        <label>
          Nom
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="actions">
          <button disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => nav("/categories")}
          >
            Annuler
          </button>
        </div>
      </form>
    </main>
  );
}
export function ProductsPage({
  user,
  nativeBookAssistantAvailable = false,
}: {
  user: SafeUser;
  nativeBookAssistantAvailable?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [type, setType] = useState(""),
    [categoryId, setCategoryId] = useState(""),
    [categoryOptions, setCategoryOptions] = useState<Category[]>([]),
    [status, setStatus] = useState("active"),
    [low, setLow] = useState(false),
    [out, setOut] = useState(false),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [data, setData] = useState<ProductListResponse>(),
    [found, setFound] = useState<ProductListRow>(),
    [error, setError] = useState(""),
    [exporting, setExporting] = useState(false),
    query = useDebounced(search),
    load = () => {
      const c = new AbortController(),
        params = new URLSearchParams({
          search: query,
          status,
          page: String(page),
        });
      let active = true;
      if (type) params.set("productType", type);
      if (categoryId) params.set("categoryId", categoryId);
      if (low) params.set("lowStockOnly", "true");
      if (out) params.set("outOfStockOnly", "true");
      request<ProductListResponse>(`/products?${params}`, { signal: c.signal })
        .then((result) => {
          if (!active) return;
          setData(result);
          setError("");
        })
        .catch((e: unknown) => {
          if (active && !isAbortError(e))
            setError(e instanceof Error ? e.message : "Erreur");
        });
      return () => {
        active = false;
        c.abort();
      };
    };
  useEffect(load, [query, type, categoryId, status, low, out, page, refresh]);
  useEffect(() => {
    void request<CategoryListResponse>(
      "/categories?pageSize=100&status=active",
    ).then((x) => setCategoryOptions(x.rows));
  }, []);
  const lookup = async (code: string) => {
    try {
      setFound(
        (
          await request<BarcodeResolution>(
            `/products/resolve-barcode?code=${encodeURIComponent(code)}`,
          )
        ).product,
      );
      setError("");
    } catch (e) {
      setFound(undefined);
      setError(e instanceof Error ? e.message : "Produit introuvable.");
    }
  };
  useScannerContext("products-page", "page", ({ code }) => lookup(code));
  const exportSerializedUnits = async () => {
    if (exporting) return;
    setExporting(true);
    setError("");
    try {
      await downloadFile(
        "/serialized-units/export.csv",
        "double-library-unites-serialisees.csv",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Impossible d’exporter les unités.",
      );
    } finally {
      setExporting(false);
    }
  };
  return (
    <main className="page">
      <div className="title">
        <h1>Produits et services</h1>
        {has(user, "products.create") && (
          <Link className="button" to="/products/new">
            Nouveau produit
          </Link>
        )}
        {nativeBookAssistantAvailable &&
          has(user, "products.use_book_assistant") && (
          <Link className="button secondary" to="/products/new/book-assistant">
            Ajouter un livre
          </Link>
        )}
        {has(user, "serialized_units.export") && (
          <button
            type="button"
            className="secondary"
            disabled={exporting}
            aria-busy={exporting}
            onClick={() => void exportSerializedUnits()}
          >
            {exporting ? "Export en cours…" : "Exporter les unités CSV"}
          </button>
        )}
      </div>
      <ErrorBox value={error} />
      <DedicatedScanner onScan={lookup} />
      {found && (
        <div className="notice">
          <b>{found.name}</b> — {found.internalBarcode}{" "}
          <Link to={`/products/${found.id}`}>Voir</Link>
        </div>
      )}
      <div className="filters">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Nom, SKU, code ou rayon"
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Tous les types</option>
          <option value="physical_product">Produits</option>
          <option value="service">Services</option>
        </select>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Toutes les catégories</option>
          {categoryOptions.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Tous les états</option>
          <option value="active">Actifs</option>
          <option value="inactive">Archivés</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={low}
            onChange={(e) => setLow(e.target.checked)}
          />{" "}
          Stock bas
        </label>
        <label>
          <input
            type="checkbox"
            checked={out}
            onChange={(e) => setOut(e.target.checked)}
          />{" "}
          Rupture
        </label>
        <button
          className="secondary"
          onClick={() => {
            setSearch("");
            setType("");
            setCategoryId("");
            setStatus("active");
            setLow(false);
            setOut(false);
          }}
        >
          Réinitialiser
        </button>
      </div>
      {!data ? (
        <p>Chargement…</p>
      ) : !data.rows.length ? (
        <p className="empty">Aucun produit.</p>
      ) : (
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>Produit</th>
                <th>Catégorie</th>
                <th>Type</th>
                <th>SKU / Interne</th>
                <th>Prix</th>
                <th>Stock</th>
                <th>État</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td>{x.categoryName}</td>
                  <td>{x.productType === "service" ? "Service" : "Produit"}</td>
                  <td>
                    {x.sku || "—"}
                    <small>{x.internalBarcode}</small>
                  </td>
                  <td>{centsToMad(x.sellingPriceCents)}</td>
                  <td>
                    {x.trackStock ? (
                      <>
                        {x.currentStock} / min. {x.minimumStock}
                        {x.isOutOfStock && (
                          <span className="badge danger">Rupture</span>
                        )}
                        {!x.isOutOfStock && x.isLowStock && (
                          <span className="badge warn">Bas</span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{x.isActive ? "Actif" : <span className="badge off">Archivé</span>}</td>
                  <td>
                    <ProductActionsMenu product={x} user={user} changed={() => setRefresh((value) => value + 1)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={data?.totalPages ?? 1} set={setPage} />
    </main>
  );
}
type ProductFormState = {
  categoryId: string;
  name: string;
  description: string;
  productType: "physical_product" | "service";
  inventoryMode: "quantity" | "serialized";
  sku: string;
  manufacturerBarcode: string;
  purchasePrice: string;
  sellingPrice: string;
  initialQuantity: string;
  wholesalePrice: string;
  wholesaleMinQuantity: string;
  minimumStock: string;
  unit: string;
  shelfLocation: string;
  trackStock: boolean;
};
const initial: ProductFormState = {
  categoryId: "",
  name: "",
  description: "",
  productType: "physical_product",
  inventoryMode: "quantity",
  sku: "",
  manufacturerBarcode: "",
  purchasePrice: "0",
  sellingPrice: "0",
  initialQuantity: "0",
  wholesalePrice: "0",
  wholesaleMinQuantity: "1",
  minimumStock: "0",
  unit: "unité",
  shelfLocation: "",
  trackStock: true,
};
export function ProductForm({ edit = false, user, offline = false }: { edit?: boolean; user: SafeUser; offline?: boolean }) {
  const { id } = useParams(),
    nav = useNavigate(),
    [searchParams, setSearchParams] = useSearchParams(),
    prefill = readBarcodePrefill(searchParams, edit),
    [form, setForm] = useState(() => ({
      ...initial,
      manufacturerBarcode: applyBarcodePrefill(initial.manufacturerBarcode, prefill.barcode, false),
    })),
    [categories, setCategories] = useState<Category[]>([]),
    [busy, setBusy] = useState(false),
    [generating, setGenerating] = useState(false),
    [error, setError] = useState(prefill.error),
    [created, setCreated] = useState<ProductDetail>(),
    barcodeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    request<CategoryListResponse>(
      "/categories?pageSize=100&status=active",
    ).then((x) => setCategories(x.rows));
    if (edit)
      request<ProductDetail>(`/products/${id}`)
        .then((x) =>
          setForm({
            categoryId: String(x.categoryId ?? ""),
            name: x.name,
            description: x.description ?? "",
            productType: x.productType,
            inventoryMode: x.inventoryMode ?? "quantity",
            sku: x.sku ?? "",
            manufacturerBarcode: x.manufacturerBarcode ?? "",
            purchasePrice:
              x.purchasePriceCents === undefined
                ? "0"
                : String(x.purchasePriceCents / 100),
            sellingPrice: String(x.sellingPriceCents / 100),
            initialQuantity: "0",
            wholesalePrice: String(x.wholesalePriceCents / 100),
            wholesaleMinQuantity: String(x.wholesaleMinQuantity),
            minimumStock: String(x.minimumStock),
            unit: x.unit,
            shelfLocation: x.shelfLocation ?? "",
            trackStock: x.trackStock,
          }),
        )
        .catch((e) => setError(e.message));
  }, [edit, id]);
  const set = <K extends keyof ProductFormState>(
    k: K,
    v: ProductFormState[K],
  ) => setForm((x) => ({ ...x, [k]: v }));
  const generateBarcode = async () => {
    if (offline || !navigator.onLine || form.productType === "service" || generating) {
      setError("La génération d’un code-barres nécessite une connexion au serveur.");
      return;
    }
    try {
      setGenerating(true);
      setError("");
      const result = await request<{ barcode: string }>("/products/barcodes/generate", {
        method: "POST",
      });
      set("manufacturerBarcode", result.barcode);
      barcodeInput.current?.focus();
    } catch (e) {
      setError(
        navigator.onLine
          ? e instanceof Error ? e.message : "Impossible de générer le code-barres."
          : "La génération d’un code-barres nécessite une connexion au serveur.",
      );
    } finally {
      setGenerating(false);
    }
  };
  const validateScannedBarcode = async (code: string) => {
    if (offline) return;
    try {
      const match = await request<BarcodeResolution>(
        `/products/resolve-barcode?code=${encodeURIComponent(code)}`,
      );
      setError(
        edit && match.product.id === Number(id)
          ? ""
          : "Ce code-barres est déjà utilisé par un autre produit.",
      );
    } catch (reason) {
      if (reason instanceof ApiFailure && reason.status === 404) setError("");
      else setError(reason instanceof Error ? reason.message : "Impossible de vérifier ce code-barres.");
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    try {
      const body = {
        categoryId: Number(form.categoryId),
        name: form.name,
        description: form.description,
        productType: form.productType,
        inventoryMode: form.productType === "service" ? "quantity" : form.inventoryMode,
        sku: form.sku,
        manufacturerBarcode: form.manufacturerBarcode,
        purchasePriceCents: madToCents(form.purchasePrice),
        sellingPriceCents: madToCents(form.sellingPrice),
        initialQuantity:
          !edit && form.productType === "physical_product" && form.inventoryMode === "quantity"
            ? Number(form.initialQuantity)
            : 0,
        wholesalePriceCents: madToCents(form.wholesalePrice),
        wholesaleMinQuantity: Number(form.wholesaleMinQuantity),
        minimumStock: Number(form.minimumStock),
        unit: form.unit,
        shelfLocation: form.shelfLocation,
        trackStock: form.productType === "service" ? false : form.trackStock,
      };
      setBusy(true);
      if (edit) {
        await request(`/products/${id}`, { method: "PATCH", json: body });
        nav("/products");
      } else {
        const product = await request<ProductDetail>("/products", { method: "POST", json: body });
        setCreated(product);
        setSearchParams({}, { replace: true });
        nav(`/products/${product.id}`, { replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="page narrow">
      <h1>{edit ? "Modifier" : "Nouveau produit ou service"}</h1>
      <ErrorBox value={error} />
      {created && (
        <section className="notice" role="status">
          <p><b>Produit créé avec succès.</b></p>
          <p>Stock initial : {created.currentStock} unité(s).</p>
          {created.currentStock > 0 && created.manufacturerBarcode ? (
            <button type="button" onClick={() => {
              enqueueGlobalScan(created.manufacturerBarcode!, "usb");
              nav("/pos", { replace: true });
            }}>Retour au point de vente et ajouter</button>
          ) : <p>Produit créé, mais aucun stock n’est disponible.</p>}
          <button type="button" className="secondary" onClick={() => {
            setCreated(undefined);
            setForm({ ...initial });
          }}>Créer un autre produit</button>
          <button type="button" className="secondary" onClick={() => nav(`/products/${created.id}`)}>Voir le produit</button>
          <button type="button" className="secondary" onClick={() => nav(`/products/${created.id}/label`)}>Imprimer l’étiquette</button>
        </section>
      )}
      {!created && <form onSubmit={submit} className="product-form grid-form">
        <h2 className="form-section-title">Informations principales</h2>
        <label>
          Catégorie
          <select
            value={form.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
            required
          >
            <option value="">Choisir</option>
            {categories.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nom
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            required
          />
        </label>
        <label>
          Type
          <select
            value={form.productType}
            onChange={(e) =>
              set(
                "productType",
                e.target.value as ProductFormState["productType"],
              )
            }
          >
            <option value="physical_product">Produit physique</option>
            <option value="service">Service</option>
          </select>
        </label>
        <label>
          Description
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </label>
        {form.productType === "physical_product" && (
          <details className="advanced-options">
            <summary>Options avancées</summary>
          <label>
            Suivi du stock
            <select
              value={form.inventoryMode}
              onChange={(e) => set("inventoryMode", e.target.value as ProductFormState["inventoryMode"])}
              disabled={edit}
            >
              <option value="quantity">Quantité normale (même code-barres)</option>
              <option value="serialized">Chaque unité a un code unique</option>
            </select>
            <small>Utiliser uniquement lorsque chaque unité possède un code-barres unique.</small>
            {edit && <small>Le mode de stock ne peut pas être modifié depuis cette fiche.</small>}
          </label>
          </details>
        )}
        <label>
          SKU
          <input
            value={form.sku}
            onChange={(e) => set("sku", e.target.value)}
          />
        </label>
        <h2 className="form-section-title">Code-barres</h2>
        <div className="barcode-field form-section-card">
          <BarcodeInput
            inputRef={barcodeInput}
            mode="capture"
            value={form.manufacturerBarcode}
            onChange={(value) => set("manufacturerBarcode", value)}
            onScan={validateScannedBarcode}
          />
          <span className="inline-actions">
            <button type="button" className="secondary barcode-generate-action" disabled={generating || busy || offline || form.productType === "service"} onClick={generateBarcode}>{generating ? "Génération…" : "Générer"}</button>
            {user.permissions.includes("labels.print") && <button type="button" className="secondary barcode-print-action" disabled={!edit || !id || !form.name.trim()} onClick={() => id && nav(`/products/${id}/label`)}>Imprimer l’étiquette</button>}
          </span>
          {!edit && user.permissions.includes("labels.print") && <small>Enregistrez d’abord le produit pour imprimer l’étiquette.</small>}
          {offline && <small className="field-error">La génération d’un code-barres nécessite une connexion au serveur.</small>}
          <small>Scannez le code existant ou générez un code-barres interne.</small>
        </div>
        <h2 className="form-section-title">Tarification</h2>
        <label>
          Prix d'achat MAD
          <input
            inputMode="decimal"
            value={form.purchasePrice}
            onChange={(e) => set("purchasePrice", e.target.value)}
          />
        </label>
        <label>
          Prix de vente MAD
          <input
            inputMode="decimal"
            value={form.sellingPrice}
            onChange={(e) => set("sellingPrice", e.target.value)}
            required
          />
        </label>
        <h2 className="form-section-title">Stock</h2>
        {!edit && form.productType === "physical_product" && form.inventoryMode === "quantity" && form.trackStock && (
          <label>
            Quantité initiale
            <input
              type="number"
              min="0"
              max="100000"
              step="1"
              value={form.initialQuantity}
              onChange={(e) => set("initialQuantity", e.target.value)}
            />
          </label>
        )}
        <label>
          Prix de gros MAD
          <input
            inputMode="decimal"
            value={form.wholesalePrice}
            onChange={(e) => set("wholesalePrice", e.target.value)}
          />
        </label>
        <label>
          Quantité min. gros
          <input
            type="number"
            min="0"
            value={form.wholesaleMinQuantity}
            onChange={(e) => set("wholesaleMinQuantity", e.target.value)}
          />
        </label>
        {form.productType === "physical_product" && (
          <>
            <label>
              Stock minimum
              <input
                type="number"
                min="0"
                value={form.minimumStock}
                onChange={(e) => set("minimumStock", e.target.value)}
              />
            </label>
            <label className="stock-toggle">
              <input
                type="checkbox"
                checked={form.trackStock}
                onChange={(e) => set("trackStock", e.target.checked)}
              />{" "}
              Suivre le stock
            </label>
          </>
        )}
        <label>
          Unité
          <input
            value={form.unit}
            onChange={(e) => set("unit", e.target.value)}
            required
          />
        </label>
        <label>
          Emplacement
          <input
            value={form.shelfLocation}
            onChange={(e) => set("shelfLocation", e.target.value)}
          />
        </label>
        <div className="actions product-form-actions">
          <button disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => nav("/products")}
          >
            Annuler
          </button>
          <button className="product-save-action" disabled={busy || generating}>
            {busy ? "Enregistrement…" : edit ? "Enregistrer les modifications" : "Enregistrer le produit"}
          </button>
        </div>
      </form>}
    </main>
  );
}
export function ProductDetails({ user, offline = false }: { user: SafeUser; offline?: boolean }) {
  const { id } = useParams(),
    [x, setX] = useState<ProductDetail>(),
    [moves, setMoves] = useState<StockMovementListResponse>(),
    [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    request<ProductDetail>(`/products/${id}`, {
      signal: controller.signal,
    })
      .then((product) => {
        if (!active) return;
        setX(product);
        setError("");
      })
      .catch((reason) => {
        if (active && !isAbortError(reason)) {
          setError(
            reason instanceof Error ? reason.message : "Produit introuvable.",
          );
        }
      });

    if (has(user, "stock.view")) {
      request<StockMovementListResponse>(
        `/stock/movements?productId=${id}&pageSize=10`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (active) setMoves(result);
        })
        .catch((reason) => {
          if (active && !isAbortError(reason)) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Impossible de charger les mouvements de stock.",
            );
          }
        });
    } else {
      setMoves(undefined);
    }

    return () => {
      active = false;
      controller.abort();
    };
  }, [id, user, refresh]);
  if (error)
    return (
      <main className="page">
        <ErrorBox value={error} />
      </main>
    );
  if (!x) return <main className="page">Chargement…</main>;
  return (
    <main className="page">
      <div className="title">
        <h1>{x.name}</h1>
      </div>
      <section className="section-card product-detail-actions" aria-labelledby="product-detail-actions-title">
        <h2 id="product-detail-actions-title">Actions</h2>
        <div className="actions">
          {x.isActive && !offline && has(user, "products.edit") && (
            <Link className="button" to={`/products/${x.id}/edit`}>
              Modifier
            </Link>
          )}
          {x.isActive && !offline && has(user, "labels.print") && (
            <Link className="button secondary" to={`/products/${x.id}/label`}>
              Imprimer l'étiquette
            </Link>
          )}
          {x.isActive && !offline && x.trackStock && x.inventoryMode === "quantity" && has(user, "stock.adjust") && (
            <Link className="button secondary" to={`/stock/adjust?productId=${x.id}`}>
              Ajuster le stock
            </Link>
          )}
          {x.isActive && !offline && x.inventoryMode === "serialized" && has(user, "serialized_units.receive") && (
            <Link className="button secondary" to={`/serialized-receiving/new?productId=${x.id}`}>
              Réceptionner des unités
            </Link>
          )}
          <ProductLifecycleActions product={x} user={user} offline={offline} changed={() => setRefresh((value) => value + 1)} showDeleteExplanation />
        </div>
      </section>
      <dl className="details">
        {x.author && <><dt>Auteur</dt><dd>{x.author}</dd></>}
        {x.isbn10 && <><dt>ISBN-10</dt><dd>{x.isbn10}</dd></>}
        {x.isbn13 && <><dt>ISBN-13</dt><dd>{x.isbn13}</dd></>}
        {x.publisher && <><dt>Éditeur</dt><dd>{x.publisher}</dd></>}
        {x.publicationYear && <><dt>Année de publication</dt><dd>{x.publicationYear}</dd></>}
        {x.bookLanguage && <><dt>Langue</dt><dd>{x.bookLanguage}</dd></>}
        <dt>Catégorie</dt>
        <dd>{x.categoryName}</dd>
        <dt>Type</dt>
        <dd>{x.productType === "service" ? "Service" : "Produit physique"}</dd>
        <dt>Mode de stock</dt>
        <dd>{x.inventoryMode === "serialized" ? "Suivi par unité" : "Quantité"}</dd>
        <dt>SKU</dt>
        <dd>{x.sku || "—"}</dd>
        <dt>Code interne</dt>
        <dd>{x.internalBarcode}</dd>
        <dt>Identifiant QR</dt>
        <dd>{x.qrIdentifier}</dd>
        <dt>Code fabricant</dt>
        <dd>{x.manufacturerBarcode || "—"}</dd>
        <dt>Prix de vente</dt>
        <dd>{centsToMad(x.sellingPriceCents)}</dd>
        <dt>Prix de gros</dt>
        <dd>
          {centsToMad(x.wholesalePriceCents)} à partir de{" "}
          {x.wholesaleMinQuantity}
        </dd>
        {x.purchasePriceCents !== undefined && (
          <>
            <dt>Prix d'achat</dt>
            <dd>{centsToMad(x.purchasePriceCents)}</dd>
          </>
        )}
        <dt>Stock</dt>
        <dd>
          {x.trackStock
            ? `${x.currentStock} (minimum ${x.minimumStock})`
            : "Non suivi"}
        </dd>
        <dt>Emplacement</dt>
        <dd>{x.shelfLocation || "—"}</dd>
        <dt>État</dt>
        <dd>{x.isActive ? "Actif" : <span className="badge off">Archivé</span>}</dd>
        <dt>Créé le</dt>
        <dd>{new Date(x.createdAt).toLocaleString("fr-MA")}</dd>
        <dt>Mis à jour le</dt>
        <dd>{new Date(x.updatedAt).toLocaleString("fr-MA")}</dd>
      </dl>
      {moves && (
        <>
          <h2>Mouvements récents</h2>
          <MovementTable data={moves} />
        </>
      )}
    </main>
  );
}
export function StockPage({ user }: { user: SafeUser }) {
  const [search, setSearch] = useState(""),
    [categoryId, setCategoryId] = useState(""),
    [categoryOptions, setCategoryOptions] = useState<Category[]>([]),
    [status, setStatus] = useState("all"),
    [low, setLow] = useState(false),
    [out, setOut] = useState(false),
    [page, setPage] = useState(1),
    [data, setData] = useState<StockListResponse>(),
    [scannedProduct, setScannedProduct] = useState<ProductListRow>(),
    [error, setError] = useState(""),
    query = useDebounced(search);
  useScannerContext("stock-page", "page", async ({ code }) => {
    try {
      const result = await request<BarcodeResolution>(
        `/products/resolve-barcode?code=${encodeURIComponent(code)}`,
      );
      setScannedProduct(result.product);
      setSearch(result.product.name);
      setPage(1);
      setError("");
    } catch (reason) {
      setScannedProduct(undefined);
      setError(
        reason instanceof ApiFailure && reason.status === 404
          ? "Aucun produit ne correspond au code-barres scanné."
          : reason instanceof Error ? reason.message : "Code-barres inconnu.",
      );
    }
  });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    request<CategoryListResponse>("/categories?pageSize=100&status=active", {
      signal: controller.signal,
    })
      .then((value) => {
        if (active) setCategoryOptions(value.rows);
      })
      .catch((reason: unknown) => {
        if (active && !isAbortError(reason))
          setError(reason instanceof Error ? reason.message : "Erreur");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);
  useEffect(() => {
    const c = new AbortController(),
      p = new URLSearchParams({
        search: query,
        page: String(page),
        status,
        lowStockOnly: String(low),
        outOfStockOnly: String(out),
      });
    let active = true;
    if (categoryId) p.set("categoryId", categoryId);
    request<StockListResponse>(`/stock?${p}`, { signal: c.signal })
      .then((result) => {
        if (!active) return;
        setData(result);
        setError("");
      })
      .catch((reason: unknown) => {
        if (active && !isAbortError(reason))
          setError(reason instanceof Error ? reason.message : "Erreur");
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [query, categoryId, status, low, out, page]);
  return (
    <main className="page">
      <div className="title">
        <h1>Stock</h1>
        <div>
          {has(user, "stock.adjust") && (
            <><Link className="button" to="/stock/receive">Réception de stock</Link>{" "}<Link className="button secondary" to="/stock/adjust">Ajuster</Link></>
          )}{" "}
          <Link className="button secondary" to="/stock/movements">
            Mouvements
          </Link>
        </div>
      </div>
      <ErrorBox value={error} />
      {scannedProduct && <div className="notice" role="status" aria-live="polite">
        Produit trouvé : <strong>{scannedProduct.name}</strong> · Stock {scannedProduct.currentStock}
        {" "}· Seuil {scannedProduct.minimumStock}
        {scannedProduct.inventoryMode === "serialized" && " · Suivi par unité"}
      </div>}
      <div className="filters">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Produit, SKU ou code"
        />
        <select
          aria-label="Catégorie"
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Toutes les catégories</option>
          {categoryOptions.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          aria-label="État"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">Tous les états</option>
          <option value="active">Actifs</option>
          <option value="inactive">Inactifs</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={low}
            onChange={(e) => {
              setLow(e.target.checked);
              setPage(1);
            }}
          />{" "}
          Stock bas
        </label>
        <label>
          <input
            type="checkbox"
            checked={out}
            onChange={(e) => {
              setOut(e.target.checked);
              setPage(1);
            }}
          />{" "}
          Rupture
        </label>
        <button
          className="secondary"
          onClick={() => {
            setSearch("");
            setCategoryId("");
            setStatus("all");
            setLow(false);
            setOut(false);
            setPage(1);
          }}
        >
          Réinitialiser
        </button>
      </div>
      {!data ? (
        <p>Chargement…</p>
      ) : !data.rows.length ? (
        <p className="empty">Aucun produit en stock.</p>
      ) : (
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>Produit</th>
                <th>Catégorie</th>
                <th>SKU</th>
                <th>Code interne</th>
                <th>Stock</th>
                <th>Minimum</th>
                <th>Valeur</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((x) => (
                <tr key={x.id} className={scannedProduct?.id === x.id ? "scanner-match" : undefined}>
                  <td>{x.name}</td>
                  <td>{x.categoryName}</td>
                  <td>{x.sku || "—"}</td>
                  <td>{x.internalBarcode}</td>
                  <td>
                    {x.currentStock}
                    {x.isOutOfStock && (
                      <span className="badge danger">Rupture</span>
                    )}
                    {!x.isOutOfStock && x.isLowStock && (
                      <span className="badge warn">Bas</span>
                    )}
                  </td>
                  <td>{x.minimumStock}</td>
                  <td>
                    {x.stockValueCents === undefined
                      ? "—"
                      : centsToMad(x.stockValueCents)}
                  </td>
                  <td>
                    {has(user, "stock.adjust") && (
                      <Link to={`/stock/adjust?productId=${x.id}`}>
                        Ajuster
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={data?.totalPages ?? 1} set={setPage} />
    </main>
  );
}
export function StockAdjust() {
  const nav = useNavigate(),
    [searchParams] = useSearchParams(),
    [product, setProduct] = useState<ProductListRow>(),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<ProductListRow[]>([]),
    [type, setType] = useState("stock_in"),
    [direction, setDirection] = useState("increase"),
    [quantity, setQuantity] = useState(1),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    debounced = useDebounced(query);
  useEffect(() => {
    const id = searchParams.get("productId");
    if (id)
      void request<ProductDetail>(`/products/${id}`)
        .then(setProduct)
        .catch((e) => setError(e.message));
  }, [searchParams]);
  useEffect(() => {
    if (!debounced) return setResults([]);
    const c = new AbortController();
    request<ProductListResponse>(
      `/products?search=${encodeURIComponent(debounced)}&productType=physical_product&pageSize=10`,
      { signal: c.signal },
    ).then((x) => setResults(x.rows));
    return () => c.abort();
  }, [debounced]);
  const lookup = async (code: string) => {
    try {
      setProduct(
        (
          await request<BarcodeResolution>(
            `/products/resolve-barcode?code=${encodeURIComponent(code)}`,
          )
        ).product,
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Produit introuvable.");
    }
  };
  useScannerContext("stock-adjust-page", "page", async ({ code }) => {
    const resolved = await request<BarcodeResolution>(
      `/products/resolve-barcode?code=${encodeURIComponent(code)}`,
    );
    if (
      type === "inventory_adjustment" &&
      product?.id === resolved.product.id &&
      resolved.matchType !== "serialized_unit"
    ) {
      setQuantity((value) => value + 1);
      setError("");
      return;
    }
    setProduct(resolved.product);
    setQuantity(1);
    setError("");
  });
  const increase =
      ["opening_stock", "stock_in"].includes(type) ||
      (["manual_adjustment", "inventory_adjustment"].includes(type) &&
        direction === "increase"),
    preview = product
      ? calculateStockAfter(product.currentStock, quantity, increase)
      : 0,
    submit = async (e: FormEvent) => {
      e.preventDefault();
      if (busy || !product) return;
      setBusy(true);
      try {
        await request("/stock/adjustments", {
          method: "POST",
          json: {
            productId: product.id,
            movementType: type,
            quantity,
            direction: ["manual_adjustment", "inventory_adjustment"].includes(
              type,
            )
              ? direction
              : undefined,
            reason,
            idempotencyKey: crypto.randomUUID(),
          },
        });
        nav("/stock/movements", {
          state: { success: "Ajustement de stock enregistré." },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur");
      } finally {
        setBusy(false);
      }
    };
  return (
    <main className="page narrow">
      <h1>Ajustement de stock</h1>
      <ErrorBox value={error} />
      <DedicatedScanner onScan={lookup} />
      <label>
        Recherche manuelle
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {results.map((x) => (
        <button className="result" key={x.id} onClick={() => setProduct(x)}>
          {x.name} — stock {x.currentStock}
        </button>
      ))}
      {product && (
        <form onSubmit={submit}>
          <div className="notice">
            <b>{product.name}</b>
            <br />
            Stock actuel : {product.currentStock}
          </div>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="opening_stock">Stock initial</option>
              <option value="stock_in">Entrée</option>
              <option value="stock_out">Sortie</option>
              <option value="damaged">Endommagé</option>
              <option value="lost">Perdu</option>
              <option value="manual_adjustment">Ajustement manuel</option>
              <option value="inventory_adjustment">Inventaire</option>
            </select>
          </label>
          {["manual_adjustment", "inventory_adjustment"].includes(type) && (
            <label>
              Direction
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              >
                <option value="increase">Augmenter</option>
                <option value="decrease">Diminuer</option>
              </select>
            </label>
          )}
          <label>
            Quantité
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>
          <label>
            Motif
            <textarea
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p className={preview < 0 ? "error" : "notice"}>
            Stock résultant : {preview}
          </p>
          <button
            disabled={busy || preview < 0}
            onClick={(e) => {
              if (!confirm(`Confirmer le nouveau stock : ${preview} ?`))
                e.preventDefault();
            }}
          >
            {busy ? "Enregistrement…" : "Confirmer"}
          </button>
        </form>
      )}
    </main>
  );
}
function MovementTable({ data }: { data: StockMovementListResponse }) {
  if (!data.rows.length)
    return <p className="empty">Aucun mouvement de stock.</p>;
  return (
    <div className="table">
      <table>
        <thead>
          <tr>
            <th>Produit</th>
            <th>Type</th>
            <th>Variation</th>
            <th>Avant</th>
            <th>Après</th>
            <th>Employé</th>
            <th>Motif</th>
            <th>Référence</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((x) => (
            <tr key={x.id}>
              <td>{x.productName}</td>
              <td>{x.movementType}</td>
              <td>
                {x.quantityChange > 0 ? "+" : ""}
                {x.quantityChange}
              </td>
              <td>{x.stockBefore}</td>
              <td>{x.stockAfter}</td>
              <td>{x.workerName}</td>
              <td>{x.reason}</td>
              <td>
                {x.referenceType
                  ? `${x.referenceType}${x.referenceId ? ` #${x.referenceId}` : ""}`
                  : "—"}
              </td>
              <td>{new Date(x.createdAt).toLocaleString("fr-MA")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function StockMovements() {
  const location = useLocation(),
    [page, setPage] = useState(1),
    [type, setType] = useState(""),
    [productId, setProductId] = useState(""),
    [workerId, setWorkerId] = useState(""),
    [startDate, setStartDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [data, setData] = useState<StockMovementListResponse>(),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController(),
      p = new URLSearchParams({ page: String(page) });
    let active = true;
    if (type) p.set("movementType", type);
    if (productId) p.set("productId", productId);
    if (workerId) p.set("workerId", workerId);
    if (startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);
    request<StockMovementListResponse>(`/stock/movements?${p}`, {
      signal: c.signal,
    })
      .then((result) => {
        if (!active) return;
        setData(result);
        setError("");
      })
      .catch((reason: unknown) => {
        if (active && !isAbortError(reason))
          setError(reason instanceof Error ? reason.message : "Erreur");
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [page, type, productId, workerId, startDate, endDate]);
  return (
    <main className="page">
      <h1>Mouvements de stock</h1>
      {(location.state as { success?: string } | null)?.success && (
        <div className="notice" role="status">
          {(location.state as { success: string }).success}
        </div>
      )}
      <ErrorBox value={error} />
      <div className="filters">
        <select
          aria-label="Type de mouvement"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tous les types</option>
          <option value="opening_stock">Stock initial</option>
          <option value="stock_in">Entrée</option>
          <option value="stock_out">Sortie</option>
          <option value="damaged">Endommagé</option>
          <option value="lost">Perdu</option>
          <option value="manual_adjustment">Ajustement manuel</option>
          <option value="inventory_adjustment">Inventaire</option>
        </select>
        <input
          aria-label="Identifiant produit"
          type="number"
          min="1"
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            setPage(1);
          }}
          placeholder="ID produit"
        />
        <input
          aria-label="Identifiant employé"
          type="number"
          min="1"
          value={workerId}
          onChange={(e) => {
            setWorkerId(e.target.value);
            setPage(1);
          }}
          placeholder="ID employé"
        />
        <label>
          Du
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Au
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <button
          className="secondary"
          onClick={() => {
            setType("");
            setProductId("");
            setWorkerId("");
            setStartDate("");
            setEndDate("");
            setPage(1);
          }}
        >
          Réinitialiser
        </button>
      </div>
      {data ? (
        <>
          <MovementTable data={data} />
          <Pager page={page} total={data.totalPages} set={setPage} />
        </>
      ) : (
        <p>Chargement…</p>
      )}
    </main>
  );
}
