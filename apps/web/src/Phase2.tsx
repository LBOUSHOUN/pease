import { FormEvent, useEffect, useState } from "react";
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
  ProductLookup,
  StockListResponse,
  StockMovementListResponse,
  SafeUser,
} from "@maktaba/shared-types";
import { request } from "./api";
import { centsToMad, madToCents } from "./money";
import { calculateStockAfter } from "./stock-utils";
import { useScanner } from "./use-scanner";
const has = (u: SafeUser, p: string) => u.permissions.includes(p);
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
    request<CategoryListResponse>(
      `/categories?${new URLSearchParams({ search: query, status, page: String(page) })}`,
      { signal: c.signal },
    )
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
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
export function ProductsPage({ user }: { user: SafeUser }) {
  const [search, setSearch] = useState(""),
    [type, setType] = useState(""),
    [categoryId, setCategoryId] = useState(""),
    [categoryOptions, setCategoryOptions] = useState<Category[]>([]),
    [status, setStatus] = useState("all"),
    [low, setLow] = useState(false),
    [out, setOut] = useState(false),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [data, setData] = useState<ProductListResponse>(),
    [found, setFound] = useState<ProductListRow>(),
    [error, setError] = useState(""),
    query = useDebounced(search),
    load = () => {
      const c = new AbortController(),
        params = new URLSearchParams({
          search: query,
          status,
          page: String(page),
        });
      if (type) params.set("productType", type);
      if (categoryId) params.set("categoryId", categoryId);
      if (low) params.set("lowStockOnly", "true");
      if (out) params.set("outOfStockOnly", "true");
      request<ProductListResponse>(`/products?${params}`, { signal: c.signal })
        .then(setData)
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
      return () => c.abort();
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
          await request<ProductLookup>(
            `/products/lookup/${encodeURIComponent(code)}`,
          )
        ).product,
      );
      setError("");
    } catch (e) {
      setFound(undefined);
      setError(e instanceof Error ? e.message : "Produit introuvable.");
    }
  };
  const toggle = async (product: ProductListRow) => {
    if (
      !confirm(
        `${product.isActive ? "Désactiver" : "Activer"} ${product.name} ?`,
      )
    )
      return;
    try {
      await request(
        `/products/${product.id}/${product.isActive ? "deactivate" : "activate"}`,
        { method: "POST" },
      );
      setRefresh((x) => x + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  };
  useScanner((code) => void lookup(code));
  return (
    <main className="page">
      <div className="title">
        <h1>Produits et services</h1>
        {has(user, "products.create") && (
          <Link className="button" to="/products/new">
            Nouveau produit
          </Link>
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
          <option value="inactive">Inactifs</option>
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
            setStatus("all");
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
                  <td>{x.isActive ? "Actif" : "Inactif"}</td>
                  <td>
                    <Link to={`/products/${x.id}`}>Voir</Link>
                    {has(user, "products.edit") && (
                      <>
                        {" "}
                        · <Link to={`/products/${x.id}/edit`}>Modifier</Link>
                      </>
                    )}
                    {has(user, "products.deactivate") && (
                      <>
                        {" "}
                        ·{" "}
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
type ProductFormState = {
  categoryId: string;
  name: string;
  description: string;
  productType: "physical_product" | "service";
  sku: string;
  manufacturerBarcode: string;
  purchasePrice: string;
  sellingPrice: string;
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
  sku: "",
  manufacturerBarcode: "",
  purchasePrice: "0",
  sellingPrice: "0",
  wholesalePrice: "0",
  wholesaleMinQuantity: "1",
  minimumStock: "0",
  unit: "unité",
  shelfLocation: "",
  trackStock: true,
};
export function ProductForm({ edit = false }: { edit?: boolean }) {
  const { id } = useParams(),
    nav = useNavigate(),
    [form, setForm] = useState(initial),
    [categories, setCategories] = useState<Category[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
            sku: x.sku ?? "",
            manufacturerBarcode: x.manufacturerBarcode ?? "",
            purchasePrice:
              x.purchasePriceCents === undefined
                ? "0"
                : String(x.purchasePriceCents / 100),
            sellingPrice: String(x.sellingPriceCents / 100),
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
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    try {
      const body = {
        categoryId: Number(form.categoryId),
        name: form.name,
        description: form.description,
        productType: form.productType,
        sku: form.sku,
        manufacturerBarcode: form.manufacturerBarcode,
        purchasePriceCents: madToCents(form.purchasePrice),
        sellingPriceCents: madToCents(form.sellingPrice),
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
      } else await request("/products", { method: "POST", json: body });
      nav("/products");
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
      <form onSubmit={submit} className="grid-form">
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
        <label>
          SKU
          <input
            value={form.sku}
            onChange={(e) => set("sku", e.target.value)}
          />
        </label>
        <label>
          Code-barres fabricant
          <input
            value={form.manufacturerBarcode}
            onChange={(e) => set("manufacturerBarcode", e.target.value)}
          />
        </label>
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
            <label>
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
        <div className="actions">
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
        </div>
      </form>
    </main>
  );
}
export function ProductDetails({ user }: { user: SafeUser }) {
  const { id } = useParams(),
    [x, setX] = useState<ProductDetail>(),
    [moves, setMoves] = useState<StockMovementListResponse>(),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    request<ProductDetail>(`/products/${id}`, { signal: c.signal })
      .then(setX)
      .catch((e) => setError(e.message));
    if (has(user, "stock.view"))
      request<StockMovementListResponse>(
        `/stock/movements?productId=${id}&pageSize=10`,
        { signal: c.signal },
      ).then(setMoves);
    return () => c.abort();
  }, [id, user]);
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
        {has(user, "products.edit") && (
          <Link className="button" to={`/products/${x.id}/edit`}>
            Modifier
          </Link>
        )}
        {has(user, "labels.print") && (
          <Link className="button" to={`/products/${x.id}/label`}>
            Étiquette
          </Link>
        )}
      </div>
      <dl className="details">
        <dt>Catégorie</dt>
        <dd>{x.categoryName}</dd>
        <dt>Type</dt>
        <dd>{x.productType === "service" ? "Service" : "Produit physique"}</dd>
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
        <dd>{x.isActive ? "Actif" : "Inactif"}</dd>
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
    [error, setError] = useState(""),
    query = useDebounced(search);
  useEffect(() => {
    const controller = new AbortController();
    request<CategoryListResponse>("/categories?pageSize=100&status=active", {
      signal: controller.signal,
    })
      .then((value) => setCategoryOptions(value.rows))
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
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
    if (categoryId) p.set("categoryId", categoryId);
    request<StockListResponse>(`/stock?${p}`, { signal: c.signal })
      .then(setData)
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => c.abort();
  }, [query, categoryId, status, low, out, page]);
  return (
    <main className="page">
      <div className="title">
        <h1>Stock</h1>
        <div>
          {has(user, "stock.adjust") && (
            <Link className="button" to="/stock/adjust">
              Ajuster
            </Link>
          )}{" "}
          <Link className="button secondary" to="/stock/movements">
            Mouvements
          </Link>
        </div>
      </div>
      <ErrorBox value={error} />
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
                <tr key={x.id}>
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
          await request<ProductLookup>(
            `/products/lookup/${encodeURIComponent(code)}`,
          )
        ).product,
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Produit introuvable.");
    }
  };
  useScanner((code) => void lookup(code));
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
    if (type) p.set("movementType", type);
    if (productId) p.set("productId", productId);
    if (workerId) p.set("workerId", workerId);
    if (startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);
    request<StockMovementListResponse>(`/stock/movements?${p}`, {
      signal: c.signal,
    })
      .then(setData)
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => c.abort();
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
