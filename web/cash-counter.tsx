import { Banknote, Coins, RotateCcw, Minus, Plus } from "lucide-react";
import { cashGroups, cashMoney, cashQuantity, cashTotal, type CashCounts } from "./cash-count";
import "./cash-counter.css";

export function CashCounter({ counts, onChange }: { counts: CashCounts; onChange: (counts: CashCounts) => void }) {
  const total = cashTotal(cashGroups.flatMap(group => [...group.values]), counts);
  return <section className="cash-counter" aria-labelledby="cash-heading">
    <header className="cash-heading">
      <div><h1 id="cash-heading">Contar efectivo</h1><p>Indica cuántos billetes y monedas tienes. El total se calcula al momento.</p></div>
      <button className="btn secondary" disabled={!Object.values(counts).some(Boolean)} onClick={() => onChange({})}><RotateCcw size={17} /> Limpiar conteo</button>
    </header>
    <div className="cash-count-summary" role="status" aria-live="polite" aria-atomic="true">
      <span>Total contado</span>
      <output aria-label="Total contado">{total === null ? "Revisa las cantidades" : cashMoney(total)}</output>
      <small>Conteo independiente de las ventas · Colones costarricenses</small>
    </div>
    <div className="cash-groups">
      {cashGroups.map((group, index) => {
        const subtotal = cashTotal(group.values, counts);
        const Icon = index === 0 ? Banknote : Coins;
        return <section className="cash-group" key={group.name} aria-labelledby={`cash-group-${index}`}>
          <h2 id={`cash-group-${index}`}><Icon size={21} aria-hidden="true" />{group.name}</h2>
          <div className="cash-columns" aria-hidden="true"><span>Valor</span><span>Cantidad</span><span>Subtotal</span></div>
          {group.values.map(value => {
            const quantity = cashQuantity(counts[value]);
            const errorId = `cash-error-${value}`;
            return <div className="cash-row" key={value}>
              <strong>{cashMoney(value)}</strong>
              <div className="stepper cash-stepper">
                <button type="button" aria-label={`Quitar ${index === 0 ? "un billete" : "una moneda"} de ₡${value}`}
                  disabled={quantity === null || quantity === 0}
                  onClick={() => onChange({ ...counts, [value]: String(quantity! - 1) })}><Minus size={17} aria-hidden="true" /></button>
              <input type="text" inputMode="numeric" pattern="[0-9]*"
                aria-label={`Cantidad de ${group.singular} de ₡${value}`} placeholder="0" autoComplete="off"
                value={counts[value] ?? ""} aria-invalid={quantity === null}
                aria-describedby={quantity === null ? errorId : undefined}
                onChange={event => onChange({ ...counts, [value]: event.target.value })} />
                <button type="button" aria-label={`Agregar ${index === 0 ? "un billete" : "una moneda"} de ₡${value}`}
                  disabled={quantity === null || quantity >= 1000000}
                  onClick={() => onChange({ ...counts, [value]: String(quantity! + 1) })}><Plus size={17} aria-hidden="true" /></button>
              </div>
              <span className="cash-row-total">{quantity === null ? "—" : cashMoney(value * quantity)}</span>
              {quantity === null && <p className="cash-error" id={errorId}>Usa un número entero de 0 a 1 000 000</p>}
            </div>;
          })}
          <div className="cash-subtotal"><span>Total en {group.singular}</span><output aria-label={`Total en ${group.singular}`}>{subtotal === null ? "Revisa las cantidades" : cashMoney(subtotal)}</output></div>
        </section>;
      })}
    </div>
    <p className="cash-note">El conteo se conserva al cambiar de sección. Al recargar la página o cambiar de perfil empieza en cero.</p>
  </section>;
}
