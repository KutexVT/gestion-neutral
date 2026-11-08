import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  ClipboardList,
  Clock3,
  CreditCard,
  Calculator,
  History,
  LayoutDashboard,
  LogOut,
  Minus,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  api,
  ApiError,
  date,
  localTime,
  money,
  parseMoney,
  setCsrf,
} from "./api";
import type {
  Account,
  Audit,
  Config,
  Invoice,
  Item,
  Product,
  User,
} from "./types";
import { Empty, ErrorBox, Loading, Modal, Submit, Toast } from "./ui";
import "./style.css";
import { ThemeToggle } from "./theme";
import { HistoryValue } from "./history";
import { CashCounter } from "./cash-counter";
import type { CashCounts } from "./cash-count";

type Session = { user: User; csrf: string; config: Config };
type Overlay =
  | { type: "new-customer" }
  | { type: "account"; id: string; tab: "catalog" | "consumption" | "close" }
  | { type: "product"; product?: Product }
  | { type: "stock" }
  | { type: "user" };
type Environment = {
  user: User;
  config: Config;
  revision: number;
  refresh: () => void;
  toast: (message: string) => void;
  open: (overlay: Overlay | null) => void;
  go: (screen: string) => void;
};
const Context = createContext<Environment>(null!);
const useApp = () => useContext(Context);
function useLoad<T>(path: string) {
  const { revision } = useApp();
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<T>(path, "GET", undefined, controller.signal)
      .then((value) => {
        setData(value);
        setError("");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [path, revision, attempt]);
  return { data, error, retry: () => retry((x) => x + 1) };
}
function FetchError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <ErrorBox message={message}>
      <button className="text-btn" onClick={retry}>
        Volver a intentar
      </button>
    </ErrorBox>
  );
}
const initials = (name: string) =>
  name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

function RoleEntry({ onLogin }: { onLogin: (session: Session) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sellers, setSellers] = useState<{ name: string; username: string }[]>([]);
  const [username, setUsername] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<{ name: string; username: string }[]>("/sellers", "GET", undefined, controller.signal)
      .then(setSellers).catch(() => {});
    return () => controller.abort();
  }, []);
  async function enter(role: "admin" | "waiter") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onLogin(await api("/entry", "POST", { role, ...(role === "waiter" && username ? { username } : {}) }));
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <main className="entry-page">
    <section className="entry-panel">
      <h1>Elige un perfil</h1>
      <p className="muted">Accede al espacio que necesitas</p>
      <div className="entry-options">
        <button className="entry-option" aria-label="Dueño" onClick={() => enter("admin")} disabled={busy}>
          <strong>Dueño</strong><span>Inventario · equipo · reportes</span><ArrowRight aria-hidden="true" size={20} />
        </button>
        <button className="entry-option" aria-label="Mesero" onClick={() => enter("waiter")} disabled={busy}>
          <strong>Mesero</strong><span>Clientes · pedidos · cobros</span><ArrowRight aria-hidden="true" size={20} />
        </button>
      </div>
      {sellers.length > 1 && <label className="entry-seller">Perfil de mesero
        <select value={username} onChange={e => setUsername(e.target.value)} disabled={busy}>
          <option value="">Mesero principal</option>
          {sellers.map(s => <option value={s.username} key={s.username}>{s.name}</option>)}
        </select>
      </label>}
      {busy && <Loading />}
      {error && <ErrorBox message={error} />}
      <p className="entry-note">Acceso directo sin contraseña</p>
    </section>
  </main>;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [startError, setStartError] = useState("");
  const [revision, setRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const [cashCounts, setCashCounts] = useState<CashCounts>({});
  const [screen, setScreen] = useState("clients");
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refresh = () => setRevision((v) => v + 1);
  const toast = (message: string) => {
    clearTimeout(timer.current);
    setNotice(message);
    timer.current = setTimeout(() => setNotice(""), 4500);
  };
  const login = (value: Session) => {
    setCashCounts({});
    setSession(value);
    setCsrf(value.csrf);
    setScreen("clients");
    setOverlay(null);
  };
  async function loadSession() {
    setLoading(true);
    setStartError("");
    try {
      login(await api("/me"));
    } catch (e: any) {
      if (e.status !== 401) setStartError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadSession();
    const ended = () => {
      setSession(null);
      setOverlay(null);
    };
    window.addEventListener("session-ended", ended);
    return () => {
      window.removeEventListener("session-ended", ended);
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    let events: EventSource | null = null;
    const connect = () => {
      events?.close();
      if (!navigator.onLine) {
        setConnected(false);
        return;
      }
      events = new EventSource("/api/events");
      events.onopen = () => {
        setConnected(true);
        refresh();
      };
      events.onerror = () => setConnected(false);
      events.addEventListener("change", refresh);
      events.addEventListener("revoked", () => {
        events?.close();
        setSession(null);
        setOverlay(null);
      });
    };
    const offline = () => {
      events?.close();
      setConnected(false);
    };
    window.addEventListener("online", connect);
    window.addEventListener("offline", offline);
    connect();
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => {
      events?.close();
      setConnected(false);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", offline);
    };
  }, [session?.user.id]);
  if (loading) return <Loading />;
  if (startError)
    return (
      <div className="startup">
        <FetchError message={startError} retry={loadSession} />
      </div>
    );
  if (!session) return <RoleEntry onLogin={login} />;
  const { user, config } = session;
  const admin = user.role === "admin";
  const nav = admin
    ? [
        { id: "clients", label: "Clientes", icon: LayoutDashboard },
        { id: "products", label: "Inventario", icon: Package },
        { id: "cash", label: "Flujo de efectivo", icon: CreditCard },
        { id: "team", label: "Equipo", icon: Users },
        { id: "audit", label: "Historial", icon: History },
        { id: "cash-count", label: "Contar efectivo", icon: Calculator },
      ]
    : [
        { id: "clients", label: "Mis clientes", icon: LayoutDashboard },
        { id: "others", label: "Otros meseros", icon: Users },
        { id: "personal", label: "Mi consumo", icon: ClipboardList },
        { id: "closed", label: "Cerradas", icon: ReceiptText },
        { id: "sales", label: "Mis ventas", icon: CreditCard },
        { id: "cash-count", label: "Contar efectivo", icon: Calculator },
      ];
  async function logout() {
    try {
      await api("/logout", "POST");
      setSession(null);
      setOverlay(null);
    } catch (e: any) {
      toast(e.message);
    }
  }
  return (
    <Context.Provider
      value={{
        user,
        config,
        revision,
        refresh,
        toast,
        open: setOverlay,
        go: setScreen,
      }}
    >
      <div className="app-shell">
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setScreen("clients");
            }}
          >
            <span>
              {config.name}

            </span>
          </a>


          <nav aria-label="Navegación principal">
            {nav.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={screen === id ? "active" : ""}
                onClick={() => {
                  setScreen(id);
                  setOverlay(null);
                }}
                aria-current={screen === id ? "page" : undefined}
              >
                <Icon size={20} />
                <span>{label}</span>
                {screen === id && <span className="nav-dot" />}
              </button>
            ))}
          </nav>
          <div className="user-block">
            <span className="avatar">{initials(user.name)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{admin ? "Dueño / Administrador" : "Mesero"}</small>
            </div>
            <button
              className="icon-btn"
              aria-label="Cambiar perfil"
              onClick={logout}
            >
              <LogOut size={18} />
            </button>
          </div>
        </aside>
        <main className="main-content">
          <header className="topbar">
            <button className="btn secondary home-button" onClick={logout}>
              <Users size={17} /> Inicio
            </button>
            <span className="breadcrumb">
              Panel <span>/</span> {nav.find((x) => x.id === screen)?.label}
            </span>
            <span
              className={`connection ${connected ? "" : "offline"}`}
              role="status"
            >
              <i />
              {connected ? "En tiempo real" : "Reconectando…"}
            </span>
            <button
              className="icon-btn mobile-logout"
              onClick={logout}
              aria-label="Cambiar perfil"
            >
              <LogOut size={18} />
            </button>
          </header>
          {!connected && (
            <div className="connection-note">
              Comprobando conexión · No se guardan pedidos sin respuesta del
              servidor
            </div>
          )}
          <div className="page" key={screen}>
            {["clients", "others", "closed"].includes(screen) && (
              <Customers screen={screen} />
            )}
            {admin && screen === "products" && <Products />}
            {admin && screen === "team" && <Team />}
            {admin && screen === "audit" && <AuditPage />}
            {screen === "personal" && <Personal />}
            {screen === "sales" && <SalesPage />}
            {screen === "cash-count" && <CashCounter counts={cashCounts} onChange={setCashCounts} />}
            {admin && screen === "cash" && <SalesPage cashFlow />}
          </div>
          <footer className="page-footer">
            <span>Gestión de clientes e inventario</span>
            <span>Costa Rica · {config.currency}</span>
          </footer>
        </main>
      </div>
      {overlay?.type === "new-customer" && (
        <NewCustomer close={() => setOverlay(null)} />
      )}
      {overlay?.type === "account" && (
        <AccountModal
          id={overlay.id}
          initialTab={overlay.tab}
          close={() => setOverlay(null)}
        />
      )}
      {admin && overlay?.type === "stock" && <StockForm close={() => setOverlay(null)} />}
      {admin && overlay?.type === "product" && (
        <ProductForm product={overlay.product} close={() => setOverlay(null)} />
      )}
      {admin && overlay?.type === "user" && <UserForm close={() => setOverlay(null)} />}
      {notice && (
        <Toast
          key={`${notice}:${overlay?.type}`}
          message={notice}
          clear={() => setNotice("")}
        />
      )}
    </Context.Provider>
  );
}

