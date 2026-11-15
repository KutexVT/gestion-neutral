import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Plus, RefreshCw, Settings2 } from "lucide-react";
import { api, date, localTime, money, parseMoney } from "./api";
import { CashCounter } from "./cash-counter";
import { cashGroups, cashTotal, cashQuantity, type CashCounts } from "./cash-count";
import { paymentNames } from "./payments";
import { ErrorBox, Loading, Submit } from "./ui";
import { HistoryValue } from "./history";
import type { Config } from "./types";
import "./register.css";

type Methods = { cash: number; sinpe: number; card: number };
type Summary = {
  fingerprint: string; period: {from: string; to: string}; currency: string; timezone: string;
  cost?: number | null; profit?: number | null; missing_cost_units?: number;
  total: number; calculated: number; collected: Methods; movements: Methods; unclassified: number;
  sales: { id: string; name: string; seller_name: string; paid_at: string; calculated_total: number; final_total: number;
    payment_cash: number | null; payment_sinpe: number | null; payment_card: number | null; invoice_id: number;
    cost?: number | null; profit?: number | null; missing_cost_units?: number;
    items: { product: string; quantity: number; unit_price: number; waiter: string }[] }[];
  sellers: {name: string; accounts: number; sales: number; cash: number; sinpe: number; card: number}[];
  entries: {id: string; occurred_at: string; actor_name: string; method: keyof Methods; direction: string; amount: number; reason: string; reverses: string | null}[];
  pending: {id: string; name: string; calculated_total: number; currency: string; seller_name: string}[];
  events: {id: number; action: string; actor_name: string; created_at: string; before_value: unknown; after_value: unknown}[];
  more_events: boolean;
  personal_total?: number;
  personal?: { id: number; account_id: string; created_at: string; person_name: string; person_role: string; actor_name: string;
    total: number; items: {product: string; quantity: number; unit_price: number}[] }[];
};
type Closing = { id: string; created_at: string; actor_name: string; period_from: string; period_to: string;
  currency: string; opening: number; actual_cash: number; actual_sinpe: number | null; actual_card: number | null;
  expected_cash: number; difference_cash: number; note: string; count: Record<string,number>; snapshot: Summary; supersedes: string | null };
