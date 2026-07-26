import { useId, useRef, useState, type RefObject } from "react";
import CameraScanner from "./CameraScanner";
import { normalizeScannedCode } from "./scanner";
import { useScannerContext } from "./scanner-context";

export type BarcodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  onScan?: (value: string) => void | Promise<void>;
  mode: "capture" | "lookup" | "serialized-unit" | "inventory" | "pos";
  label?: string;
  disabled?: boolean;
  required?: boolean;
  allowCamera?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  placeholder?: string;
};
export function BarcodeInput({
  value,
  onChange,
  onScan,
  mode,
  label = "Code-barres",
  disabled,
  required,
  allowCamera = true,
  inputRef,
  placeholder = "Scannez ou saisissez un code-barres",
}: BarcodeInputProps) {
  const id = useId();
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const [focused, setFocused] = useState(false);
  const [camera, setCamera] = useState(false);
  const [feedback, setFeedback] = useState("");
  const accept = async (raw: string) => {
    const code = normalizeScannedCode(raw);
    if (code.length < 2) return setFeedback("Le code-barres est invalide.");
    onChange(code);
    setFeedback(mode === "capture" ? "Code-barres renseigné." : "Code-barres scanné.");
    await onScan?.(code);
  };
  useScannerContext(`barcode-field-${id}`, "field", ({ code }) => accept(code), focused && !disabled && !camera);
  return <div className="barcode-input">
    <label htmlFor={id}>{label}</label>
    <div className="inline-actions">
      <input id={id} ref={ref} data-scanner-input="true" data-barcode-input="true"
        autoComplete="off" value={value} disabled={disabled} required={required}
        placeholder={placeholder} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={(event) => { onChange(event.target.value); setFeedback(""); }} />
      <button type="button" className="secondary" disabled={disabled}
        aria-label="Scanner" onClick={() => ref.current?.focus()}>Scanner</button>
      {allowCamera && <button type="button" className="secondary" disabled={disabled}
        aria-label="Scanner le code-barres avec la caméra" onClick={() => setCamera(true)}>Caméra</button>}
      {value && <button type="button" className="secondary" disabled={disabled}
        aria-label="Effacer le code-barres" onClick={() => { onChange(""); setFeedback(""); ref.current?.focus(); }}>Effacer</button>}
    </div>
    <small aria-live="polite">{feedback}</small>
    {camera && <CameraScanner close={() => { setCamera(false); requestAnimationFrame(() => ref.current?.focus()); }}
      onScan={async (code: string) => { await accept(code); setCamera(false); }} />}
  </div>;
}