function PageHeading({
  eyebrow,
  title,
  text,
  children,
}: {
  eyebrow: string;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{text}</p>
      </div>
      {children}
    </div>
  );
}
function Customers({ screen }: { screen: string }) {
  const { user, config, open, go } = useApp();
  const admin = user.role === "admin";
  const [status, setStatus] = useState(
    screen === "closed" ? "closed" : "active",
  );
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const { data, error, retry } = useLoad<{
    rows: Account[];
    has_more: boolean;
  }>(
    `/accounts?status=${status}&scope=${admin ? "all" : screen === "others" ? "others" : "mine"}&search=${encodeURIComponent(search)}&offset=${offset}`,
  );
  const { data: products } = useLoad<Product[]>("/products");
  const rows =
    data?.rows.filter(
      (a) =>
        admin ||
        screen === "closed" ||
        (screen === "others"
          ? a.created_by !== user.id
          : a.created_by === user.id),
    ) || [];
  const totals = rows.reduce<Record<string, number>>((sum, x) => {
    sum[x.currency] =
      (sum[x.currency] || 0) + (x.final_total ?? x.calculated_total);
    return sum;
  }, {});
  return (
    <>
      <PageHeading
        eyebrow={admin ? "VISTA GENERAL" : "EN LA BARRA"}
        title={
          screen === "others"
            ? "Otros meseros"
            : screen === "closed"
              ? "Cuentas cerradas"
              : admin ? "Clientes" : `Clientes de ${user.name}`
        }
        text={
          screen === "others"
            ? "Clientes de tus compañeros. Cada entrega queda a tu nombre."
            : screen === "closed"
              ? "Consulta las cuentas que ya finalizaste."
              : "Clientes y pedidos de tu turno"
        }
      >
        {screen !== "closed" && (
          <button
            className="btn primary"
            onClick={() => open({ type: "new-customer" })}
          >
            <Plus size={19} /> Nuevo cliente
          </button>
        )}
      </PageHeading>
      {!admin && screen === "clients" && (
        <div className="quick-actions">
          <button className="btn secondary" onClick={() => go("others")}>
            <Users size={17} /> Otros clientes
          </button>
          <button className="btn secondary" onClick={() => go("personal")}>
            <ClipboardList size={17} /> Consumo propio
          </button>
        </div>
      )}
      {screen === "clients" && (
        <div className={`overview ${admin ? "" : "waiter"}`}>
          <div className="stat-card">
            <span className="stat-icon">
              <Users size={20} />
            </span>
            <span>
              {status === "closed" ? "Cuentas cerradas" : "Clientes activos"}
            </span>
            <strong>{rows.length.toString().padStart(2, "0")}</strong>
            <small>
              {data?.has_more
                ? "En esta página"
                : admin
                  ? "En esta vista"
                  : "A tu cargo"}
            </small>
          </div>
          <div className="stat-card">
            <span className="stat-icon peach">
              <ReceiptText size={20} />
            </span>
            <span>
              {status === "closed" ? "Total cobrado" : "Consumo de clientes"}
            </span>
            <strong className="money-stat">
              {Object.entries(
                Object.keys(totals).length ? totals : { [config.currency]: 0 },
              ).map(([currency, total]) => (
                <span key={currency} className="currency-total">
                  {money(total, currency)}
                </span>
              ))}
            </strong>
            <small>
              {status === "closed"
                ? "En esta página"
                : "Cuentas abiertas de esta vista"}
            </small>
          </div>
        </div>
      )}
      {products && products.some((p) => p.active && p.stock <= 5) && (
        <div className="stock-strip">
          <Package size={17} />
          <span>
            <strong>
              {products.filter((p) => p.active && p.stock <= 5).length}{" "}
              productos con pocas unidades
            </strong>{" "}
            · Consulta la disponibilidad al seleccionar
          </span>
        </div>
      )}
      <div className="list-toolbar">
        <div className="section-label">
          <h2>
            {screen === "others"
              ? "Clientes del equipo"
              : status === "closed"
                ? "Cuentas cerradas"
                : admin
                  ? "Clientes"
                  : "Tus clientes"}
          </h2>
          <span className="count">{rows.length}</span>
        </div>
        <div className="toolbar-actions">
          {admin && (
            <select
              aria-label="Estado de cuentas"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
            >
              <option value="active">Activos</option>
              <option value="closed">Cerrados</option>
              <option value="all">Todos</option>
            </select>
          )}
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Buscar cliente o mesero"
              placeholder="Buscar cliente…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </label>
        </div>
      </div>
      {error && <FetchError message={error} retry={retry} />}
      {!data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty
          title="No hay clientes activos"
          text={
            search
              ? "No encontramos clientes con esa búsqueda."
              : "Cuando llegue un cliente, abre su cuenta y comienza a registrar sus pedidos."
          }
        >
          {screen !== "others" && screen !== "closed" && (
            <button
              className="btn secondary"
              onClick={() => open({ type: "new-customer" })}
            >
              <Plus size={18} /> Crear cliente
            </button>
          )}
        </Empty>
      ) : (
        <div className="customer-grid">
          {rows.map((account, index) => (
            <article className="customer-card" key={account.id}>
              <button
                className="customer-open"
                onClick={() =>
                  open({
                    type: "account",
                    id: account.id,
                    tab: account.closed_at ? "consumption" : "catalog",
                  })
                }
              >
                <div className="card-top">
                  <span className={`avatar color-${index % 4}`}>
                    {initials(account.name)}
                  </span>
                  <span
                    className={`status-pill ${account.closed_at ? "closed" : ""}`}
                  >
                    <i />
                    {account.closed_at ? "Cerrado" : "Activo"}
                  </span>
                </div>
                <h3>{account.name}</h3>
                <div className="customer-meta">
                  <Clock3 size={14} />{" "}
                  {date(account.arrived_at, config.timezone, true)}
                  <span>·</span>
                  {account.creator_name}
                </div>
                <div className="card-total">
                  <span>
                    {account.closed_at ? "Total cobrado" : "Consumo actual"}
                  </span>
                  <strong>
                    {money(
                      account.final_total ?? account.calculated_total,
                      account.currency,
                    )}
                  </strong>
                </div>
              </button>
              <div className="card-actions">
                <button
                  onClick={() =>
                    open({
                      type: "account",
                      id: account.id,
                      tab: "consumption",
                    })
                  }
                >
                  <ClipboardList size={16} /> Ver consumo
                </button>
                {!account.closed_at &&
                  (admin || account.created_by === user.id) && (
                    <button
                      onClick={() =>
                        open({ type: "account", id: account.id, tab: "close" })
                      }
                    >
                      <CreditCard size={16} /> Finalizar
                    </button>
                  )}
                {account.closed_at && (
                  <button
                    onClick={() =>
                      open({ type: "account", id: account.id, tab: "close" })
                    }
                  >
                    <ReceiptText size={16} /> Factura
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {data && (
        <div className="pagination">
          <button
            disabled={!offset}
            className="text-btn"
            onClick={() => setOffset((x) => Math.max(0, x - 100))}
          >
            Anterior
          </button>
          <span>Página {offset / 100 + 1}</span>
          <button
            disabled={!data.has_more}
            className="text-btn"
            onClick={() => setOffset((x) => x + 100)}
          >
            Siguiente
          </button>
        </div>
      )}
    </>
  );
}

function NewCustomer({ close }: { close: () => void }) {
  const { open, refresh } = useApp();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const account = await api<Account>("/accounts", "POST", {
        name: new FormData(e.currentTarget).get("name"),
      });
      refresh();
      open({ type: "account", id: account.id, tab: "catalog" });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Un nuevo cliente" close={close}>
      <form className="form-stack" onSubmit={submit}>
        <p className="muted">
          La hora de llegada y tu nombre se registran automáticamente.
        </p>
        <label>
          Nombre del cliente
          <input
            name="name"
            placeholder="Cómo lo identificamos"
            autoFocus
            required
            maxLength={100}
          />
        </label>
        {error && <ErrorBox message={error} />}
        <Submit busy={busy}>
          Abrir cuenta <ArrowRight size={18} />
        </Submit>
      </form>
    </Modal>
  );
}

function Personal() {
  const { open, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function enter() {
    setBusy(true);
    try {
      const a = await api<Account>("/personal", "POST");
      refresh();
      open({ type: "account", id: a.id, tab: "catalog" });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const data = useLoad<{ rows: Account[] }>("/accounts?kind=personal");
  return (
    <>
      <PageHeading
        eyebrow="TAMBIÉN HAY TIEMPO PARA TI"
        title="Tu consumo."
        text="Tu lista personal. Cada producto descuenta inventario y queda separado de las ventas."
      />
      <div className="personal-banner">
        <ClipboardList size={55} strokeWidth={1} />
        <div>
          <h2>Una pausa en tu turno</h2>
          <p className="muted">Registra aquí lo que consumes.</p>
          <button disabled={busy} className="btn primary" onClick={enter}>
            <Plus size={18} /> Registrar mi consumo
          </button>
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      {data.error && <FetchError message={data.error} retry={data.retry} />}
      {data.data?.rows.map((a) => (
        <div className="summary-row" key={a.id}>
          <div>
            <h3>Mi lista personal</h3>
            <span className="muted">
              {money(a.calculated_total, a.currency)} en productos
            </span>
          </div>
          <button
            className="btn secondary"
            onClick={() =>
              open({ type: "account", id: a.id, tab: "consumption" })
            }
          >
            <Pencil size={17} /> Ver y corregir
          </button>
        </div>
      ))}
    </>
  );
}

function AccountModal({
  id,
  initialTab,
  close,
}: {
  id: string;
  initialTab: "catalog" | "consumption" | "close";
  close: () => void;
}) {
  const { user, config } = useApp();
  const { data: account, error, retry } = useLoad<Account>(`/accounts/${id}`);
  const [tab, setTab] = useState<string>(initialTab);
  const [editName, setEditName] = useState(false);
  const manager =
    account && (user.role === "admin" || account.created_by === user.id);
  return (
    <Modal
      title={
        account
          ? account.kind === "personal"
            ? `Consumo · ${account.creator_name}`
            : account.name
          : "Cargando cuenta"
      }
      subtitle={
        account
          ? `${account.creator_name} · ${date(account.arrived_at, config.timezone)}`
          : undefined
      }
      close={close}
      wide
    >
      {error && <FetchError message={error} retry={retry} />}
      {!account ? (
        <Loading />
      ) : (
        <>
          {account.kind === "customer" &&
            manager &&
            (!account.closed_at || user.role === "admin") && (
              <button
                className="text-btn edit-name"
                onClick={() => setEditName((x) => !x)}
              >
                <Pencil size={14} /> Corregir datos del cliente
              </button>
            )}
          {editName && (
            <CustomerData account={account} done={() => setEditName(false)} />
          )}
          <div className="tabs" role="tablist" aria-label="Cuenta">
            <button
              role="tab"
              aria-selected={tab === "catalog"}
              disabled={!!account.closed_at && user.role !== "admin"}
              onClick={() => setTab("catalog")}
            >
              Catálogo
            </button>
            <button
              role="tab"
              aria-selected={tab === "consumption"}
              onClick={() => setTab("consumption")}
            >
              Consumo{" "}
              <span>{account.items.reduce((n, i) => n + i.quantity, 0)}</span>
            </button>
            {account.kind === "customer" && (manager || account.closed_at) && (
              <button
                role="tab"
                aria-selected={tab === "close"}
                onClick={() => setTab("close")}
              >
                {account.closed_at ? "Factura" : "Finalizar cuenta"}
              </button>
            )}
          </div>
          {account.closed_at && (
            <div className="info-box">
              Cuenta cerrada · {date(account.closed_at, config.timezone)}
              {user.role === "admin" && (
                <span>
                  {" "}
                  Las correcciones conservan lo cobrado y generan otra versión
                  de la factura.
                </span>
              )}
            </div>
          )}
          <div key={tab}>
            {tab === "catalog" && <Catalog account={account} />}
            {tab === "consumption" && <Consumption account={account} />}
            {tab === "close" &&
              (account.closed_at ? (
                <Receipt account={account} />
              ) : (
                <Checkout account={account} />
              ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function Catalog({ account }: { account: Account }) {
  const {
    data: products,
    error: loadError,
    retry,
  } = useLoad<Product[]>("/products");
  const { toast, refresh, user, open } = useApp();
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [baseVersion, setBaseVersion] = useState(account.version);
  const count = Object.values(selected).reduce((a, b) => a + b, 0);
  const total =
    products?.reduce((sum, p) => sum + (selected[p.id] || 0) * p.price, 0) || 0;
  function choose(p: Product, value: number) {
    const qty = Math.max(0, Math.min(100000, Math.trunc(value || 0)));
    setSelected((x) => ({ ...x, [p.id]: qty }));
    const left = p.stock - qty;
    if ([5, 3, 1].includes(left) && qty > (selected[p.id] || 0))
      toast(
        `${p.name}: quedarían ${left} ${left === 1 ? "unidad" : "unidades"}`,
      );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        account: Account;
        stock: { name: string; stock: number }[];
      }>(`/accounts/${account.id}/consumption`, "POST", {
        version: baseVersion,
        add: Object.entries(selected)
          .filter(([, q]) => q > 0)
          .map(([product_id, quantity]) => ({ product_id, quantity })),
      });
      setSelected({});
      setBaseVersion(result.account.version);
      refresh();
      toast("Productos registrados");
      if (user.role === "waiter") open(null);
    } catch (e: any) {
      setError(e.message);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="catalog-heading">
        <div>
          <h3>Qué servimos hoy</h3>
          <p className="muted">Selecciona los productos y sus cantidades.</p>
        </div>
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Buscar producto"
            placeholder="Buscar producto…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {loadError && <FetchError message={loadError} retry={retry} />}
      {!products ? (
        <Loading />
      ) : products.filter((p) => p.active).length === 0 ? (
        <Empty
          title="El catálogo está por llegar"
          text="El dueño puede agregar productos desde Inventario."
        />
      ) : (
        <div className="catalog-grid">
          {products
            .filter(
              (p) =>
                p.active &&
                p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            )
            .map((p) => (
              <article
                className={`product-card ${selected[p.id] ? "selected" : ""}`}
                key={p.id}
              >
                <div className="product-photo">
                  <img
                    src={`/api/photos/${p.photo_id}`}
                    alt={p.name}
                    loading="lazy"
                  />
                  <span className={`stock-tag ${p.stock <= 5 ? "low" : ""}`}>
                    {p.stock === 0 ? "Agotado" : `${p.stock} disponibles`}
                  </span>
                </div>
                <div className="product-body">
                  <h4>{p.name}</h4>
                  <strong>{money(p.price, p.currency)}</strong>
                  <div className="stepper">
                    <button
                      type="button"
                      aria-label={`Quitar ${p.name}`}
                      disabled={!selected[p.id]}
                      onClick={() => choose(p, (selected[p.id] || 0) - 1)}
                    >
                      <Minus size={17} />
                    </button>
                    <input
                      type="number"
                      min="0"
                      max="100000"
                      inputMode="numeric"
                      aria-label={`Cantidad de ${p.name}`}
                      value={selected[p.id] || 0}
                      onChange={(e) => choose(p, e.target.valueAsNumber)}
                    />
                    <button
                      type="button"
                      aria-label={`Agregar ${p.name}`}
                      disabled={p.stock === 0}
                      onClick={() => choose(p, (selected[p.id] || 0) + 1)}
                    >
                      <Plus size={17} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
        </div>
      )}
      {error && (
        <ErrorBox message={error}>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setBaseVersion(account.version);
              setError("");
            }}
          >
            Revisar disponibilidad y volver a confirmar
          </button>
        </ErrorBox>
      )}
      <div className="order-footer">
        <div>
          <span>
            {count}{" "}
            {count === 1 ? "producto seleccionado" : "productos seleccionados"}
          </span>
          <strong>{money(total, account.currency)}</strong>
        </div>
        <button className="btn primary" disabled={busy || !count} type="submit">
          {busy ? "Guardando…" : "Registrar pedido"}
          <ArrowRight size={18} />
        </button>
      </div>
    </form>
  );
}

function Consumption({ account }: { account: Account }) {
  const { user, config, refresh, toast } = useApp();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [baseVersion, setBaseVersion] = useState(account.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canEdit = (item: Item) =>
    user.role === "admin" ||
    (!account.closed_at &&
      (account.created_by === user.id || item.recorded_by === user.id));
  function change(item: Item, n: number) {
    if (!Object.keys(draft).length) setBaseVersion(account.version);
    setDraft((d) => ({
      ...d,
      [item.id]: Math.max(0, Math.min(100000, Math.trunc(n || 0))),
    }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/accounts/${account.id}/consumption`, "POST", {
        version: baseVersion,
        set: Object.entries(draft).map(([id, quantity]) => ({ id, quantity })),
      });
      setDraft({});
      refresh();
      toast("Consumo corregido e inventario actualizado");
    } catch (e: any) {
      setError(e.message);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      {account.items.length ? (
        <div className="consumption-list">
          {account.items.map((item) => (
            <div
              className={`consumption-row ${draft[item.id] === 0 ? "removed" : ""}`}
              key={item.id}
            >
              <div>
                <h4>{item.product_name}</h4>
                <span>
                  {money(item.unit_price, account.currency)} por unidad
                </span>
                <small>
                  {item.waiter_name} ·{" "}
                  {date(item.recorded_at, config.timezone, true)}
                </small>
              </div>
              <div className="consumption-right">
                <strong>
                  {money(
                    item.unit_price * (draft[item.id] ?? item.quantity),
                    account.currency,
                  )}
                </strong>
                {canEdit(item) ? (
                  <div className="inline-edit">
                    <input
                      type="number"
                      min="0"
                      max="100000"
                      aria-label={`Cantidad registrada de ${item.product_name} por ${item.waiter_name}`}
                      value={draft[item.id] ?? item.quantity}
                      onChange={(e) => change(item, e.target.valueAsNumber)}
                    />
                    <button
                      type="button"
                      className="icon-btn danger-text"
                      aria-label={`Quitar entrega de ${item.product_name}`}
                      onClick={() => change(item, 0)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ) : (
                  <span>{item.quantity} unidades</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          title="La primera ronda está pendiente"
          text="Agrega productos desde el catálogo para ver el consumo aquí."
        />
      )}
      <div className="totals">
        <span>Total calculado</span>
        <strong>{money(account.calculated_total, account.currency)}</strong>
      </div>
      {account.closed_at && (
        <div className="totals secondary-total">
          <span>
            Total cobrado
            {account.adjusted_by_name && (
              <small>Ajustado por {account.adjusted_by_name}</small>
            )}
          </span>
          <strong>{money(account.final_total!, account.currency)}</strong>
        </div>
      )}
      {error && (
        <ErrorBox message={error}>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setDraft({});
              setBaseVersion(account.version);
              setError("");
            }}
          >
            Descartar cambios y cargar consumo actual
          </button>
        </ErrorBox>
      )}
      {Object.keys(draft).length > 0 && (
        <div className="form-footer">
          <button
            type="button"
            className="btn secondary"
            onClick={() => setDraft({})}
          >
            Cancelar cambios
          </button>
          <Submit busy={busy}>Guardar corrección</Submit>
        </div>
      )}
    </form>
  );
}

function Checkout({ account }: { account: Account }) {
  const { refresh, toast } = useApp();
  const [override, setOverride] = useState(false);
  const [price, setPrice] = useState(
    (account.calculated_total / 100).toFixed(2),
  );
  const [cash, setCash] = useState<string | null>(null);
  let due: number | null = null;
  let change: number | null = null;
  try {
    due = override ? parseMoney(price) : account.calculated_total;
    change = parseMoney(cash ?? (due / 100).toFixed(2)) - due;
  } catch {}
  const [confirmation, setConfirmation] = useState<{
    version: number;
    final: number | null;
    received: number;
    change: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (!confirmation) {
        const total = override ? parseMoney(price) : account.calculated_total;
        const received = parseMoney(cash ?? (total / 100).toFixed(2));
        if (received < total)
          throw new Error(
            "El efectivo recibido no alcanza para pagar la cuenta",
          );
        setConfirmation({
          version: account.version,
          final: override ? total : null,
          received,
          change: received - total,
        });
        return;
      }
      setBusy(true);
      await api(`/accounts/${account.id}/close`, "POST", {
        version: confirmation.version,
        final_total: confirmation.final,
        cash_received: confirmation.received,
        confirmed: true,
      });
      refresh();
      toast("Cuenta cerrada");
    } catch (e: any) {
      setError(e.message);
      setConfirmation(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack checkout" onSubmit={submit}>
      <div className="checkout-icon">
        <CreditCard size={30} />
      </div>
      <h3>Todo listo para cerrar</h3>
      <p className="muted">
        Revisa la cuenta de {account.name} antes de finalizar.
      </p>
      <div className="checkout-lines">
        {account.items.map((item) => (
          <div key={item.id}>
            <span>
              {item.quantity} × {item.product_name}
            </span>
            <strong>
              {money(item.quantity * item.unit_price, account.currency)}
            </strong>
          </div>
        ))}
      </div>
      <div className="totals">
        <span>Total calculado</span>
        <strong>{money(account.calculated_total, account.currency)}</strong>
      </div>
      {!confirmation ? (
        <>
          <fieldset>
            <legend>Quieres cambiar el precio final</legend>
            <label className="radio">
              <input
                type="radio"
                name="override"
                checked={!override}
                onChange={() => setOverride(false)}
              />{" "}
              No, cobrar el total calculado
            </label>
            <label className="radio">
              <input
                type="radio"
                name="override"
                checked={override}
                onChange={() => setOverride(true)}
              />{" "}
              Sí, indicar otro importe
            </label>
          </fieldset>
          {override && (
            <label>
              Total final ({account.currency})
              <input
                inputMode="decimal"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
          )}
          <label>
            Efectivo recibido ({account.currency})
            <input
              inputMode="decimal"
              required
              value={cash ?? (due === null ? "" : (due / 100).toFixed(2))}
              onChange={(e) => setCash(e.target.value)}
            />
          </label>
          <div className="totals" aria-live="polite">
            <span>Vuelto</span>
            <strong>
              {change !== null && change >= 0
                ? money(change, account.currency)
                : "El efectivo no alcanza o el importe es inválido"}
            </strong>
          </div>
        </>
      ) : (
        <div className="confirmation">
          <ShieldCheck size={22} />
          <h4>Confirmar cierre de cuenta</h4>
          <p>
            Efectivo recibido: {money(confirmation.received, account.currency)}
            <br />
            Vuelto:{" "}
            <strong>{money(confirmation.change, account.currency)}</strong>
          </p>
          <p>
            Se registrará la salida y un total final de{" "}
            <strong>
              {money(
                confirmation.final ?? account.calculated_total,
                account.currency,
              )}
            </strong>
          </p>
          <button
            type="button"
            className="text-btn"
            onClick={() => setConfirmation(null)}
          >
            Volver a revisar
          </button>
        </div>
      )}
      {error && <ErrorBox message={error} />}
      <Submit busy={busy}>
        {confirmation ? "Confirmar y emitir factura" : "Revisar cierre"}{" "}
        <ArrowRight size={18} />
      </Submit>
    </form>
  );
}

function Receipt({ account }: { account: Account }) {
  const receiptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    receiptRef.current?.closest("dialog")?.scrollTo(0, 0);
  }, []);
  const { config, user } = useApp();
  const [chosen, setChosen] = useState<number | null>(null);
  const [edit, setEdit] = useState(false);
  const inv =
    account.invoices.find((i) => i.id === chosen) || account.invoices[0];
  const s = inv?.snapshot;
  if (!s) return <Loading />;
  return (
    <div className="receipt-view" ref={receiptRef}>
      <div className="receipt-controls">
        <span className="status-pill">
          <Check size={14} /> Cuenta finalizada
        </span>
        <select
          aria-label="Versión de factura"
          value={chosen ?? account.invoices[0].id}
          onChange={(e) => setChosen(Number(e.target.value))}
        >
          {account.invoices.map((i) => (
            <option key={i.id} value={i.id}>
              Versión {i.revision} · {date(i.created_at, config.timezone)}
            </option>
          ))}
        </select>
      </div>
      <div className="terminal">
        <div className="terminal-screen">
          <CircleCheck size={17} />
          <span>CUENTA REGISTRADA</span>
          <span>•••</span>
        </div>
        <div className="terminal-slot" />
      </div>
      <div className="receipt-window">
        <article className="receipt" key={inv.id}>
          <div className="receipt-brand">
            <h3>Comprobante</h3>
            <span>COMPROBANTE DE CONSUMO</span>
          </div>
          <div className="receipt-meta">
            <strong>{s.name}</strong>
            <div>
              <span>Factura</span>
              <span>
                #{inv.id.toString().padStart(6, "0")} · v{inv.revision}
              </span>
            </div>
            <div>
              <span>Llegada</span>
              <span>{date(s.arrived_at, s.timezone)}</span>
            </div>
            <div>
              <span>Salida</span>
              <span>{date(s.closed_at, s.timezone)}</span>
            </div>
            <div>
              <span>Mesero</span>
              <span>{s.creator_name}</span>
            </div>
          </div>
          <div className="receipt-items">
            {s.items.map((i) => (
              <div key={i.id}>
                <div>
                  <strong>{i.product_name}</strong>
                  <span>
                    {i.quantity} × {money(i.unit_price, s.currency)}
                  </span>
                </div>
                <strong>{money(i.quantity * i.unit_price, s.currency)}</strong>
              </div>
            ))}
          </div>
          <div className="receipt-total">
            <span>TOTAL</span>
            <strong>{money(s.final_total!, s.currency)}</strong>
          </div>
          {s.cash_received != null && (
            <div className="receipt-meta receipt-payment">
              <div>
                <span>Efectivo recibido</span>
                <span>{money(s.cash_received, s.currency)}</span>
              </div>
              <div>
                <span>Vuelto entregado</span>
                <span>{money(s.cash_change!, s.currency)}</span>
              </div>
            </div>
          )}
          <div className="receipt-thanks">
            Cuenta finalizada
            <br />
            <span>Detalle del consumo</span>
          </div>

          <small className="receipt-disclaimer">
            Comprobante interno · No es un documento fiscal
          </small>
        </article>
      </div>
      {user.role === "admin" && (
        <div className="receipt-admin">
          <p>
            Calculado:{" "}
            <strong>{money(account.calculated_total, account.currency)}</strong>{" "}
            · Cobrado:{" "}
            <strong>{money(account.final_total!, account.currency)}</strong>
          </p>
          {account.adjusted_by_name && (
            <p className="muted">
              Último ajuste de total: {account.adjusted_by_name}
            </p>
          )}
          <button className="text-btn" onClick={() => setEdit((x) => !x)}>
            <Pencil size={15} /> Corregir total cobrado
          </button>
          {edit && <FinalForm account={account} done={() => setEdit(false)} />}
        </div>
      )}
      {user.role === "admin" && (
        <button
          className="btn secondary print-btn"
          onClick={() => window.print()}
        >
          <ReceiptText size={17} /> Imprimir comprobante
        </button>
      )}
    </div>
  );
}

function FinalForm({ account, done }: { account: Account; done: () => void }) {
  const { refresh, toast } = useApp();
  const [value, setValue] = useState((account.final_total! / 100).toFixed(2));
  const [base] = useState(account.version);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const final_total = parseMoney(value);
      if (!confirm) {
        setConfirm(true);
        return;
      }
      setBusy(true);
      await api(`/accounts/${account.id}/final`, "PATCH", {
        version: base,
        final_total,
        confirmed: true,
      });
      refresh();
      toast("Total corregido. Se conservó la factura anterior");
      done();
    } catch (e: any) {
      setError(e.message);
      setConfirm(false);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack inset-form" onSubmit={submit}>
      <label>
        Nuevo total cobrado ({account.currency})
        <input
          inputMode="decimal"
          value={value}
          readOnly={confirm}
          required
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      {confirm && (
        <div className="info-box">
          Confirma para guardar otro total y emitir una nueva versión
        </div>
      )}
      {error && <ErrorBox message={error} />}
      <Submit busy={busy}>
        {confirm ? "Confirmar nuevo total" : "Revisar cambio"}
      </Submit>
    </form>
  );
}

function zonedDate(value: string, timezone: string) {
  const target = Date.parse(`${value}:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const actual = localTime(new Date(guess).toISOString(), timezone);
    guess += target - Date.parse(`${actual}:00Z`);
  }
  return new Date(guess).toISOString();
}
function CustomerData({
  account,
  done,
}: {
  account: Account;
  done: () => void;
}) {
  const { user, config, refresh } = useApp();
  const [base] = useState(account.version);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api(`/accounts/${account.id}`, "PATCH", {
        version: base,
        name: f.get("name"),
        ...(user.role === "admin"
          ? {
              arrived_at: zonedDate(String(f.get("arrival")), config.timezone),
              ...(account.closed_at
                ? {
                    closed_at: zonedDate(
                      String(f.get("departure")),
                      config.timezone,
                    ),
                  }
                : {}),
            }
          : {}),
      });
      refresh();
      done();
    } catch (e: any) {
      setError(e.message);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack inset-form" onSubmit={submit}>
      <label>
        Nombre del cliente
        <input
          name="name"
          defaultValue={account.name}
          required
          maxLength={100}
        />
      </label>
      {user.role === "admin" && (
        <div className="form-columns">
          <label>
            Llegada · {config.timezone}
            <input
              type="datetime-local"
              name="arrival"
              defaultValue={localTime(account.arrived_at, config.timezone)}
              required
            />
          </label>
          {account.closed_at && (
            <label>
              Salida
              <input
                type="datetime-local"
                name="departure"
                defaultValue={localTime(account.closed_at, config.timezone)}
                required
              />
            </label>
          )}
        </div>
      )}
      {error && <ErrorBox message={error} />}
      <Submit busy={busy}>Guardar datos</Submit>
    </form>
  );
}

function Products() {
  const { data, error, retry } = useLoad<Product[]>("/products");
  const { open, config } = useApp();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = data?.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "low" ? p.active && p.stock <= 5 : !p.active)),
  );
  return (
    <>
      <PageHeading
        eyebrow="INVENTARIO"
        title="Inventario"
        text="Productos, precios y existencias. Siempre al día."
      >
        <div className="inventory-actions">
        <button className="btn secondary" onClick={() => open({ type: "stock" })}>
          <Package size={18} /> Sumar existencias
        </button>
        <button
          className="btn primary"
          onClick={() => open({ type: "product" })}
        >
          <Plus size={18} /> Nuevo producto
        </button>
        </div>
      </PageHeading>
      <div className="inventory-stats">
        <div>
          <Package size={23} />
          <strong>{data?.filter((p) => p.active).length || 0}</strong>
          <span>Productos activos</span>
        </div>
        <div>
          <Package size={23} />
          <strong>
            {data?.filter((p) => p.active).reduce((s, p) => s + p.stock, 0) ||
              0}
          </strong>
          <span>Unidades disponibles</span>
        </div>
        <div>
          <Clock3 size={23} />
          <strong>
            {data?.filter((p) => p.active && p.stock <= 5).length || 0}
          </strong>
          <span>Por reponer</span>
        </div>
      </div>
      <div className="list-toolbar">
        <div className="filter-chips">
          {[
            ["all", "Todos"],
            ["low", "Pocas unidades"],
            ["inactive", "Desactivados"],
          ].map(([v, label]) => (
            <button
              className={filter === v ? "selected" : ""}
              onClick={() => setFilter(v)}
              key={v}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Buscar en inventario"
            placeholder="Buscar producto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {error && <FetchError message={error} retry={retry} />}
      {!data ? (
        <Loading />
      ) : !filtered?.length ? (
        <Empty
          title="Aquí empieza tu catálogo"
          text="Agrega una foto, el precio y las existencias de cada producto."
        >
          <button
            className="btn secondary"
            onClick={() => open({ type: "product" })}
          >
            <Plus size={17} /> Agregar producto
          </button>
        </Empty>
      ) : (
        <div className="inventory-list">
          <div className="inventory-head">
            <span>PRODUCTO</span>
            <span>PRECIO</span>
            <span>EXISTENCIAS</span>
            <span />
          </div>
          {filtered.map((p) => (
            <div
              className={`inventory-row ${!p.active ? "inactive-product" : ""}`}
              key={p.id}
            >
              <div className="inventory-product">
                <img src={`/api/photos/${p.photo_id}`} alt={p.name} />
                <div>
                  <h3>{p.name}</h3>
                  <small>
                    {p.active ? "Disponible en catálogo" : "Desactivado"}
                  </small>
                </div>
              </div>
              <strong>{money(p.price, p.currency || config.currency)}</strong>
              <span className={`stock-count ${p.stock <= 5 ? "low" : ""}`}>
                <i />
                {p.stock} <small>unidades</small>
              </span>
              <button
                className="icon-btn"
                aria-label={`Editar ${p.name}`}
                onClick={() => open({ type: "product", product: p })}
              >
                <Settings2 size={19} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function StockForm({ close }: { close: () => void }) {
  const { data, error: loadError, retry } = useLoad<Product[]>("/products");
  const { refresh, toast } = useApp();
  const [id, setId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const product = data?.find(p => p.id === id);
  const amount = Number(quantity);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!product || busy) return;
    setError("");
    setBusy(true);
    try {
      const updated = await api<Product>(`/products/${id}/stock`, "POST", { quantity: amount });
      refresh();
      close();
      toast(`${updated.name}: se sumaron ${amount} unidades. Disponibles: ${updated.stock}`);
    } catch (e: any) {
      setError(e.message);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  return <Modal title="Sumar existencias" subtitle="ENTRADA DE INVENTARIO" close={close}>
    {loadError && <FetchError message={loadError} retry={retry} />}
    {!data ? <Loading /> : <form className="form-stack" onSubmit={submit}>
      <label>Producto
        <select value={id} onChange={e => setId(e.target.value)} required disabled={busy}>
          <option value="">Selecciona un producto</option>
          {data.map(p => <option key={p.id} value={p.id}>{p.name}{!p.active ? " · Desactivado" : ""}</option>)}
        </select>
      </label>
      <label>Cantidad a sumar
        <input type="number" inputMode="numeric" min="1" max="1000000" step="1" required value={quantity} onChange={e => setQuantity(e.target.value)} disabled={busy} placeholder="Ejemplo: 30" />
      </label>
      {product && <div className="info-box" role="status">
        Existencias actuales: <strong>{product.stock}</strong>
        {Number.isInteger(amount) && amount > 0 && <> · Después de sumar: <strong>{product.stock + amount}</strong></>}
        <p>Se suma a las existencias disponibles al guardar.</p>
      </div>}
      {error && <ErrorBox message={error} />}
      <div className="form-footer"><Submit busy={busy}>Sumar unidades</Submit></div>
    </form>}
  </Modal>;
}

function ProductForm({
  product,
  close,
}: {
  product?: Product;
  close: () => void;
}) {
  const { config, refresh, toast } = useApp();
  const [photo, setPhoto] = useState(product?.photo_id || "");
  const [preview, setPreview] = useState(
    product ? `/api/photos/${product.photo_id}` : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("La foto debe pesar menos de 5 MB");
      const form = new FormData();
      form.append("photo", file);
      const result = await api<{ id: string }>("/photos", "POST", form);
      setPhoto(result.id);
      setPreview(`/api/photos/${result.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      if (!photo) throw new Error("Agrega una foto del producto");
      await api(
        product ? `/products/${product.id}` : "/products",
        product ? "PATCH" : "POST",
        {
          ...(product ? { version: product.version } : {}),
          name: f.get("name"),
          price: parseMoney(String(f.get("price"))),
          stock: Number(f.get("stock")),
          photo_id: photo,
          active: f.get("active") === "on",
        },
      );
      refresh();
      toast(
        product
          ? "Producto e inventario actualizados"
          : "Producto disponible para el equipo",
      );
      close();
    } catch (e: any) {
      setError(e.message);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={product ? "Editar producto" : "Crear producto"}
      close={close}
    >
      <form className="form-stack" onSubmit={submit}>
        <label className="photo-upload">
          {preview ? (
            <img src={preview} alt="Foto del producto" />
          ) : (
            <Upload size={28} />
          )}
          <span>
            {uploading
              ? "Guardando foto…"
              : preview
                ? "Cambiar foto"
                : "Agregar foto del producto"}
          </span>
          <small>JPG, PNG o WebP · Hasta 5 MB</small>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Foto del producto"
            disabled={uploading}
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </label>
        <label>
          Nombre
          <input
            name="name"
            defaultValue={product?.name}
            required
            maxLength={100}
            placeholder="Ej. Cerveza artesanal"
          />
        </label>
        <div className="form-columns">
          <label>
            Precio ({product?.currency || config.currency})
            <input
              name="price"
              inputMode="decimal"
              defaultValue={product ? (product.price / 100).toFixed(2) : ""}
              required
              placeholder="0.00"
            />
          </label>
          <label>
            Unidades disponibles
            <input
              type="number"
              inputMode="numeric"
              name="stock"
              min="0"
              max="1000000"
              defaultValue={product?.stock ?? 0}
              required
            />
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            name="active"
            defaultChecked={product?.active ?? true}
          />{" "}
          Disponible en el catálogo
        </label>
        {product && (
          <p className="muted">
            El precio nuevo aplica a las próximas entregas. Las anteriores
            conservan su precio.
          </p>
        )}
        {error && <ErrorBox message={error} />}
        <Submit busy={busy || uploading}>
          {product ? "Guardar cambios" : "Crear producto"}
        </Submit>
      </form>
    </Modal>
  );
}

function Team() {
  const { data: users, error, retry } = useLoad<User[]>("/users");
  const { user, open, refresh, toast } = useApp();
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/users/${id}`, "DELETE");
      refresh();
      toast("Acceso eliminado. El historial se conserva");
      setRemoving(null);
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="LAS PERSONAS DETRÁS DE LA BARRA"
        title="Tu equipo."
        text="Administra accesos y consulta el consumo de cada mesero."
      >
        <button className="btn primary" onClick={() => open({ type: "user" })}>
          <Plus size={18} /> Agregar mesero
        </button>
      </PageHeading>
      {error && <FetchError message={error} retry={retry} />}
      {!users ? (
        <Loading />
      ) : (
        <div className="team-grid">
          {users.map((member, index) => {
            const account = member.personal_account_id
              ? {
                  id: member.personal_account_id,
                  calculated_total: member.personal_total!,
                  currency: member.personal_currency!,
                }
              : null;
            return (
              <article
                className={`team-card ${member.active ? "" : "inactive-product"}`}
                key={member.id}
              >
                <div className="card-top">
                  <span className={`avatar color-${index % 4}`}>
                    {initials(member.name)}
                  </span>
                  <span className="status-pill">
                    {member.role === "admin"
                      ? "Administrador"
                      : member.active
                        ? "Mesero activo"
                        : "Acceso eliminado"}
                  </span>
                </div>
                <h3>{member.name}</h3>
                <span className="muted">@{member.username}</span>
                <div className="team-consumption">
                  <span>Consumo personal</span>
                  <strong>
                    {account
                      ? money(account.calculated_total, account.currency)
                      : "Sin consumo"}
                  </strong>
                </div>
                {account && (
                  <button
                    className="btn secondary"
                    onClick={() =>
                      open({
                        type: "account",
                        id: account.id,
                        tab: "consumption",
                      })
                    }
                  >
                    <ClipboardList size={16} /> Ver consumo
                  </button>
                )}
                {member.id !== user.id &&
                  member.role === "waiter" &&
                  member.active && (
                    <div className="team-actions">
                      <button
                        className="icon-btn danger-text"
                        aria-label={`Eliminar acceso de ${member.name}`}
                        onClick={() => setRemoving(member.id)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  )}
                {removing === member.id && (
                  <div className="delete-confirm">
                    <p>
                      Eliminar el acceso de {member.name}? Su historial se
                      conservará.
                    </p>
                    <div>
                      <button
                        className="btn secondary"
                        onClick={() => setRemoving(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        className="btn danger"
                        disabled={busy}
                        onClick={() => remove(member.id)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function UserForm({ close }: { close: () => void }) {
  const { refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/users", "POST", Object.fromEntries(new FormData(event.currentTarget)));
      refresh(); close(); toast("Mesero creado");
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Crear mesero" close={close}>
    <form className="form-stack" onSubmit={submit}>
      <label>Nombre<input name="name" required maxLength={100} autoFocus /></label>
      <label>Identificador<input aria-label="Identificador" name="username" required pattern="[a-z0-9_.-]{3,40}" minLength={3} maxLength={40} placeholder="Ej. mesero2" />
        <small>Letras minúsculas y números. Debe ser único.</small>
      </label>
      {error && <ErrorBox message={error} />}
      <Submit busy={busy}>Crear mesero</Submit>
    </form>
  </Modal>;
}

function AuditPage() {
  const { config, open } = useApp();
  const [before, setBefore] = useState<number | undefined>();
  const [filters, setFilters] = useState<ReportFilter>({
    from: "",
    to: "",
    seller: "",
  });
  const [tab, setTab] = useState("actions");
  const { data, error, retry } = useLoad<{ rows: Audit[]; has_more: boolean }>(
    `/audit?${reportQuery(filters)}${before ? `&before=${before}` : ""}`,
  );
  return (
    <>
      <PageHeading
        eyebrow="CADA MOVIMIENTO TIENE SU HISTORIA"
        title="Todo queda registrado."
        text="Quién hizo cada cambio. Cuándo ocurrió. Qué había antes."
      />
      <div className="tabs" role="tablist" aria-label="Historial">
        {[
          ["actions", "Acciones"],
          ["invoices", "Facturas"],
          ["movements", "Movimientos"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <ReportFilters
        value={filters}
        change={(next) => {
          setFilters(next);
          setBefore(undefined);
        }}
      />
      {tab === "invoices" && <SalesPage embedded filters={filters} />}
      {tab === "movements" && <MovementsPage filters={filters} />}
      {tab === "actions" && (
        <>
          {before && (
            <button className="text-btn" onClick={() => setBefore(undefined)}>
              <ArrowLeft size={16} /> Volver a lo más reciente
            </button>
          )}
          {error && <FetchError message={error} retry={retry} />}
          {!data ? (
            <Loading />
          ) : (
            <div className="audit-list">
              {data.rows.map((row) => (
                <details key={row.id} className="audit-row">
                  <summary>
                    <span className="audit-icon">
                      <History size={19} />
                    </span>
                    <div>
                      <strong>{row.action}</strong>
                      <span>
                        {row.actor_name} ·{" "}
                        {date(row.created_at, config.timezone)}
                      </span>
                    </div>
                    <Plus size={18} />
                  </summary>
                  <div className="audit-detail">
                    <div>
                      <h4>Antes</h4>
                      <HistoryValue value={row.before_value} config={config} />
                    </div>
                    <div>
                      <h4>Después</h4>
                      <HistoryValue value={row.after_value} config={config} />
                    </div>
                  </div>
                  {row.entity_id &&
                    /Cliente|cliente|Consumo|consumo|Precio final/.test(
                      row.action,
                    ) && (
                      <button
                        className="text-btn audit-link"
                        onClick={() =>
                          open({
                            type: "account",
                            id: row.entity_id!,
                            tab: "consumption",
                          })
                        }
                      >
                        Consultar cuenta <ArrowRight size={15} />
                      </button>
                    )}
                </details>
              ))}
              {!data.rows.length && (
                <Empty
                  title="Sin movimientos todavía"
                  text="Aquí aparecerán las acciones del equipo."
                />
              )}
            </div>
          )}
          {data?.has_more && (
            <button
              className="btn secondary load-more"
              onClick={() => setBefore(data.rows.at(-1)!.id)}
            >
              Ver movimientos anteriores
            </button>
          )}
        </>
      )}
    </>
  );
}

type ReportFilter = { from: string; to: string; seller: string };
const reportQuery = (filters: ReportFilter) =>
  new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value),
  ).toString();
function ReportFilters({
  value,
  change,
}: {
  value: ReportFilter;
  change: (value: ReportFilter) => void;
}) {
  const { user } = useApp();
  const { data: sellers } =
    useLoad<{ id: string; name: string; active: boolean }[]>("/report-sellers");
  return (
    <div className="report-filters">
      <label>
        Desde
        <input
          type="date"
          value={value.from}
          onChange={(e) => change({ ...value, from: e.target.value })}
        />
      </label>
      <label>
        Hasta
        <input
          type="date"
          min={value.from || undefined}
          value={value.to}
          onChange={(e) => change({ ...value, to: e.target.value })}
        />
      </label>
      {user.role === "admin" && (
        <label>
          Vendedor
          <select
            aria-label="Vendedor"
            value={value.seller}
            onChange={(e) => change({ ...value, seller: e.target.value })}
          >
            <option value="">Todos los vendedores</option>
            {sellers?.map((seller) => (
              <option key={seller.id} value={seller.id}>
                {seller.name}
                {seller.active ? "" : " · Inactivo"}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        className="btn secondary"
        onClick={() => change({ from: "", to: "", seller: "" })}
      >
        Limpiar filtros
      </button>
    </div>
  );
}
type SalesReport = {
  totals: {
    currency: string;
    accounts: number;
    total: number;
    calculated: number;
    received: number;
    change: number;
    cash_net: number;
    unrecorded: number;
  }[];
  daily: {
    day: string;
    currency: string;
    accounts: number;
    total: number;
    cash_net: number;
  }[];
  sellers: {
    id: string;
    name: string;
    currency: string;
    accounts: number;
    total: number;
    cash_net: number;
  }[];
  rows: {
    id: string;
    name: string;
    closed_at: string;
    seller_name: string;
    currency: string;
    final_total: number;
    cash_received: number | null;
    cash_change: number | null;
    invoice_id: number;
  }[];
  has_more: boolean;
};
function SalesPage({
  cashFlow = false,
  embedded = false,
  filters: external,
}: {
  cashFlow?: boolean;
  embedded?: boolean;
  filters?: ReportFilter;
}) {
  const { config, open } = useApp();
  const today = localTime(new Date().toISOString(), config.timezone).slice(
    0,
    10,
  );
  const [filters, setFilters] = useState<ReportFilter>({
    from: today,
    to: today,
    seller: "",
  });
  const [offset, setOffset] = useState(0);
  const query = reportQuery(external ?? filters);
  useEffect(() => setOffset(0), [query]);
  const { data, error, retry } = useLoad<SalesReport>(
    `/${cashFlow ? "cash-flow" : "sales"}?${query}&offset=${offset}`,
  );
  return (
    <>
      {!embedded && (
        <PageHeading
          eyebrow={cashFlow ? "COBROS DEL BAR" : "TU TURNO EN NÚMEROS"}
          title={cashFlow ? "Flujo de efectivo" : "Mis ventas"}
          text="Ventas atribuidas al vendedor que cobró la cuenta. Fechas según Costa Rica."
        />
      )}
      {!embedded && <ReportFilters value={filters} change={setFilters} />}
      {error && <FetchError message={error} retry={retry} />}
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <div className="report-summary">
            {data.totals.map((total) => (
              <section className="report-card" key={total.currency}>
                <span>
                  Ventas · {total.accounts} cuentas · {total.currency}
                </span>
                <strong>{money(total.total, total.currency)}</strong>
                <dl>
                  <div>
                    <dt>Total calculado</dt>
                    <dd>{money(total.calculated, total.currency)}</dd>
                  </div>
                  <div>
                    <dt>Efectivo recibido</dt>
                    <dd>{money(total.received, total.currency)}</dd>
                  </div>
                  <div>
                    <dt>Vuelto entregado</dt>
                    <dd>{money(total.change, total.currency)}</dd>
                  </div>
                  <div>
                    <dt>Efectivo neto registrado</dt>
                    <dd>{money(total.cash_net, total.currency)}</dd>
                  </div>
                </dl>
                {total.unrecorded > 0 && (
                  <p className="muted">
                    {total.unrecorded} cuentas antiguas sin registro de
                    efectivo.
                  </p>
                )}
              </section>
            ))}
          </div>
          {cashFlow && (
            <>
              <p className="muted">
                El efectivo neto es lo recibido menos el vuelto entregado. Las
                correcciones del total no cambian el efectivo ya registrado. No
                incluye gastos ni retiros de caja.
              </p>
              <section className="report-section">
                <h2>Ventas diarias</h2>
                <div className="report-table-scroll">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Fecha de cobro</th>
                        <th>Cuentas</th>
                        <th>Ventas</th>
                        <th>Efectivo neto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.daily.map((row) => (
                        <tr key={row.day + row.currency}>
                          <td>{row.day.split("-").reverse().join("/")}</td>
                          <td>{row.accounts}</td>
                          <td>{money(row.total, row.currency)}</td>
                          <td>{money(row.cash_net, row.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="report-section">
                <h2>Ventas por vendedor</h2>
                <div className="report-table-scroll">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Vendedor que cobró</th>
                        <th>Cuentas</th>
                        <th>Ventas</th>
                        <th>Efectivo neto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sellers.map((row) => (
                        <tr key={row.id + row.currency}>
                          <td>{row.name}</td>
                          <td>{row.accounts}</td>
                          <td>{money(row.total, row.currency)}</td>
                          <td>{money(row.cash_net, row.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          <section className="report-section">
            <h2>Facturas</h2>
            <div className="sales-list">
              {data.rows.map((row) => (
                <article className="sales-row" key={row.id}>
                  <div>
                    <h3>{row.name}</h3>
                    <p>
                      {row.seller_name} · {date(row.closed_at, config.timezone)}
                    </p>
                    <small>Factura #{row.invoice_id}</small>
                  </div>
                  <strong>{money(row.final_total, row.currency)}</strong>
                  <button
                    className="btn secondary"
                    onClick={() =>
                      open({ type: "account", id: row.id, tab: "close" })
                    }
                  >
                    <ReceiptText size={17} /> Ver factura
                  </button>
                </article>
              ))}
            </div>
            {!data.rows.length && (
              <Empty
                title="Sin ventas en este intervalo"
                text="Cambia las fechas o el vendedor para consultar otras cuentas."
              />
            )}
          </section>
          <div className="report-pagination">
            <button
              className="btn secondary"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              Anterior
            </button>
            <span>Página {offset / 100 + 1}</span>
            <button
              className="btn secondary"
              disabled={!data.has_more}
              onClick={() => setOffset(offset + 100)}
            >
              Siguiente
            </button>
          </div>
        </>
      )}
    </>
  );
}
function MovementsPage({ filters }: { filters: ReportFilter }) {
  const { config, open } = useApp();
  const [offset, setOffset] = useState(0);
  const query = reportQuery(filters);
  useEffect(() => setOffset(0), [query]);
  const { data, error, retry } = useLoad<{
    rows: {
      id: number;
      product_name: string;
      seller_name: string;
      account_name: string | null;
      account_id: string | null;
      kind: string | null;
      reason: string;
      created_at: string;
      delta: number;
      stock_before: number;
      stock_after: number;
    }[];
    has_more: boolean;
  }>(`/movements?${query}&offset=${offset}`);
  return (
    <>
      {error && <FetchError message={error} retry={retry} />}
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <div className="sales-list">
            {data.rows.map((row) => (
              <article className="sales-row" key={row.id}>
                <div>
                  <h3>{row.product_name}</h3>
                  <p>
                    {row.seller_name} · {date(row.created_at, config.timezone)}
                  </p>
                  <small>
                    {row.kind === "personal"
                      ? "Consumo personal"
                      : row.account_name || "Ajuste de inventario"}{" "}
                    · {row.reason}
                  </small>
                </div>
                <strong>
                  {row.delta > 0 ? "+" : ""}
                  {row.delta} unidades
                  <small>
                    Existencias: {row.stock_before} → {row.stock_after}
                  </small>
                </strong>
                {row.account_id && (
                  <button
                    className="btn secondary"
                    onClick={() =>
                      open({
                        type: "account",
                        id: row.account_id!,
                        tab: "consumption",
                      })
                    }
                  >
                    Ver consumo
                  </button>
                )}
              </article>
            ))}
          </div>
          {!data.rows.length && (
            <Empty
              title="Sin movimientos en este intervalo"
              text="Cambia los filtros para consultar otros movimientos."
            />
          )}
          <div className="report-pagination">
            <button
              className="btn secondary"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              Anterior
            </button>
            <span>Página {offset / 100 + 1}</span>
            <button
              className="btn secondary"
              disabled={!data.has_more}
              onClick={() => setOffset(offset + 100)}
            >
              Siguiente
            </button>
          </div>
        </>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeToggle />
    <App />
  </React.StrictMode>,
);