const methods = ["cash","sinpe","card"] as const;
function difference(value: number, currency: string) {
  return value === 0 ? "Cuadra" : `${value < 0 ? "Faltan" : "Sobran"} ${money(Math.abs(value),currency)}`;
}
function Reconciliation({ summary, opening, actual }: {summary: Summary; opening: number; actual: {cash: number | null; sinpe: number | null; card: number | null}}) {
  return <div className="report-table-scroll"><table className="report-table reconciliation">
    <caption>Comparación del dinero</caption><thead><tr><th>Medio</th><th>Esperado</th><th>Contado / verificado</th><th>Diferencia</th></tr></thead>
    <tbody>{methods.map(method => {
      const expected = summary.collected[method]+summary.movements[method]+(method === "cash" ? opening : 0);
      return <tr key={method}><th scope="row">{paymentNames[method]}</th><td data-label="Esperado">{money(expected,summary.currency)}</td><td data-label="Verificado">{actual[method] === null ? "Sin verificar" : money(actual[method],summary.currency)}</td>
        <td data-label="Diferencia">{actual[method] === null ? "Pendiente" : difference(actual[method]-expected,summary.currency)}</td></tr>;
    })}</tbody>
  </table></div>;
}
function SummaryDetails({ data, openAccount, editable, reverse }: { data: Summary; openAccount: (id: string) => void; editable: boolean; reverse: (id: string) => void }) {
  const m = (v: number) => money(v,data.currency);
  return <div className="register-details">
    <div className="register-overview"><div><span>Ventas facturadas</span><strong>{m(data.total)}</strong></div><div><span>Cobros registrados</span><strong>{m(data.collected.cash+data.collected.sinpe+data.collected.card)}</strong></div><div><span>Cuentas pendientes</span><strong>{data.pending.length}</strong></div></div>
    <div className="register-overview"><div><span>Costo de productos vendidos</span><strong>{data.cost == null ? "Pendiente" : m(data.cost)}</strong></div><div><span>Ganancia bruta</span><strong>{data.profit == null ? "Pendiente" : m(data.profit)}</strong></div></div>
    <p className="muted">Ganancia bruta = venta final − costo guardado de los productos vendidos. Excluye gastos del negocio y consumo personal. {(data.missing_cost_units ?? 0) > 0 ? `${data.missing_cost_units} unidades vendidas no tienen costo registrado.` : data.cost === undefined ? "Este cierre se guardó antes de registrar costos." : ""}</p>
    {data.unclassified > 0 && <ErrorBox message={`${data.unclassified} cuentas antiguas tienen el pago sin clasificar. El esperado está incompleto hasta revisar esos cobros.`} />}
    <p className="muted">Se usa la fecha del cobro original. El total facturado y el dinero registrado pueden diferir después de una corrección. Las cuentas pendientes y el consumo personal no suman cobros.</p>
    <details><summary>Ventas y facturas ({data.sales.length})</summary>
      {!data.sales.length && <p>Sin ventas cobradas en este intervalo</p>}
      {data.sales.map(s => <article className="register-row" key={s.id}>
        <div className="register-row-heading"><div><h3>{s.name}</h3><p>{s.seller_name} · {date(s.paid_at,data.timezone)}</p></div><strong>{m(s.final_total)}</strong></div>
        <p>Calculado: {m(s.calculated_total)} · Factura #{s.invoice_id}</p>
        <p>Costo: {s.cost == null ? "Pendiente" : m(s.cost)} · Ganancia bruta: {s.profit == null ? "Pendiente" : m(s.profit)}</p>
        <p>{s.payment_cash === null ? "Pago sin clasificar" : methods.map(method => `${paymentNames[method]}: ${m(s[`payment_${method}`] ?? 0)}`).join(" · ")}</p>
        <ul>{s.items.map((item,index) => <li key={index}>{item.quantity} × {item.product} · {m(item.unit_price)} · Entregó {item.waiter}</li>)}</ul>
        <button className="btn secondary" onClick={() => openAccount(s.id)}>{editable ? "Ver cuenta / corregir" : "Consultar cuenta actual"}</button>
      </article>)}
    </details>
    <details><summary>Ventas por vendedor</summary><div className="report-table-scroll"><table className="report-table"><thead><tr><th>Vendedor que cobró</th><th>Cuentas</th><th>Ventas</th><th>Efectivo</th><th>SINPE</th><th>Tarjeta</th></tr></thead><tbody>{data.sellers.map((s,i) => <tr key={i}><td>{s.name}</td><td>{s.accounts}</td><td>{m(s.sales)}</td><td>{m(s.cash)}</td><td>{m(s.sinpe)}</td><td>{m(s.card)}</td></tr>)}</tbody></table></div></details>
    <details><summary>Consumo personal ({data.personal?.length ?? 0})</summary>
      {data.personal ? <>
        <p className="muted">Incluye al dueño y los meseros. Muestra los productos registrados y las correcciones hechas en este intervalo. Las cantidades negativas devuelven inventario. Se valora al precio registrado y no suma ventas ni modifica el efectivo esperado.</p>
        <p><strong>Valor neto del consumo: {m(data.personal_total ?? 0)}</strong></p>
        {!data.personal.length && <p>Sin consumo personal en este intervalo</p>}
        {data.personal.map(p => <article className="register-row" key={p.id}>
          <div className="register-row-heading"><div><h3>{p.person_name} · {p.person_role === "admin" ? "Dueño" : "Mesero"}</h3><p>{date(p.created_at,data.timezone)} · Registró {p.actor_name}</p></div><strong>{m(p.total)}</strong></div>
          <ul>{p.items.map((item,index) => <li key={index}>{item.quantity} × {item.product} · {m(item.unit_price)}</li>)}</ul>
          <button className="btn secondary" onClick={() => openAccount(p.account_id)}>{editable ? "Ver consumo / corregir" : "Consultar consumo actual"}</button>
        </article>)}
      </> : <p>Este cierre se guardó antes de incluir el detalle de consumo personal. Crea una revisión para consultarlo.</p>}
    </details>
    <details><summary>Entradas y salidas adicionales ({data.entries.length})</summary>
      <p className="muted">Incluye gastos · retiros · aportes · devoluciones. Las ventas ya están incluidas arriba.</p>
      {data.entries.map(e => <article className="register-row" key={e.id}><strong>{e.direction === "in" ? "Entrada" : "Salida"} · {m(e.amount)} · {paymentNames[e.method]}</strong><p>{e.reason}</p><p>{date(e.occurred_at,data.timezone)} · {e.actor_name}</p>
        {e.reverses ? <small>Anulación de un movimiento anterior</small> : data.entries.some(x => x.reverses === e.id) ? <small>Anulado con contrapartida</small> : editable && <button className="btn secondary" onClick={() => reverse(e.id)}>Anular movimiento</button>}
      </article>)}
    </details>
    <details><summary>Cuentas pendientes al corte ({data.pending.length})</summary>{data.pending.map(p => <div className="register-row" key={p.id}><strong>{p.name} · {money(p.calculated_total,p.currency)}</strong><p>{p.seller_name}</p><button className="btn secondary" onClick={() => openAccount(p.id)}>Ver cuenta</button></div>)}</details>
    <details><summary>Actividad del intervalo ({data.events.length}{data.more_events ? "+" : ""})</summary>
      {data.events.map(e => <details key={e.id} className="register-event"><summary>{e.action} · {e.actor_name} · {date(e.created_at,data.timezone)}</summary><div className="register-event-values"><div><h4>Antes</h4><HistoryValue value={e.before_value} config={{name:"",currency:data.currency,timezone:data.timezone}} /></div><div><h4>Después</h4><HistoryValue value={e.after_value} config={{name:"",currency:data.currency,timezone:data.timezone}} /></div></div></details>)}
      {data.more_events && <p>Se muestran los últimos 500 eventos. Consulta Historial para revisar los anteriores.</p>}
    </details>
  </div>;
}

