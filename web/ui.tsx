import { useEffect, useRef, type ReactNode } from "react";
import { ClipboardList, AlertCircle, X, LoaderCircle, CircleCheck } from "lucide-react";

export function Modal({
  title,
  subtitle,
  children,
  close,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      el.close();
      document.body.style.overflow = old;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
    >
      <header className="modal-header">
        <div>
          <p className="eyebrow">{subtitle || "DETALLE"}</p>
          <h2 id="modal-title">{title}</h2>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Cerrar ventana"
          onClick={close}
        >
          <X />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export const Loading = () => (
  <div className="loading" role="status">
    <LoaderCircle className="spin" /> Un momento…
  </div>
);
export function ErrorBox({
  message,
  children,
}: {
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={19} />
      <div>
        {message}
        {children}
      </div>
    </div>
  );
}
export function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <ClipboardList size={32} strokeWidth={1.3} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function Submit({
  busy,
  children,
}: {
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <button className="btn primary" disabled={busy} type="submit">
      {busy ? (
        <>
          <LoaderCircle size={18} className="spin" /> Guardando…
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function Toast({
  message,
  clear,
}: {
  message: string;
  clear: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.hidePopover();
    el.showPopover();
    return () => el.hidePopover();
  }, [message]);
  return (
    <div popover="manual" ref={ref} className="toast" role="status">
      <CircleCheck size={19} />
      <span>{message}</span>
      <button aria-label="Ocultar aviso" onClick={clear}>
        <X size={16} />
      </button>
    </div>
  );
}
