import { useState, type FormEvent } from "react";
import { api, money, parseMoney } from "./api";
import { ErrorBox, Submit } from "./ui";
import type { Account } from "./types";
export const paymentNames = { cash: "Efectivo", sinpe: "SINPE", card: "Tarjeta" };
export type Payments = { cash: number; sinpe: number; card: number };
export type PaymentDraft = { mode: "cash" | "sinpe" | "card" | "mixed"; cash: string; sinpe: string; card: string; received: string | null };
export const newPayment: PaymentDraft = { mode: "cash", cash: "", sinpe: "", card: "", received: null };
export function readPayment(total: number, draft: PaymentDraft, checkTotal = true) {
  const payments: Payments = { cash: 0, sinpe: 0, card: 0 };
  if (draft.mode === "mixed") {
    for (const method of ["cash", "sinpe", "card"] as const) payments[method] = parseMoney(draft[method] || "0");
  } else payments[draft.mode] = total;
  if (checkTotal && payments.cash + payments.sinpe + payments.card !== total)
    throw new Error("La suma de efectivo, SINPE y tarjeta debe ser igual al total final");
  const received = parseMoney(draft.received ?? String(payments.cash/100));
  if (received < payments.cash) throw new Error("El efectivo recibido no alcanza para pagar la cuenta");
  return { payments, received, change: received-payments.cash };
}
export function PaymentFields({ total, currency, draft, onChange, correction = false }: {
  total: number; currency: string; draft: PaymentDraft; onChange: (value: PaymentDraft) => void; correction?: boolean;
}) {
  let result: ReturnType<typeof readPayment> | null = null;
  let error = "";
  try { result = readPayment(total, draft, !correction); } catch (e: any) { error = e.message; }
  const cashDue = draft.mode === "cash" ? total : draft.mode === "mixed" ? (() => { try { return parseMoney(draft.cash || "0"); } catch { return 0; } })() : 0;
  return <>
    {!correction && <label>Medio de pago<select aria-label="Medio de pago" value={draft.mode} onChange={e => onChange({ ...draft, mode: e.target.value as PaymentDraft["mode"], received: null })}>
      <option value="cash">Efectivo</option><option value="sinpe">SINPE</option><option value="card">Tarjeta</option><option value="mixed">Pago mixto</option>
    </select></label>}
    {draft.mode === "mixed" && <div className="payment-fields">
      {(["cash", "sinpe", "card"] as const).map(method => <label key={method}>{paymentNames[method]} aplicado ({currency})
        <input inputMode="decimal" placeholder="0" value={draft[method]} onChange={e => onChange({ ...draft, [method]: e.target.value })} /></label>)}
    </div>}
    {(cashDue > 0 || draft.mode === "cash" || correction) && <>
      <label>Efectivo recibido ({currency})<input inputMode="decimal" required value={draft.received ?? String(cashDue/100)} onChange={e => onChange({ ...draft, received: e.target.value })} /></label>
      <div className="totals" aria-live="polite"><span>Vuelto</span><strong>{result ? money(result.change, currency) : `Revisa el pago: ${error}`}</strong></div>
    </>}
    {draft.mode === "mixed" && <p className="muted" role="status">{result ? `Pago registrado: ${money(result.payments.cash+result.payments.sinpe+result.payments.card,currency)}` : error}</p>}
  </>;
}
export function PaymentCorrection({ account, saved }: { account: Account; saved: () => void }) {
  const [editing,setEditing] = useState(false);
  const [draft,setDraft] = useState<PaymentDraft>(newPayment);
  const [reason,setReason] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [baseVersion,setBaseVersion] = useState(account.version);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const result = readPayment(account.final_total!,draft,false);
      await api(`/accounts/${account.id}/payments`,"PATCH", { version: baseVersion, payments: result.payments, cash_received: result.received, reason });
      setEditing(false); saved();
    } catch(e: any) { setError(e.message); } finally { setBusy(false); }
  }
  if (!editing) return <button className="btn secondary" onClick={() => {
    setDraft({ mode:"mixed",cash:String((account.payment_cash ?? 0)/100),sinpe:String((account.payment_sinpe ?? 0)/100),card:String((account.payment_card ?? 0)/100),received:String((account.cash_received ?? 0)/100) });
    setBaseVersion(account.version); setReason(""); setError(""); setEditing(true);
  }}>Corregir pago registrado</button>;
  return <form className="form-stack" onSubmit={submit}>
    <h3>Corregir pago registrado</h3><p className="muted">Indica lo que realmente se cobró. Cambiar estos datos no registra un nuevo ingreso ni una devolución. Usa un movimiento de caja para un pago o reembolso posterior.</p>
    <PaymentFields total={account.final_total!} currency={account.currency} draft={draft} onChange={setDraft} correction />
    <label>Motivo de la corrección<textarea required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
    {error && <ErrorBox message={error} />}
    <div className="form-footer"><button type="button" className="btn secondary" onClick={() => setEditing(false)}>Cancelar</button><Submit busy={busy}>Guardar pago corregido</Submit></div>
  </form>;
}