export function CashRegister({ config, revision, counts, setCounts, openAccount }: {config: Config; revision: number; counts: CashCounts; setCounts: (counts: CashCounts) => void; openAccount: (id: string) => void}) {
  const [view,setView] = useState<"history" | "draft" | "saved">("history");
  const [settings,setSettings] = useState({day_start:"00:00",opening_default:null as number | null,period_from:""});
  const [settingsOpen,setSettingsOpen] = useState(false);
  const [settingFloat,setSettingFloat] = useState("");
  const [from,setFrom] = useState(""); const [to,setTo] = useState("");
  const [opening,setOpening] = useState(""); const [sinpe,setSinpe] = useState(""); const [card,setCard] = useState(""); const [note,setNote] = useState("");
  const [summary,setSummary] = useState<Summary | null>(null);
  const [selected,setSelected] = useState<Closing | null>(null);
  const [revising,setRevising] = useState<Closing | null>(null);
  const [confirmation,setConfirmation] = useState<any>(null);
  const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  const [rows,setRows] = useState<Closing[]>([]); const [more,setMore] = useState(false); const [offset,setOffset] = useState(0);
  const [historyFrom,setHistoryFrom] = useState(""); const [historyTo,setHistoryTo] = useState(""); const [loaded,setLoaded] = useState(false);
  const [reload,setReload] = useState(0);
  const [movement,setMovement] = useState(false); const [reverseId,setReverseId] = useState<string | null>(null);
  const [moveMethod,setMoveMethod] = useState<keyof Methods>("cash"); const [moveDirection,setMoveDirection] = useState("out");
  const [moveAmount,setMoveAmount] = useState(""); const [moveReason,setMoveReason] = useState(""); const [moveAt,setMoveAt] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    api<typeof settings>("/register/settings","GET",undefined,abort.signal).then(s => { setSettings(s); setSettingFloat(s.opening_default === null ? "" : String(s.opening_default/100)); }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  },[reload]);
  useEffect(() => {
    const abort = new AbortController();
    api<{rows:Closing[];has_more:boolean}>(`/register/closings?offset=${offset}${historyFrom ? `&from=${historyFrom}` : ""}${historyTo ? `&to=${historyTo}` : ""}`,"GET",undefined,abort.signal)
      .then(r => { setRows(r.rows);setMore(r.has_more);setLoaded(true); }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  },[revision,reload,offset,historyFrom,historyTo]);
  const invalidate = () => { setSummary(null);setConfirmation(null); };
  async function preview() {
    setBusy(true);setError("");setConfirmation(null);
    try { setSummary(await api("/register/preview","POST",revising ? {from:revising.period_from,to:revising.period_to} : {from,...(to ? {to} : {})})); }
    catch(e:any) {setError(e.message);setSummary(null);} finally {setBusy(false);}
  }
  async function saveSettings(e: FormEvent) {
    e.preventDefault();setBusy(true);setError("");
    try {await api("/register/settings","PUT",{day_start:settings.day_start,opening_default:settingFloat.trim() ? parseMoney(settingFloat) : null});setSettingsOpen(false);setReload(x=>x+1);} catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  async function saveMovement(e: FormEvent) {
    e.preventDefault();setBusy(true);setError("");
    try {
      if(reverseId) await api(`/register/entries/${reverseId}/reverse`,"POST",{reason:moveReason});
      else await api("/register/entries","POST",{method:moveMethod,direction:moveDirection,amount:parseMoney(moveAmount),reason:moveReason,occurred_at:moveAt});
      setMovement(false);setReverseId(null);setMoveReason("");setMoveAmount("");invalidate();
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  function start(previous: Closing | null = null) {
    setRevising(previous);setSelected(null);setView("draft");invalidate();setError("");setMovement(false);
    setFrom(previous ? localTime(previous.period_from,config.timezone) : settings.period_from);
    setTo(previous ? localTime(previous.period_to,config.timezone) : "");
    setOpening(previous ? String(previous.opening/100) : settings.opening_default === null ? "" : String(settings.opening_default/100));
    setSinpe(previous?.actual_sinpe == null ? "" : String(previous.actual_sinpe/100));
    setCard(previous?.actual_card == null ? "" : String(previous.actual_card/100));setNote("");
    if(previous) setCounts(Object.fromEntries(Object.entries(previous.count).map(([k,v])=>[k,String(v)])));
  }
  const total = cashTotal(cashGroups.flatMap(g => [...g.values]),counts);
  let actual: {cash:number|null;sinpe:number|null;card:number|null} = {cash:total === null ? null : total*100,sinpe:null,card:null};
  let openingValue: number | null = null;
  try { openingValue = opening.trim() ? parseMoney(opening) : null; actual.sinpe = sinpe.trim() ? parseMoney(sinpe) : null; actual.card = card.trim() ? parseMoney(card) : null; } catch {}
  function review(e: FormEvent) {
    e.preventDefault();setError("");
    try {
      if (!summary || total === null) throw new Error("Actualiza el resumen y revisa las cantidades del conteo");
      if (!opening.trim()) throw new Error("Indica el fondo inicial. Usa 0 solo si empezaste sin efectivo");
      setConfirmation({ period: summary.period,fingerprint:summary.fingerprint,opening:parseMoney(opening),
        counts:Object.fromEntries(cashGroups.flatMap(g=>[...g.values]).map(v=>[v,cashQuantity(counts[v])])),
        actual_sinpe:sinpe.trim() ? parseMoney(sinpe) : null,actual_card:card.trim() ? parseMoney(card) : null,
        note,supersedes:revising?.id ?? null,confirmed:true });
    }catch(e:any){setError(e.message);}
  }
  async function save() {
    setBusy(true);setError("");
    try { const result = await api<Closing>("/register/closings","POST",confirmation);setSelected(result);setView("saved");setConfirmation(null);setReload(x=>x+1); }
    catch(e:any){setError(e.message);setConfirmation(null);}finally{setBusy(false);}
  }
  async function show(id:string) {
    setBusy(true);setError("");
    try {setSelected(await api(`/register/closings/${id}`));setView("saved");}catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  return <section className="register-page">
    <header className="cash-heading"><div><h1>Cierre de caja</h1><p>Compara el dinero contado con los cobros y guarda cada revisión</p></div>
      {view === "history" ? <button className="btn primary" disabled={!settings.period_from || busy} onClick={()=>start()}><Plus size={18}/> Nuevo cierre</button> : <button className="btn secondary" disabled={busy} onClick={()=>{setView("history");setError("");setConfirmation(null);}}><ArrowLeft size={18}/> Historial de cierres</button>}
    </header>
    {error && <ErrorBox message={error}/>}
    {view === "history" && <>
      <p className="muted">Cada cierre es una revisión independiente. Varias revisiones del mismo día no se suman como ingresos.</p>
      <button className="btn secondary" onClick={()=>setSettingsOpen(!settingsOpen)}><Settings2 size={17}/> Configurar horario y fondo</button>
      {settingsOpen && <form className="form-stack register-section" onSubmit={saveSettings}>
        <h2>Valores para nuevos cierres</h2><p className="muted">Hasta definir el horario se propone medianoche. Puedes cambiar el intervalo en cada cierre. El fondo es el dinero que ya había antes de las ventas.</p>
        <label>Inicio del día de trabajo<input type="time" required value={settings.day_start} onChange={e=>setSettings({...settings,day_start:e.target.value})}/></label>
        <label>Fondo inicial habitual ({config.currency})<input inputMode="decimal" placeholder="Sin definir" value={settingFloat} onChange={e=>setSettingFloat(e.target.value)}/></label><Submit busy={busy}>Guardar configuración</Submit>
      </form>}
      <div className="register-filters"><label>Desde<input type="date" value={historyFrom} onChange={e=>{setHistoryFrom(e.target.value);setOffset(0);}}/></label><label>Hasta<input type="date" value={historyTo} onChange={e=>{setHistoryTo(e.target.value);setOffset(0);}}/></label></div>
      {!loaded ? <Loading/> : !rows.length ? <div className="register-empty"><h2>Aún no hay cierres en este intervalo</h2><p>Cuenta el efectivo y guarda tu primera revisión</p></div> : rows.map(row=><article className="register-row" key={row.id}>
        <div className="register-row-heading"><div><h2>{difference(row.difference_cash,row.currency)}</h2><p>{date(row.period_from,config.timezone)} → {date(row.period_to,config.timezone)}</p></div><button className="btn secondary" disabled={busy} onClick={()=>show(row.id)}>Ver cierre</button></div>
        <p>Efectivo esperado {money(row.expected_cash,row.currency)} · Contado {money(row.actual_cash,row.currency)}</p><small>{row.actor_name} · Guardado {date(row.created_at,config.timezone)}{row.supersedes && " · Revisión de un cierre anterior"}</small>
      </article>)}
      <div className="report-pagination"><button className="btn secondary" disabled={!offset || busy} onClick={()=>setOffset(Math.max(0,offset-50))}>Anterior</button><span>Página {offset/50+1}</span><button className="btn secondary" disabled={!more || busy} onClick={()=>setOffset(offset+50)}>Siguiente</button></div>
    </>}
    {view === "draft" && <>
      {!confirmation && <>
        <div className="register-filters"><label>Desde · Costa Rica<input type="datetime-local" required disabled={!!revising} value={from} onChange={e=>{setFrom(e.target.value);invalidate();}}/></label><label>Hasta · vacío = ahora<input type="datetime-local" disabled={!!revising} value={to} onChange={e=>{setTo(e.target.value);invalidate();}}/></label>
          <button className="btn secondary" disabled={busy || !from} onClick={preview}><RefreshCw size={17}/> Actualizar resumen</button></div>
        <p className="muted">Detén los cobros mientras cuentas el efectivo. El corte queda fijado al actualizar el resumen. Una revisión no bloquea las ventas posteriores.</p>
        {revising && <p>Estás creando una nueva revisión del mismo intervalo. El cierre anterior se conserva.</p>}
        <button className="btn secondary" onClick={()=>{setMovement(!movement);setReverseId(null);setMoveAt(localTime(new Date().toISOString(),config.timezone));}}>Registrar entrada o salida</button>
        {movement && <form className="form-stack register-section" onSubmit={saveMovement}><h2>{reverseId ? "Anular movimiento" : "Movimiento adicional"}</h2>
          {!reverseId && <><div className="register-filters"><label>Tipo<select value={moveDirection} onChange={e=>setMoveDirection(e.target.value)}><option value="out">Salida</option><option value="in">Entrada</option></select></label><label>Medio<select value={moveMethod} onChange={e=>setMoveMethod(e.target.value as keyof Methods)}>{methods.map(m=><option key={m} value={m}>{paymentNames[m]}</option>)}</select></label></div>
          <label>Importe ({config.currency})<input required inputMode="decimal" value={moveAmount} onChange={e=>setMoveAmount(e.target.value)}/></label><label>Fecha del movimiento · Costa Rica<input required type="datetime-local" value={moveAt} onChange={e=>setMoveAt(e.target.value)}/></label></>}
          <label>Motivo<textarea required minLength={3} maxLength={500} value={moveReason} onChange={e=>setMoveReason(e.target.value)}/></label><Submit busy={busy}>{reverseId ? "Confirmar anulación" : "Guardar movimiento"}</Submit></form>}
        {summary && <><p className="register-cutoff">Corte: {date(summary.period.to,config.timezone)} · {config.timezone}</p><SummaryDetails data={summary} openAccount={openAccount} editable reverse={id=>{setReverseId(id);setMovement(true);setMoveReason("");window.scrollTo({top:0,behavior:"instant"});}}/>
          <form className="form-stack register-section" onSubmit={review}>
            <label>Fondo inicial de este intervalo ({config.currency})<input required inputMode="decimal" placeholder="Indica cuánto había antes de las ventas" value={opening} onChange={e=>setOpening(e.target.value)}/></label>
            <p className="muted">Si no había dinero inicial indica 0. Si no conoces el fondo averígualo antes de guardar para evitar una diferencia incorrecta.</p>
            <CashCounter counts={counts} onChange={setCounts} embedded/>
            <div className="register-filters"><label>SINPE verificado en el intervalo ({config.currency})<input inputMode="decimal" placeholder="Sin verificar" value={sinpe} onChange={e=>setSinpe(e.target.value)}/></label><label>Tarjeta verificada en el intervalo ({config.currency})<input inputMode="decimal" placeholder="Sin verificar" value={card} onChange={e=>setCard(e.target.value)}/></label></div>
            <p className="muted">Consulta los cobros del intervalo en el banco o la terminal. No escribas el saldo completo de la cuenta. Dejar vacío significa que aún no lo verificaste.</p>
            {openingValue !== null && <Reconciliation summary={summary} opening={openingValue} actual={actual}/>}
            <p className="muted">Efectivo esperado = fondo inicial + ventas en efectivo + entradas − salidas</p>
            <label>Observaciones<textarea maxLength={1000} value={note} placeholder="Explica las diferencias o lo que queda pendiente de revisar" onChange={e=>setNote(e.target.value)}/></label>
            <Submit busy={busy}>Revisar cierre de caja</Submit>
          </form></>}
      </>}
      {confirmation && summary && <section className="register-section"><h2>Confirmar cierre de caja</h2><p>Se guardará el conteo y este resumen del intervalo</p>
        <Reconciliation summary={summary} opening={confirmation.opening} actual={{cash:total!*100,sinpe:confirmation.actual_sinpe,card:confirmation.actual_card}}/>
        <p>{confirmation.note || "Sin observaciones"}</p><div className="form-footer"><button className="btn secondary" disabled={busy} onClick={()=>setConfirmation(null)}>Volver a revisar</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Confirmar y guardar cierre"}</button></div>
      </section>}
    </>}
    {view === "saved" && selected && <>
      <div className="register-row-heading"><div><h2>Cierre guardado</h2><p>{date(selected.period_from,config.timezone)} → {date(selected.period_to,config.timezone)}</p><p>{selected.actor_name} · {date(selected.created_at,config.timezone)}</p></div><button className="btn secondary" onClick={()=>start(selected)}>Crear revisión de este cierre</button></div>
      <p className="muted">Estos valores se conservaron al guardar. Consultar una cuenta abre su estado actual.</p>
      {selected.supersedes && <button className="text-btn" onClick={()=>show(selected.supersedes!)}>Ver cierre anterior</button>}
      <Reconciliation summary={selected.snapshot} opening={selected.opening} actual={{cash:selected.actual_cash,sinpe:selected.actual_sinpe,card:selected.actual_card}}/>
      <p>Fondo inicial: {money(selected.opening,selected.currency)}</p><p>{selected.note || "Sin observaciones"}</p>
      <details className="register-count"><summary>Conteo de billetes y monedas</summary>{Object.entries(selected.count).filter(([,n])=>n>0).map(([v,n])=><p key={v}>{n} × {money(Number(v)*100,"CRC")} = {money(Number(v)*n*100,"CRC")}</p>)}<strong>Total: {money(selected.actual_cash,"CRC")}</strong></details>
      <SummaryDetails data={selected.snapshot} openAccount={openAccount} editable={false} reverse={()=>{}}/>
    </>}
  </section>;
}
